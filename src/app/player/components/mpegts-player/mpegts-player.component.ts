import {
    Component,
    ElementRef,
    Input,
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
