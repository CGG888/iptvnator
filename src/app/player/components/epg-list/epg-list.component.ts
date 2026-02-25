import { Component, NgZone, ViewChild, ElementRef } from '@angular/core';
import { Store } from '@ngrx/store';
import moment from 'moment';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { EPG_GET_PROGRAM_DONE } from '../../../../../shared/ipc-commands';
import { DataService } from '../../../services/data.service';
import {
    resetActiveEpgProgram,
    setActiveEpgProgram,
    setCurrentEpgProgram,
} from '../../../state/actions';
import { selectActive, selectCurrentEpgProgram } from '../../../state/selectors';
import { EpgChannel } from '../../models/epg-channel.model';
import { EpgProgram } from '../../models/epg-program.model';

export interface EpgData {
    channel: EpgChannel;
    items: EpgProgram[];
}

const DATE_FORMAT = 'YYYYMMDD';
const DATE_TIME_FORMAT = 'YYYYMMDDHHmm ZZ';

@Component({
    selector: 'app-epg-list',
    templateUrl: './epg-list.component.html',
    styleUrls: ['./epg-list.component.scss'],
})
export class EpgListComponent {
    /** Channel info in EPG format */
    channel: EpgChannel;

    /** Today as formatted date string */
    dateToday: string;

    /** Array with EPG programs */
    items: EpgProgram[] = [];

    /** Object with epg programs for the active channel */
    programs: {
        payload: EpgData;
    };

    /** EPG selected program */
    playingNow: EpgProgram;

    /** Selected date */
    selectedDate: string;

    /** Current time as formatted string */
    timeNow: string;

    /** Timeshift availability date, based on tvg-rec value from the channel */
    timeshiftUntil$: Observable<string>;

    /** Program provided by player (timeshift/EPG selection) */
    private currentProgramFromStore?: EpgProgram;
    /** Program list container to scroll */
    @ViewChild('programList', { static: false })
    private programListRef: ElementRef<HTMLElement> | undefined;
    /** Whether currently in timeshift session (not live relative to real now) */
    isTimeshiftActive = false;
    /** Whether currently live session */
    isLiveSession = true;
    /** Whether current replay comes from EPG selection */
    private isReplayByEpg = false;

    /**
     * Creates an instance of EpgListComponent
     * @param store
     * @param electronService
     * @param ngZone
     */
    constructor(
        private readonly store: Store,
        private electronService: DataService,
        private ngZone: NgZone
    ) {
        this.electronService.listenOn(
            EPG_GET_PROGRAM_DONE,
            (event, response) => {
                this.ngZone.run(() => this.handleEpgData(response));
            }
        );
    }

    /**
     * Subscribe for values from the store on component init
     */
    ngOnInit(): void {
        // Track active channel to detect EPG-driven replay via epgParams
        this.store.select(selectActive).subscribe((active) => {
            this.isReplayByEpg = !!active?.epgParams;
        });

        this.timeshiftUntil$ = this.store.select(selectActive).pipe(
            // eslint-disable-next-line @ngrx/avoid-mapping-selectors
            map((active) => {
                const raw =
                    (active?.tvg?.rec as any) ??
                    (active?.timeshift as any) ??
                    (active?.catchup?.days as any);
                const parsed =
                    typeof raw === 'number'
                        ? raw
                        : parseInt(String(raw ?? ''), 10);
                const days = Number.isFinite(parsed) && parsed > 0 ? parsed : 7;
                return days;
            }),
            map((days) =>
                moment(Date.now())
                    .subtract(days, 'days')
                    .format(DATE_TIME_FORMAT)
            )
        );

        // Sync list with timeshift/current program from store
        this.store.select(selectCurrentEpgProgram).subscribe((p) => {
            this.currentProgramFromStore = p;
            const realNow = moment(Date.now()).format(DATE_TIME_FORMAT);
            this.isTimeshiftActive = !!p && !this.isReplayByEpg;
            this.isLiveSession = !p;
            if (p) {
                // switch base date/time to program day
                this.dateToday = moment(p.start, DATE_TIME_FORMAT).format(
                    DATE_FORMAT
                );
                this.timeNow = realNow;
                if (this.programs) {
                    const selected = this.selectPrograms(this.programs);
                    this.items =
                        selected.length > 0
                            ? selected
                            : this.generatePlaceholdersForDate(this.dateToday);
                    this.playingNow =
                        this.items.find(
                            (it) =>
                                it.start === p.start && it.stop === p.stop
                        ) || p;
                    this.scrollToActive();
                }
            } else {
                // back to live
                this.isTimeshiftActive = false;
                this.isLiveSession = true;
                const now = moment(Date.now());
                this.dateToday = now.format(DATE_FORMAT);
                this.timeNow = now.format(DATE_TIME_FORMAT);
                if (this.programs) {
                    const selected = this.selectPrograms(this.programs);
                    this.items =
                        selected.length > 0
                            ? selected
                            : this.generatePlaceholdersForDate(this.dateToday);
                    if (this.items.length > 0) {
                        this.setPlayingNow();
                        this.scrollToActive();
                    }
                }
            }
        });
    }

    

    /**
     * Handles incoming epg programs for the active channel from the main process
     * @param programs
     */
    handleEpgData(programs: { payload: EpgData }): void {
        this.programs = programs;
        this.timeNow = moment(Date.now()).format(DATE_TIME_FORMAT);
        if (!this.dateToday) {
            this.dateToday = moment(Date.now()).format(DATE_FORMAT);
        }
        const incomingChannel = programs?.payload?.channel ?? this.channel;
        const incomingId = incomingChannel?.id;
        const prevProgram = this.currentProgramFromStore;
        this.channel = incomingChannel;
        const selected = this.selectPrograms(programs);
        this.items =
            selected.length > 0
                ? selected
                : this.generatePlaceholdersForDate(this.dateToday);
        // If program in store belongs to another channel, treat as live and recompute
        const sameChannel =
            prevProgram && typeof prevProgram.channel === 'string'
                ? prevProgram.channel === incomingId
                : true;
        if (prevProgram && sameChannel) {
            this.playingNow =
                this.items.find(
                    (it) =>
                        it.start === prevProgram.start &&
                        it.stop === prevProgram.stop
                ) || prevProgram;
            this.scrollToActive();
        } else {
            // Different channel or no program: back to live of the new channel
            this.store.dispatch(setCurrentEpgProgram(undefined));
            if (this.items.length > 0) {
                this.setPlayingNow();
                this.scrollToActive();
            }
        }
    }

    private scrollToActive() {
        setTimeout(() => {
            try {
                const host = this.programListRef?.nativeElement;
                if (!host || !this.playingNow?.start) return;
                const sel = `.mat-mdc-list-option[data-start="${this.playingNow.start}"]`;
                const el = host.querySelector(sel) as HTMLElement;
                if (el && typeof el.scrollIntoView === 'function') {
                    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
                }
            } catch {}
        }, 0);
    }

    /**
     * Selects the program based on the active date
     * @param programs object with all available epg programs for the active channel
     */
    selectPrograms(programs: { payload: EpgData }): EpgProgram[] {
        const filtered = programs?.payload?.items
            .filter((item) => item.start.includes(this.dateToday.toString()))
            .map((program) => ({
                ...program,
                start: moment(program.start, DATE_TIME_FORMAT).format(
                    DATE_TIME_FORMAT
                ),
                stop: moment(program.stop, DATE_TIME_FORMAT).format(
                    DATE_TIME_FORMAT
                ),
            }))
            .sort((a, b) => {
                return a.start.localeCompare(b.start);
            }) || [];
        if (filtered.length === 0) {
            return this.generatePlaceholdersForDate(this.dateToday);
        }
        return filtered;
    }

    /**
     * Changes the date to update the epg list with programs
     * @param direction direction to switch
     */
    changeDate(direction: 'next' | 'prev'): void {
        let dateToSwitch;
        if (direction === 'next') {
            dateToSwitch = moment(this.dateToday, DATE_FORMAT)
                .add(1, 'days')
                .format(DATE_FORMAT);
        } else if (direction === 'prev') {
            dateToSwitch = moment(this.dateToday, DATE_FORMAT)
                .subtract(1, 'days')
                .format(DATE_FORMAT);
        }
        this.dateToday = dateToSwitch;
        this.items = this.selectPrograms(this.programs);
    }

    /**
     * Sets the playing now variable based on the current time
     */
    setPlayingNow(): void {
        this.playingNow = this.items.find(
            (item) => this.timeNow >= item.start && this.timeNow <= item.stop
        );
        this.store.dispatch(setCurrentEpgProgram({ program: this.playingNow }));
    }

    /**
     * Sets the provided epg program as active and starts to play
     * @param program epg program to set
     * @param isLive live stream flag
     * @param timeshift timeshift flag
     */
    setEpgProgram(
        program: EpgProgram,
        isLive?: boolean,
        timeshift?: boolean
    ): void {
        if (isLive) {
            this.store.dispatch(resetActiveEpgProgram());
        } else {
            if (!timeshift) return;
            this.store.dispatch(setActiveEpgProgram({ program }));
        }
        this.playingNow = program;
        this.store.dispatch(setCurrentEpgProgram({ program }));
    }

    private generatePlaceholdersForDate(dateStr: string): EpgProgram[] {
        const base = moment(dateStr, DATE_FORMAT);
        const tz = moment().format('ZZ');
        const channelId = this.channel?.id || '';
        const result: EpgProgram[] = [];
        for (let h = 0; h < 24; h++) {
            const start = base.clone().hour(h).minute(0).second(0);
            const stop = start.clone().add(1, 'hour');
            result.push({
                start: start.format(DATE_TIME_FORMAT),
                stop: stop.format(DATE_TIME_FORMAT),
                channel: channelId,
                title: [{ lang: 'zh', value: '精彩节目' }],
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
                    start: start.format(`YYYYMMDDHHmm ${tz}`),
                    stop: stop.format(`YYYYMMDDHHmm ${tz}`),
                },
            });
        }
        return result;
    }
    /**
     * Removes all ipc renderer listeners after destroy
     */
    ngOnDestroy(): void {
        this.electronService.removeAllListeners(EPG_GET_PROGRAM_DONE);
    }
}
