import {
    Component,
    ElementRef,
    Input,
    Output,
    EventEmitter,
    OnChanges,
    OnDestroy,
    SimpleChanges,
    ViewChild,
} from '@angular/core';
import { Channel } from '../../../../../shared/channel.interface';
import { getDollarSuffix, getPlaybackUrl, stripAfterDollar } from '../../../../../shared/playlist.utils';
import { DataService } from '../../../services/data.service';
import mpegts from 'mpegts.js';

@Component({
    selector: 'app-mpegts-player',
    templateUrl: './mpegts-player.component.html',
    styleUrls: ['./mpegts-player.component.scss'],
    standalone: true,
})
export class MpegtsPlayerComponent implements OnChanges, OnDestroy {
    @Input() channel: Channel;
    @Input() tuning: 'low' | 'balanced' | 'robust' = 'balanced';
    @ViewChild('videoRef', { static: true })
    videoRef: ElementRef<HTMLVideoElement>;

    private player: any;
    private codecSet = false;
    private audioSet = false;
    private probeTimer: any;
    private probeRemaining = 6;
    private setupTimer: any;
    @Output() mediaInfo = new EventEmitter<{
        width?: number;
        height?: number;
        fps?: number;
        audioChannels?: number;
        videoCodec?: string;
    }>();

    constructor(private dataService: DataService) {}

    ngOnChanges(changes: SimpleChanges): void {
        if (changes.channel && changes.channel.currentValue) {
            this.play(changes.channel.currentValue);
        }
    }

    private play(channel: Channel) {
        // 避免在回放场景误用 mpegts 播放器（回放统一走 HTML5）
        if (String(channel?.epgParams || '').startsWith('catchup:')) {
            return;
        }
        // 重置探测状态，避免上一频道状态影响新频道
        this.codecSet = false;
        this.audioSet = false;
        if (this.probeTimer) {
            clearInterval(this.probeTimer);
            this.probeTimer = null;
        }
        const url = getPlaybackUrl(channel as any);
        if (this.player) {
            try {
                this.player.unload();
                this.player.detachMediaElement();
                this.player.destroy();
            } catch {}
        }
        if (this.setupTimer) {
            clearTimeout(this.setupTimer);
            this.setupTimer = null;
        }
        this.setupTimer = setTimeout(() => {
            if (mpegts && mpegts.isSupported()) {
                const cfgMap: any = {
                    low: {
                        isLive: true,
                        enableStashBuffer: false,
                        stashInitialSize: 131072,
                        lazyLoad: false,
                        deferLoadAfterSourceOpen: false,
                        autoCleanupSourceBuffer: true,
                        autoCleanupMaxBackwardDuration: 6,
                        autoCleanupMinBackwardDuration: 2,
                    },
                    balanced: {
                        isLive: true,
                        enableStashBuffer: true,
                        stashInitialSize: 393216,
                        autoCleanupSourceBuffer: true,
                        autoCleanupMaxBackwardDuration: 12,
                        autoCleanupMinBackwardDuration: 4,
                    },
                    robust: {
                        isLive: true,
                        enableStashBuffer: true,
                        stashInitialSize: 786432,
                        autoCleanupSourceBuffer: true,
                        autoCleanupMaxBackwardDuration: 20,
                        autoCleanupMinBackwardDuration: 6,
                    },
                };
                const isFcc = this.isFccChannel(channel);
                let cfg = cfgMap[this.tuning] || cfgMap['balanced'];
                if (isFcc) {
                    if (this.tuning === 'low') {
                        cfg = { ...cfg, stashInitialSize: 65536 };
                    } else if (this.tuning === 'balanced') {
                        cfg = { ...cfg, enableStashBuffer: false, stashInitialSize: 131072 };
                    }
                }
                this.player = mpegts.createPlayer({ type: 'mpegts', url }, cfg);
                this.player.attachMediaElement(this.videoRef.nativeElement);
                const guess = this.guessFromChannel(channel);
                if (guess.videoCodec || typeof guess.audioChannels === 'number') this.mediaInfo.emit(guess);
                try {
                    this.player.on((mpegts as any).Events.MEDIA_INFO, (mi: any) => {
                        const fps =
                            mi?.fps ??
                            mi?.video?.fps ??
                            mi?.framerate ??
                            undefined;
                        const width =
                            mi?.width ?? mi?.video?.width ?? this.videoRef?.nativeElement?.videoWidth;
                        const height =
                            mi?.height ?? mi?.video?.height ?? this.videoRef?.nativeElement?.videoHeight;
                        const audioChannels =
                            mi?.audioChannelCount ??
                            mi?.audio?.channelCount ??
                            undefined;
                        const videoCodec =
                            this.normalizeCodec(
                                mi?.videoCodec ?? mi?.codec ?? mi?.video?.codec
                            ) || undefined;
                        const payload: any = {
                            width,
                            height,
                            fps: fps ? Number(fps) : undefined,
                        };
                        if (typeof audioChannels === 'number') {
                            payload.audioChannels = audioChannels;
                            this.audioSet = true;
                        }
                        if (videoCodec) {
                            payload.videoCodec = videoCodec;
                            this.codecSet = true;
                        }
                        this.mediaInfo.emit(payload);
                    });
                    this.player.on((mpegts as any).Events.INIT_SEGMENT, (seg: any) => {
                        const pick = (s?: string) => {
                            if (!s) return undefined;
                            const m = String(s).match(/codecs="?([^";]+)"?/i);
                            return m && m[1] ? m[1] : s;
                        };
                        const mime =
                            (seg && (seg.mimetype || seg.mimeType || seg.mime)) ||
                            (seg && seg.container) ||
                            undefined;
                        const raw = pick(mime) || seg?.codec || seg?.videoCodec;
                        const v = this.normalizeCodec(raw);
                        const lower = String(raw || '').toLowerCase();
                        const payload: any = {};
                        if (v) {
                            payload.videoCodec = v;
                            this.codecSet = true;
                        }
                        if (!this.audioSet) {
                            if (/(ac-3|ec-3|eac3|ac3|dolby)/i.test(lower)) {
                                payload.audioChannels = 6;
                                this.audioSet = true;
                            } else if (/mp4a|aac/.test(lower)) {
                                payload.audioChannels = 2;
                                this.audioSet = true;
                            }
                        }
                        if (Object.keys(payload).length) this.mediaInfo.emit(payload);
                    });
                    this.player.on((mpegts as any).Events.STATISTICS_INFO, (_s: any) => {
                        const vw = this.videoRef?.nativeElement?.videoWidth;
                        const vh = this.videoRef?.nativeElement?.videoHeight;
                        if (vw && vh) {
                            this.mediaInfo.emit({ width: vw, height: vh });
                            if (!this.codecSet && (vh >= 2160 || vw >= 3840)) {
                                this.mediaInfo.emit({ videoCodec: 'H.265' });
                                this.codecSet = true;
                            }
                        }
                    });
                } catch {}
                if (typeof this.player.load === 'function') this.player.load();
                try {
                    const ret = this.player.play && this.player.play();
                    if (ret && typeof ret.then === 'function') {
                        ret.catch((e: any) => {
                            const n = (e && e.name) || '';
                            if (n === 'AbortError' || n === 'NotSupportedError') return;
                        });
                    }
                } catch {}
                this.safePlay(this.videoRef?.nativeElement);
                this.startProbingForUhd();
            } else {
                this.videoRef.nativeElement.src = url;
                this.safePlay(this.videoRef.nativeElement);
                this.startProbingForUhd();
            }
        }, 0);
    }

    private isFccChannel(c: Channel): boolean {
        const u = String(c?.url || '').toLowerCase();
        if (!u) return false;
        if (u.includes('fcc=1') || u.includes('fastswitch') || u.includes('fastchannel')) return true;
        const hint = String((c as any)?.http?.['x-fcc'] || '').toLowerCase();
        return hint === '1' || hint === 'true' || hint === 'yes';
    }

    private normalizeCodec(str?: string): string | undefined {
        if (!str) return undefined;
        const s = String(str).toLowerCase();
        if (s.includes('av01')) return 'AV1';
        if (s.includes('hev1') || s.includes('hvc1') || s.includes('h265') || s.includes('hevc'))
            return 'H.265';
        if (s.includes('avc1') || s.includes('h264') || s.includes('avc')) return 'H.264';
        if (s.includes('vp09') || s.includes('vp9')) return 'VP9';
        if (s.includes('mp4v') || s.includes('mpeg4')) return 'MPEG-4';
        return s.toUpperCase();
    }
    
    private safePlay(video?: HTMLVideoElement) {
        if (!video) return;
        try {
            const p = video.play();
            if (p && typeof p.catch === 'function') {
                p.catch((e: any) => {
                    const n = (e && e.name) || '';
                    if (n === 'AbortError' || n === 'NotSupportedError') return;
                });
            }
        } catch {}
    }
    
    private guessFromChannel(channel: Channel): { videoCodec?: string; audioChannels?: number } {
        const sfx = getDollarSuffix(channel?.url || '').toLowerCase();
        const text = ((channel?.name || '') + ' ' + sfx).toLowerCase();
        let videoCodec: string | undefined;
        if (/hevc|h265|h\.265|hev1|hvc1|265/.test(text)) videoCodec = 'H.265';
        else if (/h264|h\.264|avc1|avc/.test(text)) videoCodec = 'H.264';
        else if (/av1|av01/.test(text)) videoCodec = 'AV1';
        else if (/vp09|vp9/.test(text)) videoCodec = 'VP9';
        let audioChannels: number | undefined;
        if (/7\.1/.test(text)) audioChannels = 8;
        else if (/5\.1|杜比|dolby/.test(text)) audioChannels = 6;
        else if (/2\.0|立体声|stereo/.test(text)) audioChannels = 2;
        else if (/单声道|mono|1\.0/.test(text)) audioChannels = 1;
        return { videoCodec, audioChannels };
    }

    private startProbingForUhd() {
        if (this.probeTimer) {
            clearInterval(this.probeTimer);
            this.probeTimer = null;
        }
        this.probeRemaining = 6;
        this.probeTimer = setInterval(() => {
            if (--this.probeRemaining < 0) {
                clearInterval(this.probeTimer);
                this.probeTimer = null;
                return;
            }
            const v = this.videoRef?.nativeElement;
            if (!v) return;
            const w = v.videoWidth;
            const h = v.videoHeight;
            if (w || h) {
                this.mediaInfo.emit({ width: w, height: h });
                if (!this.codecSet && (h >= 2160 || w >= 3840)) {
                    this.mediaInfo.emit({ videoCodec: 'H.265' });
                    this.codecSet = true;
                }
            }
        }, 700);
    }

    ngOnDestroy(): void {
        if (this.probeTimer) {
            clearInterval(this.probeTimer);
            this.probeTimer = null;
        }
        if (this.player) {
            try {
                this.player.unload();
                this.player.detachMediaElement();
                this.player.destroy();
            } catch {}
        }
    }
}
