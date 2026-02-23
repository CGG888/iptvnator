import { v4 as uuidv4 } from 'uuid';
import { ParsedPlaylist } from '../src/typings';
import { Channel } from './channel.interface';
import { GLOBAL_FAVORITES_PLAYLIST_ID } from './constants';
import { Playlist } from './playlist.interface';

/**
 * Aggregates favorite channels as objects from all available playlists
 * @param playlists all available playlists
 * @returns an array with favorite channels from all playlists
 */
export function aggregateFavoriteChannels(playlists: Playlist[]): Channel[] {
    const favorites = [];
    playlists.forEach((playlist) => {
        if (playlist.favorites?.length > 0) {
            playlist?.playlist?.items.forEach((channel) => {
                if (
                    playlist.favorites.includes(channel.id) ||
                    playlist.favorites.includes(channel.url)
                ) {
                    favorites.push(channel);
                }
            });
        }
    });
    return favorites;
}

/**
 * Creates a simplified playlist object which is used for global favorites
 * @param channels channels list
 * @returns simplified playlist object
 */
export function createFavoritesPlaylist(
    channels: Channel[]
): Partial<Playlist> {
    return {
        _id: GLOBAL_FAVORITES_PLAYLIST_ID,
        count: channels.length,
        playlist: {
            items: channels,
        },
        filename: 'Global favorites',
    };
}

/**
 * Returns last segment (part after last slash "/") of the given URL
 * @param value URL as string
 */
export const getFilenameFromUrl = (value: string): string => {
    if (value && value.length > 1) {
        return value.substring(value.lastIndexOf('/') + 1);
    }
    return 'Untitled playlist';
};

/**
 * Creates a playlist object
 * @param name name of the playlist
 * @param playlist playlist to save
 * @param urlOrPath absolute fs path or url of the playlist
 * @param uploadType upload type - by file or via an url
 */
export const createPlaylistObject = (
    name: string,
    playlist: ParsedPlaylist,
    urlOrPath?: string,
    uploadType?: 'URL' | 'FILE' | 'TEXT'
): Playlist => {
    return {
        _id: uuidv4(),
        filename: name,
        title: name,
        count: playlist.items.length,
        playlist: {
            ...playlist,
            items: playlist.items.map((item) => ({
                id: uuidv4(),
                ...item,
            })),
        },
        importDate: new Date().toISOString(),
        lastUsage: new Date().toISOString(),
        favorites: [],
        autoRefresh: false,
        ...(uploadType === 'URL' ? { url: urlOrPath } : {}),
        ...(uploadType === 'FILE' ? { filePath: urlOrPath } : {}),
    };
};

export const getExtensionFromUrl = (url: string) => {
    return url.split(/[#?]/)[0].split('.').pop().trim();
};

/**
 * Strips any IPTV-specific options appended after a '$' in the URL
 * Example: http://.../stream.m3u8$Referer=http... -> http://.../stream.m3u8
 */
export const stripAfterDollar = (url: string) => {
    if (!url) return url;
    const idx = url.indexOf('$');
    const base = idx >= 0 ? url.substring(0, idx) : url;
    try {
        const u = new URL(base, 'http://sanitizer.local');
        const params = new URLSearchParams(u.search);
        const keysToDelete: string[] = [];
        params.forEach((v, k) => {
            if (!v || v.trim() === '') keysToDelete.push(k);
        });
        keysToDelete.forEach((k) => params.delete(k));
        const qs = params.toString();
        const path = u.pathname + (qs ? `?${qs}` : '');
        return base.startsWith('http') || base.startsWith('file')
            ? `${u.protocol}//${u.host}${path}`
            : path;
    } catch {
        return base.replace(/([?&])[^=]+=(?=&|$)/g, '').replace(/[?&]$/, '');
    }
};

/**
 * Heuristics to detect MPEG-TS style streams even without file extension
 * - Explicit extensions: .ts, .flv, .mpegts
 * - UDP/RTP schemes or gateways like /udp/ or /rtp/
 * - Multicast address pattern like 224.0.0.0–239.255.255.255 in path
 */
export const isMpegtsLikeUrl = (url: string) => {
    if (!url) return false;
    const sanitized = stripAfterDollar(url);
    const lower = sanitized.toLowerCase();
    const ext = getExtensionFromUrl(sanitized)?.toLowerCase();
    if (ext === 'ts' || ext === 'flv' || ext === 'mpegts') return true;
    if (lower.startsWith('udp://') || lower.startsWith('rtp://')) return true;
    if (lower.includes('/udp/') || lower.includes('/rtp/')) return true;
    const multicastRegex =
        /(?:^|\/)(?:22[4-9]|23[0-9])\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+(?:$|\?)/;
    return multicastRegex.test(sanitized);
};

export const getDollarSuffix = (url: string) => {
    if (!url) return '';
    const idx = url.indexOf('$');
    return idx >= 0 ? url.substring(idx + 1) : '';
};

export const buildCatchupUrl = (
    template: string,
    startUtc: string,
    endUtc: string
) => {
    if (!template) return '';
    const startDate = startUtc.substring(0, 8);
    const startTime = startUtc.substring(8, 14);
    const endDate = endUtc.substring(0, 8);
    const endTime = endUtc.substring(8, 14);
    let url = template;
    url = url.replace(/\{utc:yyyyMMddHHmmss\}/g, startUtc);
    url = url.replace(/\{utcend:yyyyMMddHHmmss\}/g, endUtc);
    url = url.replace(/\$\{\(b\)yyyyMMdd\|UTC\}/g, startDate);
    url = url.replace(/\$\{\(b\)HHmmss\|UTC\}/g, startTime);
    url = url.replace(/\$\{\(e\)yyyyMMdd\|UTC\}/g, endDate);
    url = url.replace(/\$\{\(e\)HHmmss\|UTC\}/g, endTime);
    return url;
};

export const getPlaybackUrl = (channel: any) => {
    if (!channel) return '';
    const base = stripAfterDollar(channel.url || '');
    const params = channel.epgParams || '';
    if (params && String(params).startsWith('catchup:') && channel.catchup?.source) {
        const parts = String(params).split(':');
        const startUtc = parts[1];
        const endUtc = parts[2];
        const url = buildCatchupUrl(channel.catchup.source, startUtc, endUtc);
        if (url) return url;
    }
    return base + (channel.epgParams ?? '');
};
