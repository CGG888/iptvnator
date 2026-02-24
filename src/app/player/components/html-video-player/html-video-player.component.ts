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
import { CHANNEL_SET_USER_AGENT, OPEN_MPV_PLAYER } from '../../../../../shared/ipc-commands';
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
        videoCodec?: string;
    }>();
    private fpsEstimated = false;
    private fpsTimer: any;
    private hlsRetry = 0;
    private readonly maxRetry = 2;

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
    @Input() tuning: 'low' | 'balanced' | 'robust' = 'balanced';

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
            this.hlsRetry = 0;
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
                const profiles: any = {
                    low: {
                        lowLatencyMode: true,
                        backBufferLength: 30,
                        maxBufferLength: 8,
                        maxMaxBufferLength: 16,
                    },
                    balanced: {
                        lowLatencyMode: false,
                        backBufferLength: 60,
                        maxBufferLength: 16,
                        maxMaxBufferLength: 30,
                    },
                    robust: {
                        lowLatencyMode: false,
                        backBufferLength: 120,
                        maxBufferLength: 30,
                        maxMaxBufferLength: 60,
                    },
                };
                const baseCfg: any = {
                    enableWorker: true,
                    manifestLoadingTimeOut: 8000,
                    manifestLoadingMaxRetry: 2,
                    levelLoadingMaxRetry: 2,
                    fragLoadingMaxRetry: 2,
                    fragLoadingTimeOut: 15000,
                    xhrSetup: (xhr: any) => {
                        try {
                            xhr.withCredentials = false;
                        } catch {}
                    },
                    fetchSetup: (_ctx: any, init: any) => {
                        try {
                            init = init || {};
                            init.referrerPolicy = 'no-referrer';
                            return init;
                        } catch {
                            return init;
                        }
                    },
                };
                const tuningCfg = profiles[this.tuning] || profiles['balanced'];
                this.hls = new Hls({ ...baseCfg, ...tuningCfg } as any);
                this.hls.attachMedia(this.videoPlayer.nativeElement);
                this.hls.on(Hls.Events.ERROR, (_e, data: any) => {
                    if (!data?.fatal) return;
                    switch (data.type) {
                        case Hls.ErrorTypes.NETWORK_ERROR:
                            if (this.hlsRetry++ < this.maxRetry) {
                                try {
                                    this.hls.startLoad(0);
                                } catch {}
                            } else {
                                try {
                                    this.hls.destroy();
                                } catch {}
                                // Fallback: try external player (mpv) when available
                                try {
                                    this.dataService.sendIpcEvent(OPEN_MPV_PLAYER, { url });
                                } catch {}
                            }
                            break;
                        case Hls.ErrorTypes.MEDIA_ERROR:
                            try {
                                this.hls.recoverMediaError();
                            } catch {
                                try {
                                    this.hls.startLoad(0);
                                } catch {}
                            }
                            break;
                        default:
                            try {
                                this.hls.destroy();
                            } catch {}
                            // Fallback to external player
                            try {
                                this.dataService.sendIpcEvent(OPEN_MPV_PLAYER, { url });
                            } catch {}
                            break;
                    }
                });
                this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
                    const l = this.hls.levels?.[this.hls.currentLevel] || this.hls.levels?.[0];
                    const fps =
                        (l as any)?.frameRate ||
                        Number((l as any)?.attrs?.['FRAME-RATE']) ||
                        undefined;
                    const width = (l as any)?.width;
                    const height = (l as any)?.height;
                    const videoCodec =
                        this.normalizeCodec(
                            (l as any)?.videoCodec ||
                                (l as any)?.codecs ||
                                (l as any)?.attrs?.['CODECS']
                        ) || undefined;
                    const meta: any = {};
                    if (width) meta.width = width;
                    if (height) meta.height = height;
                    if (fps) meta.fps = Number(fps);
                    const ac = this.extractAudioChannels();
                    if (typeof ac === 'number') meta.audioChannels = ac;
                    if (videoCodec) meta.videoCodec = videoCodec;
                    if (Object.keys(meta).length) this.mediaInfo.emit(meta);
                });
                this.hls.on(Hls.Events.FRAG_PARSING_INIT_SEGMENT, (_e, d: any) => {
                    const v = d?.tracks?.video;
                    const a = d?.tracks?.audio;
                    const width = v?.width;
                    const height = v?.height;
                    const videoCodec = this.normalizeCodec(v?.codec);
                    const audioChannels =
                        a?.channels ||
                        a?.metadata?.channelCount ||
                        this.extractAudioChannels();
                    const meta: any = {};
                    if (width) meta.width = width;
                    if (height) meta.height = height;
                    if (typeof audioChannels === 'number') meta.audioChannels = audioChannels;
                    if (videoCodec) meta.videoCodec = videoCodec;
                    if (Object.keys(meta).length) this.mediaInfo.emit(meta);
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
                    const videoCodec =
                        this.normalizeCodec(
                            (l as any)?.videoCodec ||
                                (l as any)?.codecs ||
                                (l as any)?.attrs?.['CODECS']
                        ) || undefined;
                    const meta: any = {};
                    if (width) meta.width = width;
                    if (height) meta.height = height;
                    if (fps) meta.fps = Number(fps);
                    const ac = this.extractAudioChannels();
                    if (typeof ac === 'number') meta.audioChannels = ac;
                    if (videoCodec) meta.videoCodec = videoCodec;
                    if (Object.keys(meta).length) this.mediaInfo.emit(meta);
                });
                this.hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, () => {
                    const ac = this.extractAudioChannels();
                    if (typeof ac === 'number') {
                        this.mediaInfo.emit({ audioChannels: ac });
                    }
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
                this.handlePlayOperation();
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
                    this.startFpsSampling();
                })
                .catch(() => {});
        }
    }

    private startFpsSampling() {
        if (this.fpsTimer) {
            clearInterval(this.fpsTimer);
            this.fpsTimer = null;
        }
        const video = this.videoPlayer?.nativeElement;
        if (!video) return;
        let lastFrames = this.getDecodedFrames(video);
        let lastTs = performance.now();
        this.fpsTimer = setInterval(() => {
            const now = performance.now();
            const frames = this.getDecodedFrames(video);
            const dFrames = frames - lastFrames;
            const dMs = now - lastTs;
            if (dFrames > 0 && dMs > 200) {
                const fps = (dFrames * 1000) / dMs;
                if (isFinite(fps) && fps > 5 && fps < 120) {
                    this.mediaInfo.emit({ fps: Math.round(fps) });
                    this.fpsEstimated = true;
                }
            }
            lastFrames = frames;
            lastTs = now;
        }, 1000);
    }

    private getDecodedFrames(video: HTMLVideoElement): number {
        const anyV = video as any;
        if (typeof video.getVideoPlaybackQuality === 'function') {
            try {
                const q = video.getVideoPlaybackQuality() as any;
                if (q && typeof q.totalVideoFrames === 'number') return q.totalVideoFrames;
            } catch {}
        }
        if (typeof anyV.webkitDecodedFrameCount === 'number') {
            return anyV.webkitDecodedFrameCount;
        }
        return 0;
    }

    /**
     * Destroy hls instance on component destroy
     */
    ngOnDestroy(): void {
        if (this.fpsTimer) {
            clearInterval(this.fpsTimer);
            this.fpsTimer = null;
        }
        if (this.hls) {
            this.hls.destroy();
        }
    }
}
