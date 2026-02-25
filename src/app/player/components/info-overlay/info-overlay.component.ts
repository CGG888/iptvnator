import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import moment from 'moment';
import { Channel } from '../../../../../shared/channel.interface';
import { EpgProgram } from '../../models/epg-program.model';
import { getDollarSuffix, isMpegtsLikeUrl } from '../../../../../shared/playlist.utils';

@Component({
    selector: 'app-info-overlay',
    templateUrl: './info-overlay.component.html',
    styleUrls: ['./info-overlay.component.scss'],
})
export class InfoOverlayComponent implements OnChanges {
    /** Active channel */
    @Input() channel: Channel | undefined;

    /** Current EPG program */
    @Input() epgProgram: EpgProgram | undefined;

    /** Whether player UI/controls are active (mouse activity) */
    @Input() controlsActive = true;

    /** Whether current playback is timeshift (slider) instead of full replay */
    @Input() isTimeshift = false;

    /** Timeshift controls (moved from toolbar) */
    @Input() timeshiftEnabled = false;
    @Input() timeshiftMaxSec = 0;
    @Input() timeshiftOffsetSec = 0;
    @Input() timeshiftStepSec = 1;
    @Input() programStartOffsetSec = 0;
    @Input() programNextOffsetSec = 0;
    @Output() timeshiftPreview = new EventEmitter<number>();
    @Output() timeshiftCommit = new EventEmitter<number>();

    @Input() runtimeMeta:
        | {
              width?: number;
              height?: number;
              fps?: number;
              audioChannels?: number;
              videoCodec?: string;
          }
        | undefined;

    /** Visibility flag of the overlay popup  */
    isVisible = false;

    /** Program duration */
    generalDuration!: number;

    /** Finished duration */
    finishedDuration!: number;

    /** Program start time */
    start;

    /** Program end time */
    stop;

    /** Timeout for the overlay visibility */
    currentTimeout;
    isReplay = false;
    isLive = false;

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

    onNudge(delta: number) {
        if (!this.timeshiftEnabled) return;
        const next = Math.max(
            0,
            Math.min(this.timeshiftMaxSec || 0, (this.timeshiftOffsetSec || 0) + delta)
        );
        this.timeshiftCommit.emit(next);
    }

    formatNow(): string {
        const nowMs = Date.now();
        const d = new Date(nowMs);
        const pad = (n: number) => (n < 10 ? '0' + n : '' + n);
        const MM = pad(d.getMonth() + 1);
        const DD = pad(d.getDate());
        const HH = pad(d.getHours());
        const mm = pad(d.getMinutes());
        return `${MM}-${DD} ${HH}:${mm}`;
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

    /**
     * Calculates the necessary information for the visualization in the overview popup
     * @param changes component input changes
     */
    ngOnChanges(changes: SimpleChanges): void {
        if (changes.channel) {
            clearTimeout(this.currentTimeout);
            this.isVisible = true;
            this.currentTimeout = setTimeout(() => {
                this.isVisible = false;
            }, 4000);
        }
        if (changes.epgProgram && changes.epgProgram.currentValue) {
            const { stop, start } = changes.epgProgram.currentValue;
            this.setProgramDuration(start, stop);
            clearTimeout(this.currentTimeout);
            this.isVisible = true;
            this.currentTimeout = setTimeout(() => {
                this.isVisible = false;
            }, 4000);
            const now = moment(Date.now()).format('YYYYMMDDHHmm ZZ');
            this.isReplay = now > stop;
            this.isLive = now >= start && now <= stop;
        }
    }


    /**
     * Calculates and sets the duration of the program for the progress bar visualization
     * @param start program start time
     * @param stop program stop time
     */
    setProgramDuration(start: number, stop: number): void {
        this.stop = moment(stop, 'YYYYMMDDHHmm ZZ');
        this.start = moment(start, 'YYYYMMDDHHmm ZZ');
        const timeNow = moment(Date.now());

        this.generalDuration = moment
            .duration(this.stop.diff(this.start))
            .asMilliseconds();

        this.finishedDuration = moment
            .duration(this.stop.diff(timeNow))
            .asMilliseconds();
    }

    netTypeLabel(): string {
        const c = this.channel;
        if (!c) return '';
        if (this.isReplay) return '单播';
        return isMpegtsLikeUrl(c.url) ? '组播' : '单播';
    }

    qualityLabel(): string {
        if (this.runtimeMeta?.height || this.runtimeMeta?.width) {
            const h = this.runtimeMeta?.height || 0;
            const w = this.runtimeMeta?.width || 0;
            if (h >= 2160 || w >= 3840) return 'UHD';
            if (h >= 720 || w >= 1280) return 'HD';
            return 'SD';
        }
        const c = this.channel;
        if (!c) return '';
        return this.getQualitySuffix(c);
    }

    fpsLabel(): string {
        if (this.runtimeMeta?.fps) {
            const v = Math.round(this.runtimeMeta.fps);
            return `${v}fps`;
        }
        const c = this.channel;
        if (!c) return '';
        return this.getFpsSuffix(c);
    }

    audioLabel(): string {
        const n = this.runtimeMeta?.audioChannels;
        if (!n) return '';
        if (n === 2) return '2.0';
        if (n === 6) return '5.1';
        return `${n}.0`;
    }

    codecLabel(): string {
        if (this.runtimeMeta?.videoCodec) return this.runtimeMeta.videoCodec;
        const c = this.channel;
        if (!c) return '';
        const sfx = getDollarSuffix(c.url).toLowerCase();
        if (/hevc|h265|h\.265|hev1|hvc1/.test(sfx)) return 'H.265';
        if (/h264|h\.264|avc1|avc/.test(sfx)) return 'H.264';
        if (/av1|av01/.test(sfx)) return 'AV1';
        if (/vp09|vp9/.test(sfx)) return 'VP9';
        return '';
    }

    private getQualitySuffix(c: Channel): string {
        const sfx = getDollarSuffix(c.url);
        const combined = (c.name || '') + ' ' + sfx;
        const lower = combined.toLowerCase();
        if (
            /\b(8k|4320p|uhd|4k|2160p)\b/i.test(lower) ||
            /(超高清|3840x2160|2160)/i.test(combined)
        )
            return 'UHD';
        if (
            /\b(fhd|fullhd|full hd|1080p|1080|1440p|2k|720p|720|hd)\b/i.test(lower) ||
            /(超清|蓝光|高清)/i.test(combined)
        )
            return 'HD';
        if (/\b(480p|576p|480|576|sd)\b/i.test(lower) || /(标清)/i.test(combined))
            return 'SD';
        return 'SD';
    }

    private getFpsSuffix(c: Channel): string {
        const sfx = getDollarSuffix(c.url);
        const m = sfx.match(/(\d+(?:\.\d+)?)\s*fps/i);
        if (m) {
            const v = m[1].includes('.') ? m[1].split('.')[0] : m[1];
            return `${v}fps`;
        }
        return '';
    }
}
