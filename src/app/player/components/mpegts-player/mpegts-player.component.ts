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
    @Input() playbackUrl?: string;
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
        segmentDuration?: number;
    }>();

    constructor(private dataService: DataService) {}

    ngOnChanges(changes: SimpleChanges): void {
        if (changes.channel && changes.channel.currentValue) {
            this.play(changes.channel.currentValue);
        } else if (changes.playbackUrl) {
            if (this.channel) this.play(this.channel);
        }
    }

    private play(channel: Channel) {
        // 重置探测状态，避免上一频道状态影响新频道
        this.codecSet = false;
        this.audioSet = false;
        if (this.probeTimer) {
            clearInterval(this.probeTimer);
            this.probeTimer = null;
        }
        const url = this.playbackUrl || getPlaybackUrl(channel as any);
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
                // 处理 RTSP over HTTP/HTTPS 的情况，mpegts.js 需要 http(s) 协议的 URL
                let finalUrl = url;
                if (url.startsWith('rtsp://')) {
                    // 如果是 RTSP 协议，尝试通过 HTTP/HTTPS 代理或者转换
                    // 这里假设存在某种机制将 rtsp 转换为 http，或者 mpegts.js 在某些配置下能处理
                    // 但根据日志，请求的是 https://iptv.yida.cc.cd:8025/rtsp/...
                    // 并且出现了 net::ERR_CERT_AUTHORITY_INVALID
                    // 这通常意味着自签名证书问题
                    // mpegts.js 本身不支持直接播放 rtsp，通常需要 websocket 或者 http flv/ts
                    // 如果 url 本身就是 http/https 但路径包含 rtsp，则直接使用
                }

                this.player = mpegts.createPlayer({ type: 'mpegts', url: finalUrl }, cfg);
                this.player.attachMediaElement(this.videoRef.nativeElement);
                // 监听错误事件
                this.player.on((mpegts as any).Events.ERROR, (errorType: any, errorDetail: any, errorInfo: any) => {
                    console.error('Mpegts error:', errorType, errorDetail, errorInfo);
                    // 忽略网络错误，mpegts.js 会自动重试
                    if (errorType === (mpegts as any).ErrorTypes.NETWORK_ERROR) {
                        // 针对 net::ERR_CERT_AUTHORITY_INVALID 等证书错误，通常无法在 JS 层自动解决
                        // 除非使用 Electron 的 certificate 忽略机制，但这属于全局配置
                        // 这里尝试做有限的重试或者提示
                        return;
                    }
                });
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
