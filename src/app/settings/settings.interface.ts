import { Language } from './language.enum';
import { Theme } from './theme.enum';

/**
 * Contains all types of supported video players
 * TODO: extract to separate file
 */
export enum VideoPlayer {
    Auto = 'auto',
    VideoJs = 'videojs',
    Html5Player = 'html5',
    Mpegts = 'mpegts',
    MPV = 'mpv',
    VLC = 'vlc',
}

/**
 * Describes all available settings options of the application
 */
export interface Settings {
    player: VideoPlayer;
    epgUrl: string[];
    language: Language;
    showCaptions: boolean;
    theme: Theme;
    mpvPlayerPath: string;
    vlcPlayerPath: string;
    remoteControl: boolean;
    remoteControlPort: number;
    updateSource?: 'auto' | 'github' | 'cdn';
}
