import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import moment from 'moment';
import { Channel } from '../../../../../shared/channel.interface';
import { EpgProgram } from '../../models/epg-program.model';

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
}
