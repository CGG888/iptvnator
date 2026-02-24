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
import { getPlaybackUrl, stripAfterDollar } from '../../../../../shared/playlist.utils';
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
                    this.mediaInfo.emit({
                        width,
                        height,
                        fps: fps ? Number(fps) : undefined,
                        audioChannels,
                        videoCodec,
                    });
                });
                this.player.on((mpegts as any).Events.STATISTICS_INFO, (_s: any) => {
                    const vw = this.videoRef?.nativeElement?.videoWidth;
                    const vh = this.videoRef?.nativeElement?.videoHeight;
                    if (vw && vh) {
                        this.mediaInfo.emit({ width: vw, height: vh });
                    }
                });
            } catch {}
            this.player.load();
            this.player.play();
        } else {
            this.videoRef.nativeElement.src = url;
            this.videoRef.nativeElement.play();
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

    ngOnDestroy(): void {
        if (this.player) {
            try {
                this.player.unload();
                this.player.detachMediaElement();
                this.player.destroy();
            } catch {}
        }
    }
}
