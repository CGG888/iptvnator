import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import {
    Component,
    InjectionToken,
    Injector,
    NgZone,
    OnDestroy,
    OnInit,
} from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { StorageMap } from '@ngx-pwa/local-storage';
import { Observable, combineLatestWith, filter, map, switchMap } from 'rxjs';
import { Channel } from '../../../../../shared/channel.interface';
import {
    CHANNEL_SET_USER_AGENT,
    ERROR,
    PLAYLIST_PARSE_BY_URL,
    PLAYLIST_PARSE_RESPONSE,
} from '../../../../../shared/ipc-commands';
import { Playlist } from '../../../../../shared/playlist.interface';
import { DataService } from '../../../services/data.service';
import { PlaylistsService } from '../../../services/playlists.service';
import { Settings, VideoPlayer } from '../../../settings/settings.interface';
import { STORE_KEY } from '../../../shared/enums/store-keys.enum';
import * as PlaylistActions from '../../../state/actions';
import {
    selectActive,
    selectChannels,
    selectCurrentEpgProgram,
} from '../../../state/selectors';
import { MultiEpgContainerComponent } from '../multi-epg/multi-epg-container.component';
import { getPlaybackUrl, isMpegtsLikeUrl, stripAfterDollar } from '../../../../../shared/playlist.utils';

/** Possible sidebar view options */
export type SidebarView = 'CHANNELS' | 'PLAYLISTS';
type RuntimeMeta = {
    width?: number;
    height?: number;
    fps?: number;
    audioChannels?: number;
    videoCodec?: string;
};

export const COMPONENT_OVERLAY_REF = new InjectionToken(
    'COMPONENT_OVERLAY_REF'
);

@Component({
    templateUrl: './video-player.component.html',
    styleUrls: ['./video-player.component.scss'],
})
export class VideoPlayerComponent implements OnInit, OnDestroy {
    /** Active selected channel */
    activeChannel$ = this.store
        .select(selectActive)
        .pipe(filter((channel) => Boolean(channel?.url)));

    /** Channels list */
    channels$!: Observable<Channel[]>;

    /** Current epg program */
    epgProgram$ = this.store.select(selectCurrentEpgProgram);

    /** Selected video player options */
    playerSettings: Partial<Settings> = {
        player: VideoPlayer.VideoJs,
        showCaptions: false,
    };
    chosenPlayer: VideoPlayer | 'mpegts' = VideoPlayer.VideoJs;

    /** IPC Renderer commands list with callbacks */
    commandsList = [
        {
            id: ERROR,
            execute: (response: { message: string }): void => {
                this.snackBar.open(response.message, '', {
                    duration: 3100,
                });
            },
        },
        {
            id: PLAYLIST_PARSE_RESPONSE,
            execute: (response: { payload: Playlist }): void => {
                if (response.payload.isTemporary) {
                    this.store.dispatch(
                        PlaylistActions.setChannels({
                            channels: response.payload.playlist.items,
                        })
                    );
                } else {
                    this.store.dispatch(
                        PlaylistActions.addPlaylist({
                            playlist: response.payload,
                        })
                    );
                }
                this.sidebarView = 'CHANNELS';
            },
        },
    ];

    listeners = [];

    isElectron = this.dataService.isElectron;

    sidebarView: SidebarView = 'CHANNELS';

    /** EPG overlay reference */
    overlayRef: OverlayRef;

    /** UI activity state for syncing overlay with player controls */
    uiActive = true;
    private uiTimer: any;
    private uiIdleMs = 2500;
    runtimeMeta: RuntimeMeta = {};

    constructor(
        private activatedRoute: ActivatedRoute,
        private dataService: DataService,
        private ngZone: NgZone,
        private overlay: Overlay,
        private playlistsService: PlaylistsService,
        private router: Router,
        private snackBar: MatSnackBar,
        private storage: StorageMap,
        private store: Store
    ) {}

    /**
     * Sets video player and subscribes to channel list from the store
     */
    ngOnInit(): void {
        this.applySettings();
        this.setRendererListeners();
        this.getPlaylistUrlAsParam();

        this.activeChannel$.subscribe((channel) => {
            if (channel?.url) {
                this.choosePlayerByChannel(channel);
            }
        });

        this.channels$ = this.activatedRoute.params.pipe(
            combineLatestWith(this.activatedRoute.queryParams),
            switchMap(([params, queryParams]) => {
                if (params.id) {
                    this.store.dispatch(
                        PlaylistActions.setActivePlaylist({
                            playlistId: params.id,
                        })
                    );
                    return this.playlistsService.getPlaylist(params.id).pipe(
                        map((playlist) => {
                            this.dataService.sendIpcEvent(
                                CHANNEL_SET_USER_AGENT,
                                playlist.userAgent
                                    ? {
                                        referer: 'localhost',
                                        userAgent: playlist.userAgent,
                                    }
                                    : {}
                            );

                            this.store.dispatch(
                                PlaylistActions.setChannels({
                                    channels: playlist.playlist.items,
                                })
                            );
                            return playlist.playlist.items;
                        })
                    );
                } else if (queryParams.url) {
                    return this.store.select(selectChannels);
                }
            })
        );
    }

    /**
     * Opens a playlist provided as a url param
     * e.g. iptvnat.or?url=http://...
     */
    getPlaylistUrlAsParam() {
        const URL_REGEX = /^(http|https|file):\/\/[^ "]+$/;
        const playlistUrl = this.activatedRoute.snapshot.queryParams.url;

        if (playlistUrl && playlistUrl.match(URL_REGEX)) {
            this.dataService.sendIpcEvent(PLAYLIST_PARSE_BY_URL, {
                url: playlistUrl,
                isTemporary: true,
            });
        }
    }

    /**
     * Set electrons main process listeners
     */
    setRendererListeners(): void {
        this.commandsList.forEach((command) => {
            if (this.isElectron) {
                this.dataService.listenOn(command.id, (event, response) =>
                    this.ngZone.run(() => command.execute(response))
                );
            } else {
                const cb = (response) => {
                    if (response.data.type === command.id) {
                        command.execute(response.data);
                    }
                };
                this.dataService.listenOn(command.id, cb);
                this.listeners.push(cb);
            }
        });
    }

    /**
     * Reads the app configuration from the browsers storage and applies the settings in the current component
     */
    applySettings(): void {
        this.storage.get(STORE_KEY.Settings).subscribe((settings: Settings) => {
            if (settings && Object.keys(settings).length > 0) {
                this.playerSettings = {
                    player: settings.player || VideoPlayer.VideoJs,
                    showCaptions: settings.showCaptions || false,
                };
            }
        });
    }

    choosePlayerByChannel(channel: Channel) {
        const rawUrl = channel?.url || '';
        const isCatchup = String(channel?.epgParams || '').startsWith('catchup:');
        const playbackUrl = this.getActiveSrc(channel);
        const pref = this.playerSettings.player;
        if (pref === VideoPlayer.Mpegts) {
            this.chosenPlayer = 'mpegts';
            return;
        }
        if (pref === VideoPlayer.Auto) {
            // 回放：无论频道原始地址如何，统一使用 HTML5（回放模板通常为 m3u8 单播）
            if (isCatchup) {
                this.chosenPlayer = VideoPlayer.Html5Player;
                return;
            }
            // 非回放：组播/TS 网关走 mpegts，其余走 HTML5
            this.chosenPlayer = isMpegtsLikeUrl(rawUrl)
                ? 'mpegts'
                : VideoPlayer.Html5Player;
            return;
        }
        this.chosenPlayer = pref as VideoPlayer;
    }

    getActiveSrc(channel: Channel): string {
        return getPlaybackUrl(channel as any);
    }

    onMediaInfo(meta: RuntimeMeta) {
        const filtered: RuntimeMeta = {};
        if (typeof meta.width === 'number' && meta.width > 0)
            filtered.width = meta.width;
        if (typeof meta.height === 'number' && meta.height > 0)
            filtered.height = meta.height;
        if (typeof meta.fps === 'number' && meta.fps > 0)
            filtered.fps = Math.round(meta.fps);
        if (typeof meta.audioChannels === 'number' && meta.audioChannels > 0)
            filtered.audioChannels = meta.audioChannels;
        if (typeof meta.videoCodec === 'string' && meta.videoCodec.trim())
            filtered.videoCodec = meta.videoCodec.trim();
        this.runtimeMeta = { ...this.runtimeMeta, ...filtered };
    }

    ngOnDestroy() {
        if (this.isElectron) {
            this.dataService.removeAllListeners(PLAYLIST_PARSE_RESPONSE);
        } else {
            this.listeners.forEach((listener) =>
                window.removeEventListener('message', listener)
            );
        }
    }

    /**
     * Opens the overlay with multi EPG view
     */
    openMultiEpgView() {
        this.overlayRef = this.overlay.create();
        const injector = Injector.create({
            providers: [
                { provide: COMPONENT_OVERLAY_REF, useValue: this.overlayRef },
            ],
        });
        const componentPortal = new ComponentPortal(
            MultiEpgContainerComponent,
            undefined,
            injector
        );
        this.overlayRef.addPanelClass('epg-overlay');
        this.overlayRef.attach(componentPortal);
    }

    openUrl(url: string) {
        window.open(url, '_blank');
    }

    navigateHome() {
        this.router.navigate(['/']);
    }

    /** Mouse activity handlers to sync overlay with control bar */
    onUiMouseMove() {
        this.uiActive = true;
        clearTimeout(this.uiTimer);
        this.uiTimer = setTimeout(() => (this.uiActive = false), this.uiIdleMs);
    }

    onUiMouseLeave() {
        clearTimeout(this.uiTimer);
        this.uiActive = false;
    }
}
