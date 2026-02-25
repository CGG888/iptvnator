import { Component, EventEmitter, Input, Output } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { Channel } from '../../../../../../shared/channel.interface';
import { setActiveChannel, updateFavorites } from '../../../../state/actions';
import {
    selectChannels,
    selectActivePlaylistId,
    selectFavorites,
    selectIsEpgAvailable,
} from '../../../../state/selectors';
import { getDollarSuffix, isMpegtsLikeUrl } from '../../../../../../shared/playlist.utils';

@Component({
    selector: 'app-toolbar',
    templateUrl: './toolbar.component.html',
    styleUrls: ['./toolbar.component.scss'],
})
export class ToolbarComponent {
    @Input() activeChannel!: Channel;
    @Input() runtimeMeta?:
        | {
              width?: number;
              height?: number;
              fps?: number;
              audioChannels?: number;
              videoCodec?: string;
          }
        | undefined;
    @Input() timeshiftEnabled = false;
    @Input() timeshiftMaxSec = 0;
    @Input() timeshiftOffsetSec = 0;
    @Input() timeshiftStepSec = 1;
    @Input() programStartOffsetSec = 0;
    @Input() programNextOffsetSec = 0;
    @Output() timeshiftPreview = new EventEmitter<number>();
    @Output() timeshiftCommit = new EventEmitter<number>();
    @Output() multiEpgClicked = new EventEmitter<void>();
    @Output() toggleLeftDrawerClicked = new EventEmitter<void>();
    @Output() toggleRightDrawerClicked = new EventEmitter<void>();
    @Input() nativeControls = false;
    @Output() toggleNativeControls = new EventEmitter<void>();

    favorites$ = this.store.select(selectFavorites);
    isEpgAvailable$ = this.store.select(selectIsEpgAvailable);
    playlistId$ = this.store.select(selectActivePlaylistId);
    allChannels$ = this.store.select(selectChannels);
    allChannels: Channel[] = [];

    constructor(
        private snackBar: MatSnackBar,
        private store: Store,
        private translateService: TranslateService
    ) {
        this.allChannels$.subscribe((chs) => (this.allChannels = chs || []));
    }

    /**
     * Adds/removes a given channel to the favorites list
     * @param channel channel to add
     */
    addToFavorites(channel: Channel): void {
        this.snackBar.open(
            this.translateService.instant('CHANNELS.FAVORITES_UPDATED'),
            null,
            { duration: 2000 }
        );
        this.store.dispatch(updateFavorites({ channel }));
    }

    getAlternativeSources(): Channel[] {
        if (!this.activeChannel || !this.activeChannel?.name) return [];
        const name = this.activeChannel.name.trim().toLowerCase();
        const is4k = this.is4k(this.activeChannel?.name);
        const list = this.allChannels.filter((c) => {
            if (!c?.name) return false;
            const n = c.name.trim().toLowerCase();
            return n === name && this.is4k(c.name) === is4k;
        });
        // unique by url
        const seen = new Set<string>();
        return list.filter((c) => {
            if (seen.has(c.url)) return false;
            seen.add(c.url);
            return true;
        });
    }

    is4k(title: string): boolean {
        return /\b(4k|uhd)\b/i.test(title || '') || /\b(2160|3840x2160)\b/i.test(title || '');
    }

    switchSource(channel: Channel) {
        if (!channel || channel.url === this.activeChannel?.url) return;
        this.store.dispatch(setActiveChannel({ channel }));
    }

    sourceLabel(c: Channel): string {
        const type = isMpegtsLikeUrl(c.url) ? '组播' : '单播';
        const codec =
            c?.url === this.activeChannel?.url && this.runtimeMeta?.videoCodec
                ? this.runtimeMeta.videoCodec
                : this.getCodecSuffix(c);
        const quality =
            c?.url === this.activeChannel?.url &&
            (this.runtimeMeta?.width || this.runtimeMeta?.height)
                ? this.getQualityFromRuntime()
                : this.getQualitySuffix(c);
        const fps =
            c?.url === this.activeChannel?.url && this.runtimeMeta?.fps
                ? `${Math.round(this.runtimeMeta.fps)}fps`
                : this.getFpsSuffix(c);
        const parts = [type, codec, quality, fps].filter(Boolean);
        return parts.join('-');
    }

    private getQualityFromRuntime(): string {
        const h = this.runtimeMeta?.height || 0;
        const w = this.runtimeMeta?.width || 0;
        if (h >= 2160 || w >= 3840) return 'UHD';
        if (h >= 720 || w >= 1280) return 'HD';
        return 'SD';
    }

    private getCodecSuffix(c: Channel): string {
        const sfx = getDollarSuffix(c.url).toLowerCase();
        if (/hevc|h265|h\.265|hev1|hvc1/.test(sfx)) return 'H.265';
        if (/h264|h\.264|avc1|avc/.test(sfx)) return 'H.264';
        if (/av1|av01/.test(sfx)) return 'AV1';
        if (/vp09|vp9/.test(sfx)) return 'VP9';
        return '';
    }

    getQualitySuffix(c: Channel): string {
        const sfx = getDollarSuffix(c.url);
        const combined = (c.name || '') + ' ' + sfx;
        const lower = combined.toLowerCase();
        // UHD: include Latin terms with word boundaries and CJK terms without
        if (
            /\b(8k|4320p|uhd|4k|2160p)\b/i.test(lower) ||
            /(超高清|3840x2160|2160)/i.test(combined)
        )
            return 'UHD';
        // HD/FHD: include common Chinese synonyms and Latin terms
        if (
            /\b(fhd|fullhd|full hd|1080p|1080|1440p|2k|720p|720|hd)\b/i.test(lower) ||
            /(超清|蓝光|高清)/i.test(combined)
        )
            return 'HD';
        // SD explicit hints
        if (/\b(480p|576p|480|576|sd)\b/i.test(lower) || /(标清)/i.test(combined))
            return 'SD';
        // Default fallback
        return 'SD';
    }

    getFpsSuffix(c: Channel): string {
        const sfx = getDollarSuffix(c.url);
        const m = sfx.match(/(\d+(?:\.\d+)?)\s*fps/i);
        if (m) {
            const v = m[1].includes('.') ? m[1].split('.')[0] : m[1];
            return `${v}fps`;
        }
        return '';
    }

    onSliderInput(v: number | null) {
        if (typeof v !== 'number') return;
        const mapped = this.toOffsetFromSlider(v);
        this.timeshiftPreview.emit(mapped);
    }

    onSliderChange(v: number | null) {
        if (typeof v !== 'number') return;
        const mapped = this.toOffsetFromSlider(v);
        this.timeshiftCommit.emit(mapped);
    }

    /** Return to live edge immediately (no slider mapping) */
    goLive() {
        this.timeshiftCommit.emit(0);
    }

    /** Jump to a specific offset in seconds (from now), clamped to window */
    jumpTo(offsetSec: number | null | undefined) {
        if (typeof offsetSec !== 'number') return;
        const max = Math.max(0, Math.floor(Number(this.timeshiftMaxSec || 0)));
        const v = Math.max(0, Math.min(max, Math.floor(offsetSec)));
        this.timeshiftCommit.emit(v);
    }

    onNudge(delta: number) {
        if (!this.timeshiftEnabled) return;
        const next = Math.max(
            0,
            Math.min(this.timeshiftMaxSec || 0, (this.timeshiftOffsetSec || 0) + delta)
        );
        this.timeshiftCommit.emit(next);
    }

    formatSeconds(s: number | null | undefined): string {
        const v = Math.max(0, Math.floor(Number(s || 0)));
        const h = Math.floor(v / 3600);
        const m = Math.floor((v % 3600) / 60);
        const sec = v % 60;
        const hh = h > 0 ? h + ':' : '';
        const mm = (h > 0 && m < 10 ? '0' : '') + m;
        const ss = (sec < 10 ? '0' : '') + sec;
        return hh + mm + ':' + ss;
    }

    formatOffsetDisplay(s: number | null | undefined): string {
        const nowMs = Date.now();
        const startMs = nowMs - Math.max(0, Math.floor(Number(this.timeshiftMaxSec || 0))) * 1000;
        const pickedMs = nowMs - Math.max(0, Math.floor(Number(s || 0))) * 1000;
        const fmt = (ms: number, withDate: boolean) => {
            const d = new Date(ms);
            const pad = (n: number) => (n < 10 ? '0' + n : '' + n);
            const MM = pad(d.getMonth() + 1);
            const DD = pad(d.getDate());
            const HH = pad(d.getHours());
            const mm = pad(d.getMinutes());
            return withDate ? `${MM}-${DD} ${HH}:${mm}` : `${HH}:${mm}`;
        };
        const needsDate =
            new Date(startMs).getDate() !== new Date(nowMs).getDate() ||
            new Date(pickedMs).getDate() !== new Date(nowMs).getDate();
        const left = fmt(startMs, needsDate);
        const right = fmt(nowMs, needsDate);
        const mid = fmt(pickedMs, needsDate);
        return `${left} — ${right} | ${mid}`;
    }

    get programStartPercent(): number {
        if (!this.timeshiftEnabled || !this.timeshiftMaxSec) return 0;
        const v = Math.max(0, Math.min(this.timeshiftMaxSec, this.programStartOffsetSec || 0));
        return (v / this.timeshiftMaxSec) * 100;
    }

    get programNextPercent(): number {
        if (!this.timeshiftEnabled || !this.timeshiftMaxSec) return 0;
        const v = Math.max(0, Math.min(this.timeshiftMaxSec, this.programNextOffsetSec || 0));
        return (v / this.timeshiftMaxSec) * 100;
    }

    get sliderValue(): number {
        const max = Math.max(0, Math.floor(Number(this.timeshiftMaxSec || 0)));
        const off = Math.max(0, Math.floor(Number(this.timeshiftOffsetSec || 0)));
        const mapped = Math.max(0, Math.min(max, max - off));
        return mapped;
    }

    private toOffsetFromSlider(sliderV: number): number {
        const max = Math.max(0, Math.floor(Number(this.timeshiftMaxSec || 0)));
        const v = Math.max(0, Math.min(max, Math.floor(Number(sliderV || 0))));
        return max - v;
    }
}
