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
                    this.mediaInfo.emit({
                        width,
                        height,
                        fps: fps ? Number(fps) : undefined,
                        audioChannels,
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
