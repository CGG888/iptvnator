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
    @ViewChild('videoRef', { static: true })
    videoRef: ElementRef<HTMLVideoElement>;

    private player: any;
    private codecSet = false;
    private audioSet = false;
    private probeTimer: any;
    private probeRemaining = 6;
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
        if (mpegts && mpegts.isSupported()) {
            if (this.player) {
                try {
                    this.player.unload();
                    this.player.detachMediaElement();
                    this.player.destroy();
                } catch {}
            }
            this.player = mpegts.createPlayer({ type: 'mpegts', url });
            this.player.attachMediaElement(this.videoRef.nativeElement);
            const guess = this.guessFromChannel(channel);
            // 先显示“临时猜测”，但不置位 codecSet/audioSet，让后续真实值覆盖
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
                // 尝试从初始化片段中解析 MIME/Codec（部分 4K 组播只在此处可拿到）
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
                        // 粗略根据音频编解码推断声道
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
                        // 若识别到 4K 分辨率但仍无编码，按惯例回退 H.265
                        if (!this.codecSet && (vh >= 2160 || vw >= 3840)) {
                            this.mediaInfo.emit({ videoCodec: 'H.265' });
                            this.codecSet = true;
                        }
                    }
                });
            } catch {}
            this.player.load();
            this.player.play();
            this.startProbingForUhd();
        } else {
            this.videoRef.nativeElement.src = url;
            this.videoRef.nativeElement.play();
            this.startProbingForUhd();
        }
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
