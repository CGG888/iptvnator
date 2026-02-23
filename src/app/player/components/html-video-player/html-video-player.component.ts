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
import Hls from 'hls.js';
import { Channel } from '../../../../../shared/channel.interface';
import { CHANNEL_SET_USER_AGENT } from '../../../../../shared/ipc-commands';
import { getExtensionFromUrl, getPlaybackUrl, stripAfterDollar } from '../../../../../shared/playlist.utils';
import { DataService } from '../../../services/data.service';

/**
 * This component contains the implementation of HTML5 based video player
 */
@Component({
    selector: 'app-html-video-player',
    templateUrl: './html-video-player.component.html',
    styleUrls: ['./html-video-player.component.scss'],
    standalone: true,
})
export class HtmlVideoPlayerComponent implements OnChanges, OnDestroy {
    /** Channel to play  */
    @Input() channel: Channel;
    dataService: DataService; // Declare the dataService property
    @Output() mediaInfo = new EventEmitter<{
        width?: number;
        height?: number;
        fps?: number;
        audioChannels?: number;
    }>();

    constructor(dataService: DataService) {
        this.dataService = dataService; // Inject the DataService
    }

    /** Video player DOM element */
    @ViewChild('videoPlayer', { static: true })
    videoPlayer: ElementRef<HTMLVideoElement>;

    /** HLS object */
    hls: Hls;

    /** Captions/subtitles indicator */
    @Input() showCaptions!: boolean;

    /**
     * Listen for component input changes
     * @param changes component changes
     */
    ngOnChanges(changes: SimpleChanges): void {
        if (changes.channel && changes.channel.currentValue) {
            this.playChannel(changes.channel.currentValue);
        }
    }

    /**
     * Starts to play the given channel
     * @param channel given channel object
     */
    playChannel(channel: Channel): void {
        if (this.hls) this.hls.destroy();
        if (channel.url) {
            const url = getPlaybackUrl(channel as any);
            const extension = getExtensionFromUrl(stripAfterDollar(channel.url));
            this.dataService.sendIpcEvent(CHANNEL_SET_USER_AGENT, {
                userAgent: channel.http?.['user-agent'] ?? '',
                referer: channel.http?.referrer ?? '',
            });

            if (
                extension !== 'mp4' &&
                extension !== 'mpv' &&
                Hls &&
                Hls.isSupported()
            ) {
                console.log('... switching channel to ', channel.name, url);
                this.hls = new Hls();
                this.hls.attachMedia(this.videoPlayer.nativeElement);
                this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
                    const l = this.hls.levels?.[this.hls.currentLevel] || this.hls.levels?.[0];
                    const fps =
                        (l as any)?.frameRate ||
                        Number((l as any)?.attrs?.['FRAME-RATE']) ||
                        undefined;
                    const width = (l as any)?.width;
                    const height = (l as any)?.height;
                    this.mediaInfo.emit({
                        width,
                        height,
                        fps: fps ? Number(fps) : undefined,
                        audioChannels: this.extractAudioChannels(),
                    });
                });
                this.hls.on(Hls.Events.LEVEL_SWITCHED, (_e, d: any) => {
                    const idx = d?.level ?? this.hls.currentLevel;
                    const l = this.hls.levels?.[idx];
                    const fps =
                        (l as any)?.frameRate ||
                        Number((l as any)?.attrs?.['FRAME-RATE']) ||
                        undefined;
                    const width = (l as any)?.width;
                    const height = (l as any)?.height;
                    this.mediaInfo.emit({
                        width,
                        height,
                        fps: fps ? Number(fps) : undefined,
                        audioChannels: this.extractAudioChannels(),
                    });
                });
                this.hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, () => {
                    this.mediaInfo.emit({
                        audioChannels: this.extractAudioChannels(),
                    });
                });
                this.hls.loadSource(url);

                this.handlePlayOperation();
            } else {
                console.error('something wrong with hls.js init...');
                this.addSourceToVideo(
                    this.videoPlayer.nativeElement,
                    url,
                    'video/mp4'
                );
                this.videoPlayer.nativeElement.play();
            }
        }
    }

    private extractAudioChannels(): number | undefined {
        const idx = (this.hls as any)?.audioTrack;
        const tr: any = (this.hls as any)?.audioTracks?.[idx];
        const raw = tr?.attrs?.CHANNELS || tr?.channels || tr?.attrs?.channels;
        if (!raw) return undefined;
        const str = String(raw);
        if (str.includes('.')) {
            const parts = str.split('.');
            const major = parseInt(parts[0], 10);
            if (!isNaN(major)) return major;
        }
        const n = parseInt(str, 10);
        return isNaN(n) ? undefined : n;
    }

    addSourceToVideo(element: HTMLVideoElement, url: string, type: string) {
        const source = document.createElement('source');
        source.src = url;
        source.type = type;
        element.appendChild(source);
    }

    /**
     * Disables text based captions based on the global settings
     */
    disableCaptions(): void {
        for (
            let i = 0;
            i < this.videoPlayer.nativeElement.textTracks.length;
            i++
        ) {
            this.videoPlayer.nativeElement.textTracks[i].mode = 'hidden';
        }
    }

    /**
     * Handles promise based play operation
     */
    handlePlayOperation(): void {
        const playPromise = this.videoPlayer.nativeElement.play();

        if (playPromise !== undefined) {
            playPromise
                .then(() => {
                    // Automatic playback started!
                    if (!this.showCaptions) {
                        this.disableCaptions();
                    }
                })
                .catch(() => {});
        }
    }

    /**
     * Destroy hls instance on component destroy
     */
    ngOnDestroy(): void {
        if (this.hls) {
            this.hls.destroy();
        }
    }
}
