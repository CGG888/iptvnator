import { NgIf } from '@angular/common';
import {
    Component,
    Signal,
    ViewEncapsulation,
    effect,
    inject,
    input,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { StorageMap } from '@ngx-pwa/local-storage';
import { getExtensionFromUrl, isMpegtsLikeUrl, stripAfterDollar } from '../../../../shared/playlist.utils';
import { HtmlVideoPlayerComponent } from '../../player/components/html-video-player/html-video-player.component';
import { MpegtsPlayerComponent } from '../../player/components/mpegts-player/mpegts-player.component';
import { VjsPlayerComponent } from '../../player/components/vjs-player/vjs-player.component';
import { Settings, VideoPlayer } from '../../settings/settings.interface';
import { STORE_KEY } from '../../shared/enums/store-keys.enum';

@Component({
    standalone: true,
    selector: 'app-web-player-view',
    templateUrl: './web-player-view.component.html',
    styleUrls: ['./web-player-view.component.scss'],
    imports: [HtmlVideoPlayerComponent, NgIf, VjsPlayerComponent, MpegtsPlayerComponent],
    encapsulation: ViewEncapsulation.None,
})
export class WebPlayerViewComponent {
    storage = inject(StorageMap);

    streamUrl = input.required<string>();

    settings = toSignal(
        this.storage.get(STORE_KEY.Settings)
    ) as Signal<Settings>;

    channel: { url: string };
    player: VideoPlayer | 'mpegts';
    vjsOptions: { sources: { src: string; type: string }[] };

    constructor() {
        effect(
            () => {
                const pref = this.settings()?.player ?? VideoPlayer.VideoJs;
                this.player = this.choosePlayer(pref, this.streamUrl());

                this.setChannel(this.streamUrl());
                this.setVjsOptions(this.streamUrl());
            },
            { allowSignalWrites: true }
        );
    }

    choosePlayer(pref: VideoPlayer, url: string): VideoPlayer | 'mpegts' {
        if (pref === VideoPlayer.Mpegts) {
            return 'mpegts';
        }
        if (pref === VideoPlayer.Auto) {
            // 自动模式：单播与回放统一使用 HTML5，组播使用 mpegts
            if (isMpegtsLikeUrl(url)) return 'mpegts';
            return VideoPlayer.Html5Player;
        }
        return pref;
    }

    setVjsOptions(streamUrl: string) {
        const sanitized = stripAfterDollar(streamUrl);
        const extension = getExtensionFromUrl(sanitized);
        const mimeType =
            extension === 'm3u' || extension === 'm3u8' || extension === 'ts'
                ? 'application/x-mpegURL'
                : 'video/mp4';

        this.vjsOptions = {
            sources: [{ src: sanitized, type: mimeType }],
        };
    }

    setChannel(streamUrl: string) {
        this.channel = {
            url: streamUrl,
        };
    }
}
