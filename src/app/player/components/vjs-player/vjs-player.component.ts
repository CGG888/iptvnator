import {
    Component,
    ElementRef,
    EventEmitter,
    Input,
    OnChanges,
    OnDestroy,
    OnInit,
    SimpleChanges,
    ViewChild,
    ViewEncapsulation,
    Output,
} from '@angular/core';
import '@yangkghjh/videojs-aspect-ratio-panel';
import videoJs from 'video.js';
import 'videojs-contrib-quality-levels';
import 'videojs-hls-quality-selector';

/**
 * This component contains the implementation of video player that is based on video.js library
 */
@Component({
    selector: 'app-vjs-player',
    templateUrl: './vjs-player.component.html',
    styleUrls: ['./vjs-player.component.scss'],
    encapsulation: ViewEncapsulation.None,
    standalone: true,
})
export class VjsPlayerComponent implements OnInit, OnChanges, OnDestroy {
    /** DOM-element reference */
    @ViewChild('target', { static: true }) target: ElementRef<Element>;
    /** Options of VideoJs player */
    @Input() options: videoJs.PlayerOptions;
    /** Emit runtime media info for overlay */
    @Input() set showMetaProbe(v: boolean) {}
    @Input() set probeFps(v: boolean) {}
    @Input() set probeCodec(v: boolean) {}
    @Input() set probeAudio(v: boolean) {}
    @Output() mediaInfo = new EventEmitter<{
        width?: number;
        height?: number;
        fps?: number;
        audioChannels?: number;
        videoCodec?: string;
        segmentDuration?: number;
    }>();
    /** VideoJs object */
    player: videoJs.Player;
    private codecProbed = false;

    /**
     * Instantiate Video.js on component init
     */
    ngOnInit(): void {
        this.player = videoJs(
            this.target.nativeElement,
            {
                ...this.options,
                autoplay: true,
            },
            function onPlayerReady() {
                this.volume(100);
            }
        );
        this.player.hlsQualitySelector({
            displayCurrentQuality: true,
        });
        this.player['aspectRatioPanel']();
        const videoEl: HTMLVideoElement = (this.player.tech(true) as any)?.el();
        if (videoEl) {
            const onMeta = () => {
                const w = videoEl.videoWidth;
                const h = videoEl.videoHeight;
                if (w || h) {
                    this.mediaInfo.emit({ width: w, height: h });
                }
                this.probeVhsInternals(); // 通过 VHS 内部结构兜底提取 CODECS/声道
            };
            videoEl.addEventListener('loadedmetadata', onMeta);
            setTimeout(onMeta, 0);
            const onFirstTimeupdate = () => {
                this.probeVhsInternals();
                videoEl.removeEventListener('timeupdate', onFirstTimeupdate);
            };
            videoEl.addEventListener('timeupdate', onFirstTimeupdate);
        }
        const ql = (this.player as any)?.qualityLevels?.();
        if (ql && ql.on) {
            const normalize = (str?: string) => {
                if (!str) return undefined;
                const s = String(str).toLowerCase();
                if (s.includes('av01')) return 'AV1';
                if (s.includes('hev1') || s.includes('hvc1') || s.includes('h265') || s.includes('hevc'))
                    return 'H.265';
                if (s.includes('avc1') || s.includes('h264') || s.includes('avc')) return 'H.264';
                if (s.includes('vp09') || s.includes('vp9')) return 'VP9';
                if (s.includes('mp4v') || s.includes('mpeg4')) return 'MPEG-4';
                return s.toUpperCase();
            };
            ql.on('addqualitylevel', (e: any) => {
                const l = e?.qualityLevel || e;
                const codec = normalize(l?.codecs || l?.codec || l?.attributes?.CODECS);
                const width = l?.width;
                const height = l?.height;
                const meta: any = {};
                if (codec) meta.videoCodec = codec;
                if (width) meta.width = width;
                if (height) meta.height = height;
                if (Object.keys(meta).length) this.mediaInfo.emit(meta);
                // Listen for label/enable toggles to update width/height/codec if changed
                if (l && l.on) {
                    l.on('change', () => {
                        const c = normalize(l?.codecs || l?.codec);
                        const m: any = {};
                        if (c) m.videoCodec = c;
                        if (l?.width) m.width = l.width;
                        if (l?.height) m.height = l.height;
                        if (Object.keys(m).length) this.mediaInfo.emit(m);
                    });
                }
            });
        }
        const ats: any = (this.player as any)?.audioTracks?.();
        if (ats && typeof ats.length === 'number') {
            const parseChannels = (label?: string): number | undefined => {
                const s = String(label || '').toLowerCase();
                if (s.includes('7.1')) return 8;
                if (s.includes('5.1')) return 6;
                if (s.includes('2.0') || s.includes('stereo')) return 2;
                return undefined;
            };
            const send = () => {
                for (let i = 0; i < ats.length; i++) {
                    const t = ats[i];
                    if (t && (t.enabled || t.selected)) {
                        const n = parseChannels(t.label || t.id);
                        if (typeof n === 'number') {
                            this.mediaInfo.emit({ audioChannels: n });
                            break;
                        }
                    }
                }
            };
            if (ats.on) {
                ats.on('change', send);
                ats.on('addtrack', send);
            }
            setTimeout(send, 0);
        }
    }

    private probeVhsInternals() {
        if (this.codecProbed) return;
        try {
            const tech: any = this.player?.tech?.(true);
            const vhs: any = tech?.vhs || tech?.hls || tech?.hlsHandler || tech?.masterPlaylistController_;
            const playlists = vhs?.playlists || vhs?.playlistController || vhs?.masterPlaylistController_;
            const master = playlists?.master || vhs?.master || tech?.vhs?.playlists?.master;
            const media = playlists?.media?.() || playlists?.media || vhs?.media || tech?.vhs?.playlists?.media?.();
            // 解析 CODECS
            let codecs: string | undefined =
                media?.attributes?.CODECS ||
                media?.attributes?.codecs ||
                master?.playlists?.find?.((p: any) => p?.uri === media?.uri)?.attributes?.CODECS;
            const norm = (s?: string) => {
                if (!s) return undefined;
                const l = String(s).toLowerCase();
                if (l.includes('av01')) return 'AV1';
                if (l.includes('hev1') || l.includes('hvc1') || l.includes('h265') || l.includes('hevc')) return 'H.265';
                if (l.includes('avc1') || l.includes('h264') || l.includes('avc')) return 'H.264';
                if (l.includes('vp09') || l.includes('vp9')) return 'VP9';
                if (l.includes('mp4v') || l.includes('mpeg4')) return 'MPEG-4';
                return s.toUpperCase();
            };
            const videoCodec = norm(codecs);
            // 解析声道（CHANNELS）
            let channelsStr: string | undefined;
            const audioGroupId =
                media?.attributes?.AUDIO || media?.attributes?.audio || media?.attributes?.['AUDIO'];
            const groups = master?.mediaGroups?.AUDIO?.[audioGroupId];
            if (groups && typeof groups === 'object') {
                for (const key of Object.keys(groups)) {
                    const it = groups[key];
                    if (it?.attributes?.CHANNELS) {
                        channelsStr = String(it.attributes.CHANNELS);
                        break;
                    }
                }
            }
            const parseChannels = (s?: string): number | undefined => {
                if (!s) return undefined;
                const t = String(s).toLowerCase();
                if (t.includes('7.1')) return 8;
                if (t.includes('5.1')) return 6;
                if (t.includes('2.0') || t.includes('stereo')) return 2;
                const num = parseInt(t, 10);
                return isNaN(num) ? undefined : num;
            };
            const audioChannels = parseChannels(channelsStr);
            const meta: any = {};
            if (videoCodec) meta.videoCodec = videoCodec;
            if (typeof audioChannels === 'number') meta.audioChannels = audioChannels;
            if (Object.keys(meta).length) {
                this.mediaInfo.emit(meta);
                this.codecProbed = true;
            } else {
                // 延迟重试 2 次，避免初次加载时内部结构尚未构建
                let retries = 2;
                const retry = () => {
                    if (this.codecProbed || retries-- <= 0) return;
                    const tech2: any = this.player?.tech?.(true);
                    if (!tech2) return;
                    setTimeout(() => this.probeVhsInternals(), 300);
                };
                retry();
            }
        } catch {}
    }

    /**
     * Replaces the url source of the player with the changed source url
     * @param changes contains changed channel object
     */
    ngOnChanges(changes: SimpleChanges): void {
        if (changes.options.previousValue) {
            this.player.src(changes.options.currentValue.sources[0]);
        }
    }

    /**
     * Removes the players HTML reference on destroy
     */
    ngOnDestroy(): void {
        if (this.player) {
            this.player.dispose();
        }
    }
}
