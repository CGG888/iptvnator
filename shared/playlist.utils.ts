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
    if (lower.startsWith('udp://') || lower.startsWith('rtp://') || lower.startsWith('rtsp://')) return true;
    if (lower.includes('/udp/') || lower.includes('/rtp/') || lower.includes('/rtsp/')) return true;
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
    // Parse start and end times to Date objects (UTC)
    const startYear = parseInt(startUtc.substring(0, 4), 10);
    const startMonth = parseInt(startUtc.substring(4, 6), 10) - 1;
    const startDay = parseInt(startUtc.substring(6, 8), 10);
    const startHour = parseInt(startUtc.substring(8, 10), 10);
    const startMinute = parseInt(startUtc.substring(10, 12), 10);
    const startSecond = parseInt(startUtc.substring(12, 14), 10);
    const startObj = new Date(Date.UTC(startYear, startMonth, startDay, startHour, startMinute, startSecond));

    const endYear = parseInt(endUtc.substring(0, 4), 10);
    const endMonth = parseInt(endUtc.substring(4, 6), 10) - 1;
    const endDay = parseInt(endUtc.substring(6, 8), 10);
    const endHour = parseInt(endUtc.substring(8, 10), 10);
    const endMinute = parseInt(endUtc.substring(10, 12), 10);
    const endSecond = parseInt(endUtc.substring(12, 14), 10);
    const endObj = new Date(Date.UTC(endYear, endMonth, endDay, endHour, endMinute, endSecond));

    const duration = Math.floor((endObj.getTime() - startObj.getTime()) / 1000);
    const timestamp = Math.floor(startObj.getTime() / 1000);

    const pad = (n: number) => (n < 10 ? '0' + n : '' + n);
    const localStartYear = startObj.getFullYear();
    const localStartMonth = pad(startObj.getMonth() + 1);
    const localStartDay = pad(startObj.getDate());
    const localStartHour = pad(startObj.getHours());
    const localStartMinute = pad(startObj.getMinutes());
    const localStartSecond = pad(startObj.getSeconds());
    const localEndYear = endObj.getFullYear();
    const localEndMonth = pad(endObj.getMonth() + 1);
    const localEndDay = pad(endObj.getDate());
    const localEndHour = pad(endObj.getHours());
    const localEndMinute = pad(endObj.getMinutes());
    const localEndSecond = pad(endObj.getSeconds());

    const fmtToken = (d: Date, format: string, useUtc: boolean): string => {
        const get = (type: 'Y'|'M'|'D'|'h'|'m'|'s') => {
            if (useUtc) {
                switch (type) {
                    case 'Y': return d.getUTCFullYear();
                    case 'M': return d.getUTCMonth() + 1;
                    case 'D': return d.getUTCDate();
                    case 'h': return d.getUTCHours();
                    case 'm': return d.getUTCMinutes();
                    case 's': return d.getUTCSeconds();
                }
            } else {
                switch (type) {
                    case 'Y': return d.getFullYear();
                    case 'M': return d.getMonth() + 1;
                    case 'D': return d.getDate();
                    case 'h': return d.getHours();
                    case 'm': return d.getMinutes();
                    case 's': return d.getSeconds();
                }
            }
        };
        const yyyy = String(get('Y')).padStart(4, '0');
        const MM = String(get('M')).padStart(2, '0');
        const dd = String(get('D')).padStart(2, '0');
        const HH = String(get('h')).padStart(2, '0');
        const mm = String(get('m')).padStart(2, '0');
        const ss = String(get('s')).padStart(2, '0');
        const tzOffsetMin = useUtc ? 0 : -d.getTimezoneOffset();
        const sign = tzOffsetMin >= 0 ? '+' : '-';
        const abs = Math.abs(tzOffsetMin);
        const tzh = String(Math.floor(abs / 60)).padStart(2, '0');
        const tzm = String(abs % 60).padStart(2, '0');
        const K = useUtc ? 'Z' : `${sign}${tzh}:${tzm}`;
        return format
            .replace(/yyyy/g, yyyy)
            .replace(/MM/g, MM)
            .replace(/dd/g, dd)
            .replace(/HH/g, HH)
            .replace(/mm/g, mm)
            .replace(/ss/g, ss)
            .replace(/K/g, K);
    };

    let url = template;

    // 1) Universal ${(b)FORMAT} / ${(e)FORMAT} with optional |UTC
    url = url.replace(/\$\{\(b\)([^}]+)\}/g, (_m, fmtRaw) => {
        const fmt = String(fmtRaw);
        const useUtc = fmt.endsWith('|UTC');
        const pattern = useUtc ? fmt.replace(/\|UTC$/, '') : fmt;
        return fmtToken(startObj, pattern, useUtc);
    });
    url = url.replace(/\$\{\(e\)([^}]+)\}/g, (_m, fmtRaw) => {
        const fmt = String(fmtRaw);
        const useUtc = fmt.endsWith('|UTC');
        const pattern = useUtc ? fmt.replace(/\|UTC$/, '') : fmt;
        return fmtToken(endObj, pattern, useUtc);
    });

    // 2) {utc:FORMAT} / {utcend:FORMAT} (UTC)
    url = url.replace(/\{utc:([^}]+)\}/g, (_m, fmt) => fmtToken(startObj, String(fmt), true));
    url = url.replace(/\{utcend:([^}]+)\}/g, (_m, fmt) => fmtToken(endObj, String(fmt), true));

    // 3) {start} / {end} (Local time fixed format)
    url = url.replace(/\{start\}/g, `${localStartYear}${localStartMonth}${localStartDay}${localStartHour}${localStartMinute}${localStartSecond}`);
    url = url.replace(/\{end\}/g, `${localEndYear}${localEndMonth}${localEndDay}${localEndHour}${localEndMinute}${localEndSecond}`);

    // 4) rtp2httpd compatible shorthand macros
    url = url.replace(/\{YmdHMS\}/g, `${localStartYear}${localStartMonth}${localStartDay}${localStartHour}${localStartMinute}${localStartSecond}`);
    url = url.replace(/\{Ymd\}/g, `${localStartYear}${localStartMonth}${localStartDay}`);
    url = url.replace(/\{HMS\}/g, `${localStartHour}${localStartMinute}${localStartSecond}`);
    url = url.replace(/\$\{timestamp\}/g, timestamp.toString());
    url = url.replace(/\$\{duration\}/g, duration.toString());

    return url;
};

export const getPlaybackUrl = (channel: any) => {
    if (!channel) return '';
    const base = stripAfterDollar(channel.url || '');
    const params = channel.epgParams || '';
    const hasUrlPlaceholders =
        typeof channel?.url === 'string' &&
        (channel.url.includes('${(b)') ||
            channel.url.includes('${(e)') ||
            channel.url.includes('{utc:') ||
            channel.url.includes('{utcend:') ||
            channel.url.includes('{start}') ||
            channel.url.includes('{end}'));
    if (params && String(params).startsWith('catchup:') && (channel.catchup?.source || hasUrlPlaceholders)) {
        const parts = String(params).split(':');
        const startUtc = parts[1];
        const endUtc = parts[2];
        const template = channel.catchup?.source || channel.url || '';
        const url = buildCatchupUrl(stripAfterDollar(template), startUtc, endUtc);
        if (url) return url;
    }
    // Avoid appending unresolved placeholder parameters during normal live playback
    const unresolved =
        typeof params === 'string' &&
        (params.includes('${(b)') ||
            params.includes('${(e)') ||
            params.includes('{utc:') ||
            params.includes('{utcend:') ||
            params.includes('{start}') ||
            params.includes('{end}'));
    if (unresolved) return base;
    return base;
};
