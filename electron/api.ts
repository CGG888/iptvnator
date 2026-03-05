import axios from 'axios';
import { app, BrowserWindow, ipcMain, session } from 'electron';
import { promises as fsPromises } from 'fs';
import { parse } from 'iptv-playlist-parser';
import { Channel } from '../shared/channel.interface';
import {
    AUTO_UPDATE_PLAYLISTS,
    AUTO_UPDATE_PLAYLISTS_RESPONSE,
    CHANNEL_SET_USER_AGENT,
    DELETE_ALL_PLAYLISTS,
    EPG_ERROR,
    EPG_FETCH,
    EPG_FETCH_DONE,
    EPG_FORCE_FETCH,
    EPG_GET_CHANNELS,
    EPG_GET_CHANNELS_BY_RANGE,
    EPG_GET_CHANNELS_BY_RANGE_RESPONSE,
    EPG_GET_CHANNELS_DONE,
    EPG_GET_PROGRAM,
    EPG_GET_PROGRAM_DONE,
    ERROR,
    IS_PLAYLISTS_MIGRATION_POSSIBLE,
    IS_PLAYLISTS_MIGRATION_POSSIBLE_RESPONSE,
    MIGRATE_PLAYLISTS,
    MIGRATE_PLAYLISTS_RESPONSE,
    OPEN_FILE,
    OPEN_MPV_PLAYER,
    OPEN_VLC_PLAYER,
    PLAYLIST_PARSE_BY_URL,
    PLAYLIST_PARSE_RESPONSE,
    PLAYLIST_UPDATE,
    PLAYLIST_UPDATE_RESPONSE,
    SET_MPV_PLAYER_PATH,
    SET_VLC_PLAYER_PATH,
    SETTINGS_UPDATE,
    STALKER_REQUEST,
    STALKER_RESPONSE,
    XTREAM_REQUEST,
    XTREAM_RESPONSE,
    APP_UPDATE_CHECK,
    APP_UPDATE_PROGRESS,
    APP_UPDATE_DONE,
    APP_UPDATE_ERROR,
    APP_UPDATE_INSTALL,
    APP_UPDATE_TEST,
    CACHE_LOGO,
    CACHE_LOGO_RESPONSE,
} from '../shared/ipc-commands';
import { Playlist } from '../shared/playlist.interface';
import { createPlaylistObject } from '../shared/playlist.utils';
import { ParsedPlaylist } from '../src/typings.d';
import { Server } from './server';
import * as crypto from 'crypto';

const fs = require('fs');
const https = require('https');
const net = require('net');
const dns = require('dns');
const child_process = require('child_process');
const path = require('path');

const mpvAPI = require('node-mpv');

/** @deprecated - used only for migration */
const Nedb = require('nedb-promises');

try {
    // Prefer IPv4 when both A and AAAA exist (Node >= 17)
    // Ignore if not supported in this Node version
    dns.setDefaultResultOrder && dns.setDefaultResultOrder('ipv4first');
} catch {}

/** @deprecated - used only for migration */
const userData = process.env['e2e']
    ? process.cwd() + '/e2e'
    : app.getPath('userData');

/** @deprecated - used only for migration */
const dbPath = `${userData}/db/data.db`;
/** @deprecated - used only for migration */
const db = new Nedb({
    filename: dbPath,
    autoload: true,
});

/** Directory for caching logos */
const LOGO_CACHE_DIR = path.join(userData, 'logo-cache');
if (!fs.existsSync(LOGO_CACHE_DIR)) {
    fs.mkdirSync(LOGO_CACHE_DIR, { recursive: true });
}

const agent = new https.Agent({
    rejectUnauthorized: false,
    keepAlive: true,
});

const MPV_PLAYER_PATH = 'MPV_PLAYER_PATH';
const VLC_PLAYER_PATH = 'VLC_PLAYER_PATH';

export class Api {
    /** Instance of the main application window */
    mainWindow: BrowserWindow;

    /** Default user agent stored as a fallback value */
    defaultUserAgent: string;

    /** Default referer url value */
    defaultReferer: string;

    /** Instance of the epg browser window */
    workerWindow: BrowserWindow;

    store;

    mpv;

    settings;

    server;

    updateSources = [
        'https://github.com/CGG888/iptvnator/releases/latest/download/iptvnator.exe',
        'https://ghproxy.com/https://github.com/CGG888/iptvnator/releases/latest/download/iptvnator.exe',
    ];

    constructor(store) {
        this.server = new Server(this);
        this.store = store;
        this.mpv = this.createMpvInstance();
        this.mpv
            .on('quit', () => (this.mpv = null))
            .on('crash', () => (this.mpv = null));

        ipcMain
            .on(PLAYLIST_PARSE_BY_URL, (event, args) => {
                try {
                    axios
                        .get(args.url, { httpsAgent: agent })
                        .then((result) => {
                            const parsedPlaylist = this.parsePlaylist(
                                result.data
                            );
                            const playlistObject = createPlaylistObject(
                                args.title,
                                parsedPlaylist,
                                args.url,
                                'URL'
                            );
                            event.sender.send(PLAYLIST_PARSE_RESPONSE, {
                                payload: playlistObject,
                            });
                        })
                        .catch((err) => {
                            event.sender.send(ERROR, {
                                message: err.response.statusText,
                                status: err.response.status,
                            });
                        });
                } catch (err) {
                    event.sender.send(ERROR, {
                        message: err.response.statusText,
                        status: err.response.status,
                    });
                }
            })
            .on(OPEN_FILE, (event, args) => {
                fs.readFile(
                    args.filePath,
                    'utf-8',
                    (err: NodeJS.ErrnoException, data: string) => {
                        if (err) {
                            console.log(
                                'An error ocurred reading the file :' +
                                    err.message
                            );
                            return;
                        }

                        const parsedPlaylist = this.parsePlaylist(data);
                        const playlistObject = createPlaylistObject(
                            args.fileName,
                            parsedPlaylist,
                            args.filePath,
                            'FILE'
                        );

                        event.sender.send(PLAYLIST_PARSE_RESPONSE, {
                            payload: playlistObject,
                        });
                    }
                );
            })
            .on(
                PLAYLIST_UPDATE,
                (
                    event,
                    args: {
                        id: string;
                        title: string;
                        filePath?: string;
                        url?: string;
                    }
                ) => {
                    if (args.filePath && args.id) {
                        this.fetchPlaylistByFilePath(args, event);
                    } else if (args.url && args.id) {
                        this.fetchPlaylistByUrl(args, event);
                    }
                }
            )
            .on(
                CHANNEL_SET_USER_AGENT,
                (_event, args: { userAgent?: string; referer?: string }) => {
                    if (args && (args.userAgent !== undefined || args.referer !== undefined)) {
                        this.setUserAgent(args.userAgent, args.referer);
                    }
                }
            )
            .on(IS_PLAYLISTS_MIGRATION_POSSIBLE, (event) => {
                db.count({
                    type: { $exists: false },
                }).then((count: number) => {
                    event.sender.send(
                        IS_PLAYLISTS_MIGRATION_POSSIBLE_RESPONSE,
                        {
                            result: count > 0,
                            message:
                                count > 0
                                    ? `${count} playlists were found, which can be migrated from the database used in the last version of the application.`
                                    : 'No playlists for migration',
                        }
                    );
                });
            })
            .on(
                AUTO_UPDATE_PLAYLISTS,
                // eslint-disable-next-line @typescript-eslint/no-misused-promises
                async (event, playlists: Partial<Playlist>[]) => {
                    const results: any[] = [];
                    let playlist: any;
                    for (const element of playlists) {
                        if (element.url && element._id) {
                            playlist = await this.fetchPlaylistByUrl({
                                id: element._id,
                                title: element.title || '',
                                url: element.url,
                            });
                            results.push(playlist);
                        } else if (element.filePath && element._id) {
                            playlist = await this.fetchPlaylistByFilePath({
                                id: element._id,
                                title: element.title || '',
                                filePath: element.filePath,
                            });
                            results.push(playlist);
                        }
                    }
                    event.sender.send(
                        AUTO_UPDATE_PLAYLISTS_RESPONSE,
                        results.filter((item) => item !== undefined)
                    );
                }
            )
            .on(MIGRATE_PLAYLISTS, (event) => {
                this.getAllPlaylists().then((playlists) => {
                    event.sender.send(MIGRATE_PLAYLISTS_RESPONSE, {
                        payload: playlists,
                    });
                });
            })
            .on(DELETE_ALL_PLAYLISTS, (event) => {
                this.removeAllPlaylists(event);
            })
            // eslint-disable-next-line @typescript-eslint/no-misused-promises
            .on(OPEN_MPV_PLAYER, async (event, { url }) => {
                try {
                    if (this.mpv === null) {
                        this.mpv = this.createMpvInstance();
                    }
                    if (this.mpv.isRunning()) {
                        await this.mpv.load(url);
                    } else {
                        await this.mpv.start();
                        await this.mpv.load(url);
                    }
                } catch (error) {
                    console.log(error);
                    event.sender.send(ERROR, {
                        message: `Error: ${
                            // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
                            error?.verbose ??
                            'Something went wrong. Make sure that mpv player is installed on your system.'
                        } `,
                    });
                }
            })
            .on(SET_MPV_PLAYER_PATH, (_event, mpvPlayerPath) => {
                console.log('... setting mpv player path', mpvPlayerPath);
                const oldPath = store.get(MPV_PLAYER_PATH);
                store.set(MPV_PLAYER_PATH, mpvPlayerPath);

                // recreate mpv player instance with new binary path if it was changed
                if (oldPath !== mpvPlayerPath) {
                    if (this.mpv) {
                        try {
                            // Try to quit if possible
                            // Note: node-mpv might not expose .quit() directly or it might be async
                            // We just null it out so createMpvInstance makes a new one
                        } catch (e) {
                            console.error('Error handling old mpv instance:', e);
                        }
                        this.mpv = null;
                    }
                    // Re-instantiate immediately to check if path is valid
                    this.mpv = this.createMpvInstance();
                }
            })
            .on(OPEN_VLC_PLAYER, (event, { url }) => {
                const proc = child_process.spawn(
                    this.getVlcPath(),
                    [`"${url as string}"`],
                    {
                        shell: true,
                    }
                );

                proc.on('exit', (code) => {
                    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
                    console.log(`VLC exited with code ${code}`);
                });
            })
            .on(SET_VLC_PLAYER_PATH, (_event, vlcPlayerPath) => {
                console.log('... setting vlc player path', vlcPlayerPath);
                store.set(VLC_PLAYER_PATH, vlcPlayerPath);
            })
            .on(SETTINGS_UPDATE, (_event, arg) => {
                this.settings = arg;
                this.server.updateSettings();
            })
            // eslint-disable-next-line @typescript-eslint/no-misused-promises
            .on(APP_UPDATE_CHECK, async (event, arg: { mode?: string; latest?: string }) => {
                const mode = (arg?.mode ?? 'auto').toLowerCase();
                const sendProgress = (payload) =>
                    event.sender.send(APP_UPDATE_PROGRESS, payload);

                try {
                    // 1) Build deterministic download URL by latest version (fast path)
                    if (!arg?.latest) {
                        event.sender.send(APP_UPDATE_ERROR, {
                            message: 'Missing latest version for update.',
                        });
                        return;
                    }
                    const vTag = arg.latest.startsWith('v')
                        ? arg.latest
                        : `v${arg.latest}`;
                    const platform = process.platform;
                    const arch = process.arch;
                    const filename = (() => {
                        if (platform === 'win32') {
                            return `IPTVnator-Setup-${arg.latest}.exe`;
                        } else if (platform === 'linux') {
                            if (arch.includes('arm64'))
                                return `IPTVnator-${arg.latest}-arm64.AppImage`;
                            if (arch.includes('arm'))
                                return `IPTVnator-${arg.latest}-armv7l.AppImage`;
                            return `IPTVnator-${arg.latest}.AppImage`;
                        } else if (platform === 'darwin') {
                            return `IPTVnator-${arg.latest}.dmg`;
                        }
                        return `IPTVnator-Setup-${arg.latest}.exe`;
                    })();
                    const githubUrl = `https://github.com/CGG888/iptvnator/releases/download/${vTag}/${filename}`;
                    // If the same-version installer already exists in temp, reuse it
                    try {
                        const cached = path.join(app.getPath('temp'), filename);
                        const st = fs.statSync(cached);
                        if (st && st.size > 1024 * 1024) {
                            event.sender.send(APP_UPDATE_DONE, { file: cached, url: 'local-cache' });
                            return;
                        }
                    } catch {}
                    const cdnCandidates: string[] = [
                        `https://gh-proxy.org/${githubUrl}`,
                        `https://hk.gh-proxy.org/${githubUrl}`,
                        `https://cdn.gh-proxy.org/${githubUrl}`,
                        `https://download.fastgit.org/CGG888/iptvnator/releases/download/${vTag}/${filename}`,
                        `https://download.nuaa.cf/CGG888/iptvnator/releases/download/${vTag}/${filename}`,
                        `https://download.nju.edu.cn/github-release/CGG888/iptvnator/${vTag}/${filename}`,
                    ];
                    const officialCandidates: string[] = [githubUrl];
                    const allCandidates = [...officialCandidates, ...cdnCandidates];
                    sendProgress({ phase: 'selecting', asset: filename, version: vTag });

                    const probe = async (url: string) => {
                        const start = Date.now();
                        try {
                            await axios.head(url, {
                                timeout: 1500,
                                httpsAgent: agent,
                                headers: {
                                    'User-Agent':
                                        this.defaultUserAgent || 'Mozilla/5.0',
                                },
                                maxRedirects: 5,
                                validateStatus: (s) => s >= 200 && s < 400,
                            });
                            return { url, rtt: Date.now() - start, ok: true };
                        } catch {
                            try {
                                await axios.get(url, {
                                    headers: {
                                        Range: 'bytes=0-0',
                                        'User-Agent': this.defaultUserAgent || 'Mozilla/5.0',
                                    },
                                    timeout: 1500,
                                    httpsAgent: agent,
                                    maxRedirects: 5,
                                    validateStatus: (s) => s >= 200 && s < 400,
                                });
                                return { url, rtt: Date.now() - start, ok: true };
                            } catch {
                                return { url, rtt: -1, ok: false };
                            }
                        }
                    };

                    const pickFirstOk = async (urls: string[], deadline = 1600) => {
                        return new Promise<{ url: string; rtt: number } | null>(
                            (resolve) => {
                                let settled = false;
                                const timer = setTimeout(() => {
                                    if (!settled) resolve(null);
                                }, deadline);
                                urls.forEach(async (u) => {
                                    const r = await probe(u);
                                    if (!settled && r.ok) {
                                        settled = true;
                                        clearTimeout(timer);
                                        resolve({ url: r.url, rtt: r.rtt });
                                    }
                                });
                            }
                        );
                    };

                    let target = officialCandidates[0];
                    if (mode === 'cdn') {
                        const r = await pickFirstOk(cdnCandidates, 2200);
                        target = r?.url ?? cdnCandidates[0] ?? target;
                        if (r) sendProgress({ phase: 'probing', url: r.url, rtt: r.rtt });
                    } else if (mode === 'auto') {
                        const cdnPromise = pickFirstOk(cdnCandidates, 2200);
                        const offPromise = pickFirstOk(officialCandidates, 1400);
                        const [cdnRes, offRes] = await Promise.all([cdnPromise, offPromise]);
                        if (cdnRes) {
                            target = cdnRes.url;
                            sendProgress({ phase: 'probing', url: cdnRes.url, rtt: cdnRes.rtt });
                        } else if (offRes) {
                            target = offRes.url;
                            sendProgress({ phase: 'probing', url: offRes.url, rtt: offRes.rtt });
                        } else {
                            target = cdnCandidates[0] ?? target;
                        }
                    } else if (mode === 'github') {
                        target = officialCandidates[0];
                    }

                    // 4) Download with validation and graceful fallback
                    sendProgress({
                        phase: 'downloading',
                        url: target,
                        asset: filename,
                        version: vTag,
                        progress: 0,
                    });
                    const tryUrls = [target, ...officialCandidates.filter((u) => u !== target)];
                    const headers = {
                        'User-Agent':
                            this.defaultUserAgent ||
                            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari',
                        Accept: '*/*',
                    };
                    let savedFile = '';
                    let lastErr: any;
                    for (const urlToTry of tryUrls) {
                        try {
                            const res = await axios.get(urlToTry, {
                                responseType: 'stream',
                                httpsAgent: agent,
                                headers,
                                maxRedirects: 10,
                                timeout: 20000,
                                validateStatus: (s) => s >= 200 && s < 400,
                            });
                            const contentType = (res.headers['content-type'] || '').toString();
                            if (
                                contentType.includes('text') ||
                                contentType.includes('html') ||
                                contentType.includes('json')
                            ) {
                                throw new Error(
                                    `Unexpected content-type: ${contentType}`
                                );
                            }
                            const total = Number(res.headers['content-length'] || 0);
                            sendProgress({
                                phase: 'downloading',
                                url: urlToTry,
                                asset: filename,
                                version: vTag,
                                total,
                                received: 0,
                                indeterminate: total <= 0,
                                progress: total > 0 ? 0 : undefined,
                                speed: 0,
                            });
                            const tempFile = path.join(app.getPath('temp'), filename);
                            await new Promise<void>((resolve, reject) => {
                                const writer = fs.createWriteStream(tempFile);
                                let received = 0;
                                let lastEmit = Date.now();
                                let lastMarkBytes = 0;
                                let lastMarkTime = Date.now();
                                let speedAvg = 0; // bytes/sec EWMA
                                res.data.on('data', (chunk) => {
                                    received += chunk.length;
                                    const now = Date.now();
                                    // update speed (EWMA over ~0.3 factor)
                                    const dt = (now - lastMarkTime) / 1000;
                                    if (dt > 0) {
                                        const inst = (received - lastMarkBytes) / dt;
                                        speedAvg =
                                            speedAvg === 0
                                                ? inst
                                                : speedAvg * 0.7 + inst * 0.3;
                                        lastMarkBytes = received;
                                        lastMarkTime = now;
                                    }
                                    if (now - lastEmit < 200) return; // throttle UI updates
                                    lastEmit = now;
                                    const payload: any = {
                                        phase: 'downloading',
                                        url: urlToTry,
                                        asset: filename,
                                        version: vTag,
                                        total,
                                        received,
                                        indeterminate: total <= 0,
                                        speed: Math.max(0, Math.round(speedAvg)),
                                    };
                                    if (total > 0) {
                                        const pct = Math.min(
                                            100,
                                            Math.round((received / total) * 100)
                                        );
                                        payload.progress = pct;
                                    }
                                    sendProgress(payload);
                                });
                                res.data.on('error', (err) => reject(err));
                                res.data.pipe(writer);
                                writer.on('finish', () => {
                                    // final progress update to 100% when total known
                                    try {
                                        const payload: any = {
                                            phase: 'downloading',
                                            url: urlToTry,
                                            asset: filename,
                                            version: vTag,
                                            total,
                                            received,
                                            indeterminate: total <= 0,
                                            speed: 0,
                                        };
                                        if (total > 0) {
                                            payload.progress = 100;
                                        }
                                        sendProgress(payload);
                                    } catch {}
                                    resolve();
                                });
                                writer.on('error', (err) => reject(err));
                            });
                            // quick size sanity check: file must be > 1MB for installer
                            try {
                                const stat = fs.statSync(tempFile);
                                if (stat.size < 1024 * 1024) {
                                    throw new Error(
                                        `Downloaded file too small: ${stat.size}`
                                    );
                                }
                            } catch (e) {
                                throw e;
                            }
                            savedFile = tempFile;
                            event.sender.send(APP_UPDATE_DONE, {
                                file: savedFile,
                                url: urlToTry,
                            });
                            lastErr = null;
                            break;
                        } catch (e) {
                            lastErr = e;
                            continue;
                        }
                    }
                    if (lastErr) {
                        throw lastErr;
                    }
                } catch (error) {
                    event.sender.send(APP_UPDATE_ERROR, {
                        message: error?.message ?? 'Unknown error while updating',
                    });
                }
            })
            .on(APP_UPDATE_INSTALL, (_event, payload: { file: string }) => {
                try {
                    const installer = payload?.file;
                    if (!installer) return;
                    const proc = child_process.spawn(`"${installer}"`, [], {
                        shell: true,
                        detached: true,
                        stdio: 'ignore',
                    });
                    proc.unref();
                    app.quit();
                    process.exit(0);
                } catch (e) {
                    console.error('Failed to start installer', e);
                }
            })
            .on(APP_UPDATE_TEST, async (event, arg: { mode?: string; latest?: string; url?: string }) => {
                const log = (message: string) =>
                    event.sender.send(APP_UPDATE_PROGRESS, { phase: 'log', message });
                try {
                    const platform = process.platform;
                    const arch = process.arch;
                    const vRaw = arg?.latest;
                    const vTag = vRaw?.startsWith('v') ? vRaw : vRaw ? `v${vRaw}` : null;
                    const filename = (() => {
                        if (platform === 'win32') return `IPTVnator-Setup-${vRaw}.exe`;
                        if (platform === 'linux') {
                            if (arch.includes('arm64')) return `IPTVnator-${vRaw}-arm64.AppImage`;
                            if (arch.includes('arm')) return `IPTVnator-${vRaw}-armv7l.AppImage`;
                            return `IPTVnator-${vRaw}.AppImage`;
                        }
                        return `IPTVnator-${vRaw}.dmg`;
                    })();
                    const official = vTag
                        ? `https://github.com/CGG888/iptvnator/releases/download/${vTag}/${filename}`
                        : null;
                    const mode = (arg?.mode ?? 'auto').toLowerCase();
                    const githubUrl = official;
                    const cdnCandidates: string[] = githubUrl
                        ? [
                              `https://gh-proxy.org/${githubUrl}`,
                              `https://hk.gh-proxy.org/${githubUrl}`,
                              `https://cdn.gh-proxy.org/${githubUrl}`,
                              `https://mirror.ghproxy.com/${githubUrl}`,
                              `https://ghproxy.com/${githubUrl}`,
                              `https://github.moeyy.xyz/${githubUrl}`,
                              `https://gh.con.sh/${githubUrl}`,
                              `https://download.fastgit.org/CGG888/iptvnator/releases/download/${vTag}/${filename}`,
                              `https://download.nuaa.cf/CGG888/iptvnator/releases/download/${vTag}/${filename}`,
                              `https://download.nju.edu.cn/github-release/CGG888/iptvnator/${vTag}/${filename}`,
                          ]
                        : [];
                    const officialCandidates: string[] = githubUrl ? [githubUrl] : [];
                    let all: string[] = [];
                    if (arg?.url) {
                        all = [arg.url];
                    } else if (mode === 'github') {
                        all = officialCandidates;
                    } else if (mode === 'cdn') {
                        all = cdnCandidates;
                    } else {
                        all = [...officialCandidates, ...cdnCandidates];
                    }

                    const testOne = async (label: string, urlToTest: string) => {
                        log(`test url: ${urlToTest}`);
                        try {
                            const host = new URL(urlToTest).hostname;
                            await new Promise<void>((resolve) => {
                                dns.lookup(host, { all: true }, (err, addresses) => {
                                    if (err) {
                                        log(`DNS error: ${err.message}`);
                                    } else if (!addresses?.length) {
                                        log(`DNS empty for ${host}`);
                                    } else {
                                        const ips = addresses.map((a) => `${a.address}/${a.family}`).join(', ');
                                        log(`DNS ${host} -> ${ips}`);
                                    }
                                    resolve();
                                });
                            });
                        } catch {}
                        try {
                            const h = await axios.head(urlToTest, {
                                timeout: 7000,
                                httpsAgent: agent,
                                headers: { 'User-Agent': this.defaultUserAgent || 'Mozilla/5.0' },
                                maxRedirects: 5,
                                validateStatus: (s) => s >= 200 && s < 400,
                            });
                            log(`HEAD ok status=${h.status} len=${h.headers['content-length'] || 'n/a'} type=${h.headers['content-type'] || 'n/a'}`);
                        } catch (e) {
                            log(`HEAD error: ${e?.message || e}`);
                        }
                        try {
                            const r = await axios.get(urlToTest, {
                                headers: {
                                    Range: 'bytes=0-0',
                                    'User-Agent': this.defaultUserAgent || 'Mozilla/5.0',
                                },
                                timeout: 8000,
                                httpsAgent: agent,
                                maxRedirects: 10,
                                responseType: 'arraybuffer',
                                validateStatus: (s) => s >= 200 && s < 400,
                            });
                            log(`RANGE ok status=${r.status} len=${r.headers['content-length'] || 'n/a'} type=${r.headers['content-type'] || 'n/a'}`);
                        } catch (e) {
                            log(`RANGE error: ${e?.message || e}`);
                        }
                        try {
                            const s = await axios.get(urlToTest, {
                                responseType: 'stream',
                                httpsAgent: agent,
                                headers: {
                                    'User-Agent': this.defaultUserAgent || 'Mozilla/5.0',
                                    Accept: '*/*',
                                },
                                timeout: 10000,
                                maxRedirects: 10,
                                validateStatus: (st) => st >= 200 && st < 400,
                            });
                            let got = 0;
                            await new Promise<void>((resolve, reject) => {
                                const onData = (chunk) => {
                                    got += chunk.length;
                                    if (got >= 64 * 1024) {
                                        try {
                                            s.data.destroy();
                                        } catch {}
                                        resolve();
                                    }
                                };
                                s.data.on('data', onData);
                                s.data.on('error', (err) => reject(err));
                                s.data.on('end', () => resolve());
                                setTimeout(() => {
                                    try {
                                        s.data.destroy();
                                    } catch {}
                                    resolve();
                                }, 8000);
                            });
                            log(`STREAM ok firstBytes=${got}`);
                        } catch (e) {
                            log(`STREAM error: ${e?.message || e}`);
                        }
                    };

                    for (const u of all) {
                        await testOne('url', u);
                    }
                    log('test done');
                } catch (e) {
                    event.sender.send(APP_UPDATE_PROGRESS, {
                        phase: 'log',
                        message: e?.message || 'unknown error',
                    });
                }
            });

    // listener for logo cache requests
    ipcMain.on(CACHE_LOGO, async (event, logoUrl: string) => {
        if (!logoUrl || !logoUrl.startsWith('http')) {
            // Invalid or local URL, return as is
            event.sender.send(CACHE_LOGO_RESPONSE, { url: logoUrl, original: logoUrl });
            return;
        }

        try {
            // Create a hash of the URL to use as filename
            const hash = crypto.createHash('md5').update(logoUrl).digest('hex');
            // Try to guess extension or default to .png
            let ext = path.extname(logoUrl).split('?')[0] || '.png';
            if (!['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'].includes(ext.toLowerCase())) {
                ext = '.png';
            }
            const filename = `${hash}${ext}`;
            const localPath = path.join(LOGO_CACHE_DIR, filename);
            
            // Check if file exists
            try {
                await fsPromises.access(localPath);
                // File exists, return local path (as file:// URL)
                event.sender.send(CACHE_LOGO_RESPONSE, { 
                    url: `file://${localPath}`, 
                    original: logoUrl 
                });
                return;
            } catch {
                // File doesn't exist, proceed to download
            }

            const response = await axios.get(logoUrl, { 
                responseType: 'arraybuffer',
                timeout: 10000 
            });
            
            await fsPromises.writeFile(localPath, response.data);
            
            event.sender.send(CACHE_LOGO_RESPONSE, { 
                url: `file://${localPath}`, 
                original: logoUrl 
            });

        } catch (error) {
            // On error, return original URL so the image can still try to load normally
            // console.error('Failed to cache logo:', logoUrl, error.message);
            event.sender.send(CACHE_LOGO_RESPONSE, { url: logoUrl, original: logoUrl });
        }
    });

        // listeners for EPG events
        ipcMain
            .on(EPG_GET_PROGRAM, (_event, arg) =>
                this.workerWindow.webContents.send(EPG_GET_PROGRAM, arg)
            )
            .on(EPG_GET_CHANNELS, (_event, arg) =>
                this.workerWindow.webContents.send(EPG_GET_CHANNELS, arg)
            )
            .on(EPG_GET_CHANNELS_DONE, (_event, arg) =>
                this.mainWindow.webContents.send(EPG_GET_CHANNELS_DONE, arg)
            )
            .on(EPG_GET_PROGRAM_DONE, (_event, arg) => {
                this.mainWindow.webContents.send(EPG_GET_PROGRAM_DONE, arg);
            })
            .on(EPG_FETCH, (_event, arg) =>
                this.workerWindow.webContents.send(EPG_FETCH, arg?.url)
            )
            .on(EPG_FETCH_DONE, (_event, arg) =>
                this.mainWindow.webContents.send(EPG_FETCH_DONE, arg)
            )
            .on(EPG_ERROR, (_event, arg) =>
                this.mainWindow.webContents.send(EPG_ERROR, arg)
            )
            .on(EPG_GET_CHANNELS_BY_RANGE, (_event, arg) => {
                this.workerWindow.webContents.send(
                    EPG_GET_CHANNELS_BY_RANGE,
                    arg
                );
            })
            .on(EPG_GET_CHANNELS_BY_RANGE_RESPONSE, (_event, arg) =>
                this.mainWindow.webContents.send(
                    EPG_GET_CHANNELS_BY_RANGE_RESPONSE,
                    arg
                )
            )
            .on(EPG_FORCE_FETCH, (_event, arg) =>
                this.workerWindow.webContents.send(EPG_FORCE_FETCH, arg)
            );

        ipcMain
            .on(
                XTREAM_REQUEST,
                (
                    event,
                    arg: { url: string; params: Record<string, string> }
                ) => {
                    const xtreamApiPath = '/player_api.php';

                    axios
                        .get(arg.url + xtreamApiPath, {
                            params: arg.params ?? {},
                        })
                        .then((result) => {
                            event.sender.send(XTREAM_RESPONSE, {
                                payload: result.data,
                                action: arg.params.action,
                            });
                        })
                        .catch((err) => {
                            event.sender.send(ERROR, {
                                message:
                                    err.response?.statusText ??
                                    'Error: not found',
                                status: err.response?.status ?? 404,
                            });
                        });
                }
            )
            .on(STALKER_REQUEST, (event, arg: any) => {
                axios
                    .get(arg.url, {
                        params: arg.params ?? {},
                        headers: {
                            Cookie: `mac=${arg.macAddress as string}`,
                            ...(arg.params.token
                                ? {
                                      Authorization: `Bearer ${
                                          arg.params.token as string
                                      }`,
                                  }
                                : {}),
                        },
                    })
                    .then((result) => {
                        event.sender.send(STALKER_RESPONSE, {
                            payload: result.data,
                            action: arg.params.action,
                        });
                    })
                    .catch((err) => {
                        event.sender.send(ERROR, {
                            message:
                                err.response?.statusText ?? 'Error: not found',
                            status: err.response?.status ?? 404,
                        });
                    });
            });
    }

    createMpvInstance() {
        let mpvPlayerPath = this.store.get(MPV_PLAYER_PATH);
        console.log('... getting mpv player path', mpvPlayerPath);
        
        // Sanitize path for Windows if needed (remove quotes if present)
        if (mpvPlayerPath) {
            mpvPlayerPath = mpvPlayerPath.replace(/^"|"$/g, '');
        }

        return new mpvAPI(
            { ...(mpvPlayerPath ? { binary: mpvPlayerPath } : {}) },
            ['--autofit=70%', '--hwdec=auto']
        );
    }

    /**
     * Sets the user agent header for all http requests
     * @param userAgent user agent to use
     * @param referer referer to use
     */
    setUserAgent(userAgent?: string, referer?: string): void {
        const ua = userAgent && userAgent.trim().length ? userAgent : this.defaultUserAgent;
        let origin: string | undefined;
        if (referer && referer.trim().length) {
            try {
                origin = new URL(referer).origin;
            } catch {
                origin = undefined;
            }
        }
        session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
            details.requestHeaders['User-Agent'] = ua;
            if (referer && referer.trim().length) {
                details.requestHeaders['Referer'] = referer;
                if (origin) details.requestHeaders['Origin'] = origin;
            } else {
                delete details.requestHeaders['Referer'];
                delete details.requestHeaders['Origin'];
            }
            callback({ requestHeaders: details.requestHeaders });
        });
        console.log(`Success: Set "${ua}" as user agent header${referer ? `, referer=${referer}` : ''}`);
    }

    /**
     * Sets epg browser window
     * @param workerWindow
     */
    setEpgWorkerWindow(workerWindow: BrowserWindow): void {
        this.workerWindow = workerWindow;

        // store default user agent as fallback
        this.defaultUserAgent = this.workerWindow.webContents.getUserAgent();
    }

    /**
     * Sets browser window of the main app window
     * @param mainWindow
     */
    setMainWindow(mainWindow: BrowserWindow): void {
        this.mainWindow = mainWindow;
    }

    /**
     * Converts the fetched playlist string to the playlist object, updates it  in the database and sends the updated playlists array back to the renderer
     * @param id id of the playlist to update
     * @param playlistString updated playlist as string
     */
    getRefreshedPlaylist(
        args: { id: string; title: string; filePath?: string; url?: string },
        playlistString: string
    ) {
        const parsedPlaylist: ParsedPlaylist =
            this.parsePlaylist(playlistString);
        const playlist = createPlaylistObject(
            args.title,
            parsedPlaylist,
            args.url ? args.url : args.filePath,
            args.url ? 'URL' : 'FILE'
        );
        return {
            ...playlist,
            _id: args.id,
        };
    }

    sendPlaylistRefreshResponse(
        playlistId: string,
        playlist: Playlist,
        event: Electron.IpcMainEvent
    ) {
        event.sender.send(PLAYLIST_UPDATE_RESPONSE, {
            message: `Success! The playlist was successfully updated (${
                (playlist.playlist.items as Channel[]).length
            } channels)`,
            playlist: {
                ...playlist,
                _id: playlistId,
            },
        });
    }

    /**
     * Fetches the playlist from the given url and triggers the update operation
     * @param id id of the playlist to update
     * @param playlistString updated playlist as string
     * @param event ipc event to send the response back to the renderer
     */
    async fetchPlaylistByUrl(
        args: { id: string; title: string; url?: string },
        event?: Electron.IpcMainEvent
    ) {
        if (!args.url) return;
        try {
            const result = await axios.get(args.url, { httpsAgent: agent });

            const refreshedPlaylist = this.getRefreshedPlaylist(
                args,
                result.data
            );
            if (event) {
                this.sendPlaylistRefreshResponse(
                    refreshedPlaylist._id,
                    refreshedPlaylist,
                    event
                );
            } else {
                return refreshedPlaylist;
            }
        } catch (err) {
            if (event)
                event.sender.send(ERROR, {
                    message: `File not found. Please check the entered playlist URL again.`,
                    status: err.response?.status,
                });
        }
    }

    /**
     * Fetches the playlist from the given path from the file system and triggers the update operation
     * @param id id of the playlist to update
     * @param playlistString updated playlist as string
     * @param event ipc event to send the response back to the renderer
     */
    async fetchPlaylistByFilePath(
        args: { id: string; title: string; filePath?: string },
        event?: Electron.IpcMainEvent
    ) {
        if (!args.filePath) return;
        let refreshedPlaylist: Playlist;

        try {
            const playlist = await fsPromises.readFile(args.filePath, 'utf-8');
            refreshedPlaylist = this.getRefreshedPlaylist(args, playlist);

            if (event) {
                this.sendPlaylistRefreshResponse(
                    refreshedPlaylist._id,
                    refreshedPlaylist,
                    event
                );
            } else {
                return refreshedPlaylist;
            }
        } catch (err) {
            return;
        }
    }

    /** Sends an error message to the renderer process */
    handleFileNotFoundError(
        error: {
            errno: string;
            code: string;
            syscall: string;
            path: string;
        },
        event?: Electron.IpcMainEvent
    ): void {
        console.error(error);
        if (event) {
            event.sender.send(ERROR, {
                message: `Sorry, playlist was not found (${error.path})`,
                status: 'ENOENT',
            });
        }
    }

    /**
     * Parses string based array to playlist object
     * @param m3uString m3u playlist as string
     */
    parsePlaylist(m3uString: string): ParsedPlaylist {
        return parse(m3uString);
    }

    getDefaultVlcPath() {
        if (process.platform === 'win32') {
            return path.join(
                'C:',
                'Program Files (x86)',
                'VideoLAN',
                'VLC',
                'vlc.exe'
            );
        } else if (process.platform === 'linux') {
            return '/usr/bin/vlc';
        } else if (process.platform === 'darwin') {
            return '/Applications/VLC.app/Contents/MacOS/VLC';
        }
    }

    getVlcPath() {
        const customVlcPath = this.store.get(VLC_PLAYER_PATH);
        if (customVlcPath) {
            return customVlcPath;
        } else {
            return this.getDefaultVlcPath();
        }
    }

    /** @deprecated - used only for migration */
    getAllPlaylists() {
        return db
            .find({ type: { $exists: false } })
            .sort({ position: 1, importDate: -1 });
    }

    /** @deprecated - used only for migration */
    async removeAllPlaylists(event: Electron.IpcMainEvent) {
        const removeCount = await db.remove({}, { multi: true });
        console.info(removeCount, ' playlists were removed');
        fs.unlink(dbPath, (err) => {
            if (err && err.code == 'ENOENT') {
                console.info("File doesn't exist, won't remove it.");
            } else if (err) {
                console.error('Error occurred while trying to remove file');
            } else {
                console.info(`${dbPath} was deleted`);
                event.sender.send(IS_PLAYLISTS_MIGRATION_POSSIBLE_RESPONSE, {
                    result: false,
                });
            }
        });
    }

}
