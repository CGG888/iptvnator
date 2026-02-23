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
    @Output() multiEpgClicked = new EventEmitter<void>();
    @Output() toggleLeftDrawerClicked = new EventEmitter<void>();
    @Output() toggleRightDrawerClicked = new EventEmitter<void>();

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
        const suffix = this.getQualitySuffix(c);
        const fps = this.getFpsSuffix(c);
        const parts = [type, suffix, fps].filter(Boolean);
        return parts.join('-');
    }

    getQualitySuffix(c: Channel): string {
        const sfx = getDollarSuffix(c.url);
        const combined = (c.name || '') + ' ' + sfx;
        if (/\b(4k|uhd|超高清|2160|3840x2160)\b/i.test(combined)) return 'UHD';
        if (/\b(hd|高清|1080|720)\b/i.test(combined)) return 'HD';
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
}
