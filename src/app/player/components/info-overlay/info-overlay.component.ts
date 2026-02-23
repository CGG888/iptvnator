import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
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

    @Input() runtimeMeta:
        | {
              width?: number;
              height?: number;
              fps?: number;
              audioChannels?: number;
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
