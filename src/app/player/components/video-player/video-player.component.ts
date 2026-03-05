import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import {
    Component,
    InjectionToken,
    Injector,
    NgZone,
    OnDestroy,
    OnInit,
    HostListener,
} from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { StorageMap } from '@ngx-pwa/local-storage';
import { Observable, combineLatestWith, filter, map, switchMap, take } from 'rxjs';
import { Channel } from '../../../../../shared/channel.interface';
import {
    CHANNEL_SET_USER_AGENT,
    ERROR,
    OPEN_MPV_PLAYER,
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
import { buildCatchupUrl, getExtensionFromUrl, getPlaybackUrl, isMpegtsLikeUrl, stripAfterDollar } from '../../../../../shared/playlist.utils';
import { EPG_GET_PROGRAM_DONE } from '../../../../../shared/ipc-commands';
import { EpgProgram } from '../../models/epg-program.model';

/** Possible sidebar view options */
export type SidebarView = 'CHANNELS' | 'PLAYLISTS';
type RuntimeMeta = {
    width?: number;
    height?: number;
    fps?: number;
    audioChannels?: number;
    videoCodec?: string;
    segmentDuration?: number;
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
        player: VideoPlayer.Auto,
        showCaptions: false,
        showStreamInfoOverlay: true,
        playbackProfile: 'balanced',
        catchupTemplate: '',
        timeshiftWindowHours: 3,
    };
    chosenPlayer: VideoPlayer | 'mpegts' | 'mpv' = VideoPlayer.VideoJs;
    nativeControls = false;
    private nativeControlsAuto = false;
    activePlaybackUrl: string | null = null;
    private lastCommitNowMs = 0;

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
    timeshiftEnabled = false;
    timeshiftMaxSec = 0;
    timeshiftOffsetSec = 0;
    private timeshiftTimer: any;
    private timeshiftSegSec?: number;
    private currentProgramStartMs?: number;
    private currentProgramStopMs?: number;
    private epgPrograms: EpgProgram[] = [];
    private pendingPointMs?: number;

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

    /** 键盘快捷键
     * 上/下：切换频道（前一个/后一个）
     * 左/右：时移 -/+ 10 分钟；长按利用按键自动重复
     */
    @HostListener('window:keydown', ['$event'])
    onGlobalKeydown(ev: KeyboardEvent) {
        if (ev.defaultPrevented) return;
        const tgt = ev.target as HTMLElement | null;
        if (tgt) {
            const tag = (tgt.tagName || '').toLowerCase();
            if (tag === 'input' || tag === 'textarea' || tgt.isContentEditable) {
                return;
            }
        }
        if (ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
        const stepSec = 10 * 60;
        if (ev.key === 'ArrowUp') {
            ev.preventDefault();
            this.store.dispatch(PlaylistActions.setAdjacentChannelAsActive({ direction: 'previous' }));
        } else if (ev.key === 'ArrowDown') {
            ev.preventDefault();
            this.store.dispatch(PlaylistActions.setAdjacentChannelAsActive({ direction: 'next' }));
        } else if (ev.key === 'ArrowLeft') {
            if (!this.timeshiftEnabled || !isFinite(this.timeshiftMaxSec)) return;
            ev.preventDefault();
            let next = Math.min(this.timeshiftMaxSec, (this.timeshiftOffsetSec || 0) + stepSec);
            if (next < 0) next = 0;
            this.onTimeshiftCommit(next);
        } else if (ev.key === 'ArrowRight') {
            if (!this.timeshiftEnabled) return;
            ev.preventDefault();
            let next = Math.max(0, (this.timeshiftOffsetSec || 0) - stepSec);
            if (next <= this.liveEdgeThreshold()) next = 0;
            this.onTimeshiftCommit(next);
        }
    }

    /**
     * Sets video player and subscribes to channel list from the store
     */
    ngOnInit(): void {
        this.applySettings();
        this.setRendererListeners();
        this.getPlaylistUrlAsParam();

        this.dataService.listenOn(EPG_GET_PROGRAM_DONE, (_e: any, resp: any) => {
            try {
                const items: EpgProgram[] = resp?.payload?.items || [];
                this.epgPrograms = Array.isArray(items) ? items : [];
                if (this.timeshiftOffsetSec > 0 && this.pendingPointMs) {
                    const found = this.findEpgProgramAt(this.pendingPointMs);
                    if (found) {
                        this.store.dispatch(PlaylistActions.setCurrentEpgProgram({ program: found as any }));
                    }
                }
            } catch {
                this.epgPrograms = [];
            }
        });

        this.activeChannel$.subscribe((channel) => {
            if (channel?.url) {
                this.runtimeMeta = {};
                // On channel change or source switch: force return to LIVE and clear replay/timeshift context
                this.pendingPointMs = undefined;
                this.activePlaybackUrl = null;
                this.store.dispatch(PlaylistActions.setCurrentEpgProgram(undefined as any));
                this.resetTimeshiftState(channel);
                this.epgPrograms = [];
                this.choosePlayerByChannel(channel);
            }
        });
        // Keep player state consistent with EPG-driven replay/live changes
        this.store.select(selectActive).subscribe((active) => {
            if (!active?.url) return;
            const isEpgReplay = !!active?.epgParams;
            if (isEpgReplay) {
                if (!this.nativeControls) {
                    this.nativeControls = true;
                    this.nativeControlsAuto = true;
                }
                if (this.timeshiftOffsetSec !== 0 || this.activePlaybackUrl) {
                    this.timeshiftOffsetSec = 0;
                    this.activePlaybackUrl = null;
                    this.choosePlayerByChannel(active as any);
                }
            } else {
                if (this.nativeControls && this.nativeControlsAuto) {
                    this.nativeControls = false;
                }
                this.nativeControlsAuto = false;
                if (this.timeshiftOffsetSec !== 0 || this.activePlaybackUrl) {
                    this.timeshiftOffsetSec = 0;
                    this.activePlaybackUrl = null;
                    this.choosePlayerByChannel(active as any);
                }
            }
        });
        this.epgProgram$.subscribe((p) => {
            this.currentProgramStartMs = this.parseEpgStartMs(p);
            this.currentProgramStopMs = this.parseEpgStopMs(p);
            const now = Date.now();
            const s = this.currentProgramStartMs;
            const e = this.currentProgramStopMs;
            const isLiveProgram =
                !!p &&
                typeof s === 'number' &&
                typeof e === 'number' &&
                now >= s &&
                now <= e;
            if (!p || isLiveProgram) {
                if (this.timeshiftOffsetSec !== 0 || this.activePlaybackUrl) {
                    this.timeshiftOffsetSec = 0;
                    this.activePlaybackUrl = null;
                    this.pendingPointMs = undefined;
                    this.activeChannel$.pipe(take(1)).subscribe((ch) => {
                        this.choosePlayerByChannel(ch);
                    });
                }
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
                    player: settings.player || VideoPlayer.Auto,
                    showCaptions: settings.showCaptions || false,
                    showStreamInfoOverlay:
                        typeof settings.showStreamInfoOverlay === 'boolean'
                            ? settings.showStreamInfoOverlay
                            : true,
                    playbackProfile: settings.playbackProfile || 'balanced',
                    catchupTemplate: (settings as any).catchupTemplate || '',
                    timeshiftWindowHours:
                        (settings as any).timeshiftWindowHours ?? 3,
                };
            }
        });
    }

    choosePlayerByChannel(channel: Channel) {
        const rawUrl = channel?.url || '';
        const isCatchup = String(channel?.epgParams || '').startsWith('catchup:') || this.timeshiftOffsetSec > 0;
        const playbackUrl = this.getActiveSrc(channel, this.timeshiftOffsetSec);
        if (isCatchup) {
            this.activePlaybackUrl = playbackUrl || null;
        } else {
            this.activePlaybackUrl = null;
        }
        const pref = this.playerSettings.player;
        if (pref === VideoPlayer.Mpegts) {
            this.chosenPlayer = 'mpegts';
            return;
        }

        // Handle MPV selection explicitly
        if (pref === 'mpv') {
            this.chosenPlayer = 'mpv';
            if (this.activePlaybackUrl) {
                // Clean up the URL by removing the dollar sign and anything after it
                const cleanUrl = stripAfterDollar(this.activePlaybackUrl);
                this.dataService.sendIpcEvent(OPEN_MPV_PLAYER, { url: cleanUrl });
            }
            return;
        }

        if (pref === VideoPlayer.Auto) {
            if (isCatchup) {
                const eff = playbackUrl || rawUrl;
                const sanitized = stripAfterDollar(eff || '');
                const ext = getExtensionFromUrl(sanitized)?.toLowerCase();
                const isTsLike = isMpegtsLikeUrl(eff || '');
                const isHlsLike = ext === 'm3u' || ext === 'm3u8';
            this.chosenPlayer = isTsLike || !isHlsLike ? 'mpegts' : VideoPlayer.Html5Player;
            return;
        }
        
        // Handle normal auto-selection
        this.chosenPlayer = isMpegtsLikeUrl(rawUrl)
            ? 'mpegts'
            : VideoPlayer.Html5Player;
        return;
    }

    // Handle explicit MPV selection if pref was casted from string
    if ((pref as any) === 'mpv') {
        this.chosenPlayer = 'mpv';
        if (playbackUrl || rawUrl) {
            // Clean up the URL by removing the dollar sign and anything after it
            let cleanUrl = stripAfterDollar(playbackUrl || rawUrl);
            // Additional cleanup: remove trailing question mark if it was left by stripping query params improperly
            if (cleanUrl.endsWith('?')) {
                 cleanUrl = cleanUrl.slice(0, -1);
            }
            this.dataService.sendIpcEvent(OPEN_MPV_PLAYER, { url: cleanUrl });
        }
        return;
    }

    this.chosenPlayer = pref as VideoPlayer;
    }

    getActiveSrc(channel: Channel, offsetSec?: number): string {
        const hasUrlTpl =
            typeof channel?.url === 'string' &&
            (channel.url.includes('${(b)') ||
                channel.url.includes('${(e)') ||
                channel.url.includes('{utc:') ||
                channel.url.includes('{utcend:') ||
                channel.url.includes('{start}') ||
                channel.url.includes('{end}'));
        if (offsetSec && offsetSec > 0) {
            const snap = this.timeshiftSnapSec();
            const snapped = Math.max(0, Math.floor(offsetSec / snap) * snap);
            const baseNow = this.lastCommitNowMs || Date.now();
            const start = new Date(baseNow - snapped * 1000);
            const end = new Date(start.getTime() + 30 * 60 * 1000);
            const fmt = (d: Date) => {
                const pad = (n: number) => (n < 10 ? '0' + n : '' + n);
                const yyyy = d.getUTCFullYear();
                const MM = pad(d.getUTCMonth() + 1);
                const dd = pad(d.getUTCDate());
                const HH = pad(d.getUTCHours());
                const mm = pad(d.getUTCMinutes());
                const ss = pad(d.getUTCSeconds());
                return `${yyyy}${MM}${dd}${HH}${mm}${ss}`;
            };
            const startUtc = fmt(start);
            const endUtc = fmt(end);
            const tpl =
                channel?.catchup?.source ||
                (this.playerSettings?.catchupTemplate || '').trim() ||
                (hasUrlTpl ? channel.url : '');
            if (tpl) {
                return buildCatchupUrl(tpl, startUtc, endUtc);
            }
        }
        const params = String(channel?.epgParams || '');
        if (params.startsWith('catchup:')) {
            const parts = params.split(':');
            const startUtc = parts[1];
            const endUtc = parts[2];
            const tpl =
                channel?.catchup?.source ||
                (this.playerSettings?.catchupTemplate || '').trim() ||
                (hasUrlTpl ? channel.url : '');
            if (tpl) {
                return buildCatchupUrl(tpl, startUtc, endUtc);
            }
        }
        return getPlaybackUrl(channel as any);
    }

    private buildActiveSrcForCommit(offset: number, baseNowMs: number): string | null {
        if (!offset || offset <= 0) return null;
        let url: string | null = null;
        const sub = this.activeChannel$.pipe(take(1)).subscribe((ch) => {
            if (!ch) return;
            const snap = this.timeshiftSnapSec();
            const snapped = Math.max(0, Math.floor(offset / snap) * snap);
            const start = new Date(baseNowMs - snapped * 1000);
            const end = new Date(start.getTime() + 30 * 60 * 1000);
            const pad = (n: number) => (n < 10 ? '0' + n : '' + n);
            const fmt = (d: Date) =>
                `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(
                    d.getUTCHours()
                )}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
            const hasUrlTpl =
                typeof ch?.url === 'string' &&
                (ch.url.includes('${(b)') ||
                    ch.url.includes('${(e)') ||
                    ch.url.includes('{utc:') ||
                    ch.url.includes('{utcend:') ||
                    ch.url.includes('{start}') ||
                    ch.url.includes('{end}'));
            const tpl =
                ch?.catchup?.source ||
                (this.playerSettings?.catchupTemplate || '').trim() ||
                (hasUrlTpl ? ch.url : '');
            if (tpl) url = buildCatchupUrl(tpl, fmt(start), fmt(end));
        });
        sub.unsubscribe();
        return url;
    }

    private fmtLocalYmdHMZZ(ms: number): string {
        const pad = (n: number) => (n < 10 ? '0' + n : '' + n);
        const d = new Date(ms);
        const yyyy = d.getFullYear();
        const MM = pad(d.getMonth() + 1);
        const dd = pad(d.getDate());
        const HH = pad(d.getHours());
        const mm = pad(d.getMinutes());
        const tzOffset = -d.getTimezoneOffset(); // minutes east of UTC
        const sign = tzOffset >= 0 ? '+' : '-';
        const abs = Math.abs(tzOffset);
        const tzh = pad(Math.floor(abs / 60));
        const tzm = pad(abs % 60);
        return `${yyyy}${MM}${dd}${HH}${mm} ${sign}${tzh}${tzm}`;
    }

    private makeEphemeralProgram(pointMs: number) {
        const startMs = Math.max(0, pointMs);
        const stopMs = startMs + 30 * 60 * 1000;
        return {
            start: this.fmtLocalYmdHMZZ(startMs),
            stop: this.fmtLocalYmdHMZZ(stopMs),
            channel: '',
            title: [{ lang: 'zh', value: '时移' }],
            desc: [],
            category: [],
            date: [],
            episodeNum: [],
            previouslyShown: [],
            subtitles: [],
            icon: [],
            rating: [],
            credits: [],
            audio: [],
            _attributes: {
                start: this.fmtLocalYmdHMZZ(startMs),
                stop: this.fmtLocalYmdHMZZ(stopMs),
            },
        };
    }

    private parseEpgDateToMs(str?: string): number | undefined {
        if (!str) return undefined;
        const s = String(str).trim();
        let m =
            s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-])?(\d{2})?(\d{2})?$/) ||
            s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-])?(\d{2})?(\d{2})?$/);
        if (!m) return undefined;
        const Y = Number(m[1]);
        const Mo = Number(m[2]) - 1;
        const D = Number(m[3]);
        const H = Number(m[4]);
        const Mi = Number(m[5]);
        const S = m.length > 6 && m[6] ? Number(m[6]) : 0;
        const sign = m[m.length - 3] as string | undefined;
        const oh = m[m.length - 2] ? Number(m[m.length - 2]) : undefined;
        const om = m[m.length - 1] ? Number(m[m.length - 1]) : undefined;
        let offsetMin: number;
        if (sign && typeof oh === 'number' && typeof om === 'number') {
            offsetMin = (sign === '+' ? 1 : -1) * (oh * 60 + om);
        } else {
            offsetMin = -new Date().getTimezoneOffset();
        }
        const utc = Date.UTC(Y, Mo, D, H, Mi, S);
        return utc - offsetMin * 60 * 1000;
    }

    private fmtYmdHmZZ(ms: number): string {
        // Use local-time format with real offset to keep consistency with EPG list
        return this.fmtLocalYmdHMZZ(ms);
    }

    private findEpgProgramAt(pointMs: number): EpgProgram | undefined {
        const items = this.epgPrograms || [];
        if (!items.length) return undefined;
        for (const p of items) {
            const sMs = this.parseEpgDateToMs((p as any).start);
            const eMs = this.parseEpgDateToMs((p as any).stop);
            if (typeof sMs === 'number' && typeof eMs === 'number') {
                if (pointMs >= sMs && pointMs <= eMs) {
                    const clone: any = { ...p };
                    clone.start = this.fmtYmdHmZZ(sMs);
                    clone.stop = this.fmtYmdHmZZ(eMs);
                    return clone as EpgProgram;
                }
            }
        }
        return undefined;
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
        if (typeof meta.segmentDuration === 'number' && meta.segmentDuration > 0) {
            this.timeshiftSegSec = meta.segmentDuration;
        }
        this.runtimeMeta = { ...this.runtimeMeta, ...filtered };
    }

    private resetTimeshiftState(channel: Channel) {
        const hasUrlTpl =
            typeof channel?.url === 'string' &&
            (channel.url.includes('${(b)') ||
                channel.url.includes('${(e)') ||
                channel.url.includes('{utc:') ||
                channel.url.includes('{utcend:') ||
                channel.url.includes('{start}') ||
                channel.url.includes('{end}'));
        const hasTpl =
            Boolean(channel?.catchup?.source) ||
            Boolean(this.playerSettings?.catchupTemplate) ||
            hasUrlTpl;
        const days = Number(channel?.catchup?.days || '0');
        const userHours =
            typeof this.playerSettings?.timeshiftWindowHours === 'number'
                ? Math.max(1, Math.min(168, Math.floor(this.playerSettings.timeshiftWindowHours)))
                : 3;
        const providerHours = days > 0 ? days * 24 : Number.POSITIVE_INFINITY;
        const maxHours = Math.max(1, Math.floor(Math.min(providerHours, userHours)));
        if (hasTpl && maxHours > 0) {
            this.timeshiftEnabled = true;
            this.timeshiftMaxSec = maxHours * 3600;
            this.timeshiftOffsetSec = 0;
        } else {
            this.timeshiftEnabled = false;
            this.timeshiftMaxSec = 0;
            this.timeshiftOffsetSec = 0;
        }
    }

    onTimeshiftPreview(v: number) {
        this.timeshiftOffsetSec = v || 0;
    }

    onTimeshiftCommit(v: number) {
        this.timeshiftOffsetSec = v || 0;
        this.lastCommitNowMs = Date.now();
        if (this.timeshiftOffsetSec > 0) {
            if (!this.nativeControls) {
                this.nativeControls = true;
                this.nativeControlsAuto = true;
            }
        } else {
            if (this.nativeControls && this.nativeControlsAuto) {
                this.nativeControls = false;
            }
            this.nativeControlsAuto = false;
        }
        const subUrl = this.buildActiveSrcForCommit(this.timeshiftOffsetSec, this.lastCommitNowMs);
        this.activePlaybackUrl = subUrl;
        if (this.timeshiftOffsetSec > 0) {
            const point = this.lastCommitNowMs - this.timeshiftOffsetSec * 1000;
            this.pendingPointMs = point;
            const found = this.findEpgProgramAt(point);
            if (found) {
                this.store.dispatch(PlaylistActions.setCurrentEpgProgram({ program: found as any }));
            } else {
                const p = this.makeEphemeralProgram(point);
                this.store.dispatch(PlaylistActions.setCurrentEpgProgram({ program: p as any }));
            }
        } else {
            this.pendingPointMs = undefined;
            this.activePlaybackUrl = null;
            this.store.dispatch(PlaylistActions.resetActiveEpgProgram());
            this.store.dispatch(PlaylistActions.setCurrentEpgProgram(undefined as any));
        }
        if (this.timeshiftTimer) {
            clearTimeout(this.timeshiftTimer);
            this.timeshiftTimer = null;
        }
        this.timeshiftTimer = setTimeout(() => {
            this.activeChannel$.pipe(take(1)).subscribe((ch) => {
                this.choosePlayerByChannel(ch);
            });
        }, 300);
    }

    private timeshiftSnapSec(): number {
        if (this.timeshiftSegSec && isFinite(this.timeshiftSegSec)) {
            const v = Math.max(1, Math.min(10, Math.round(this.timeshiftSegSec)));
            return v;
        }
        const profile = this.playerSettings?.playbackProfile || 'balanced';
        return profile === 'low' ? 2 : 6;
    }

    private liveEdgeThreshold(): number {
        return 8;
    }

    get timeshiftStepSec(): number {
        return this.timeshiftSnapSec();
    }

    get programStartOffsetSec(): number {
        if (!this.timeshiftEnabled) return 0;
        if (!this.currentProgramStartMs) return 0;
        const now = Date.now();
        let d = Math.floor((now - this.currentProgramStartMs) / 1000);
        if (d < 0) d = 0;
        if (this.timeshiftMaxSec && d > this.timeshiftMaxSec)
            d = this.timeshiftMaxSec;
        return d;
    }

    get programNextOffsetSec(): number {
        if (!this.timeshiftEnabled) return 0;
        if (!this.currentProgramStopMs) return 0;
        const now = Date.now();
        let d = Math.floor((now - this.currentProgramStopMs) / 1000);
        if (d < 0) d = 0;
        if (this.timeshiftMaxSec && d > this.timeshiftMaxSec)
            d = this.timeshiftMaxSec;
        return d;
    }

    private parseEpgStartMs(p: any): number | undefined {
        if (!p) return undefined;
        if (p.start) {
            const t = Date.parse(p.start);
            if (!isNaN(t)) return t;
        }
        const raw = p?._attributes?.start || '';
        const m = String(raw).match(
            /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})/
        );
        if (m) {
            const [_, y, M, d, h, mnt] = m;
            const dt = Date.UTC(
                Number(y),
                Number(M) - 1,
                Number(d),
                Number(h),
                Number(mnt),
                0
            );
            return dt;
        }
        return undefined;
    }

    private parseEpgStopMs(p: any): number | undefined {
        if (!p) return undefined;
        if (p.stop) {
            const t = Date.parse(p.stop);
            if (!isNaN(t)) return t;
        }
        const raw = p?._attributes?.stop || '';
        const m = String(raw).match(
            /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})/
        );
        if (m) {
            const [_, y, M, d, h, mnt] = m;
            const dt = Date.UTC(
                Number(y),
                Number(M) - 1,
                Number(d),
                Number(h),
                Number(mnt),
                0
            );
            return dt;
        }
        return undefined;
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
