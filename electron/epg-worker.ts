const electron = require('electron');
const ipcRenderer = electron.ipcRenderer;
const zlib = require('zlib');
const parser = require('epg-parser');
const axios = require('axios');
import {
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
} from '../shared/ipc-commands';
import { EpgChannel } from '../src/app/player/models/epg-channel.model';
import { EpgProgram } from '../src/app/player/models/epg-program.model';

// EPG data store
let EPG_DATA: { channels: EpgChannel[]; programs: EpgProgram[] } = {
    channels: [],
    programs: [],
};
let EPG_DATA_MERGED: {
    [id: string]: EpgChannel & { programs: EpgProgram[] };
} = {};
const loggerLabel = '[EPG Worker]';

/** List with fetched EPG URLs */
const fetchedUrls: string[] = [];

// --- Fast Lookup Maps ---
/** Map: tvg-id -> EpgChannel */
const epgIdMap = new Map<string, EpgChannel>();
/** Map: normalized_name -> EpgChannel */
const epgNameMap = new Map<string, EpgChannel>();

/**
 * Builds the fast lookup maps from EPG data
 */
const buildEpgMaps = () => {
    console.log(loggerLabel, 'building fast lookup maps...');
    // Clear existing maps if we are rebuilding (though typically we append)
    // But since we append to EPG_DATA, we should probably clear and rebuild or just add new ones.
    // For safety, let's rebuild from scratch based on current EPG_DATA.channels
    epgIdMap.clear();
    epgNameMap.clear();

    if (!EPG_DATA || !EPG_DATA.channels) return;

    for (const ch of EPG_DATA.channels) {
        // 1. Map by ID
        if (ch.id) {
            epgIdMap.set(ch.id, ch);
        }

        // 2. Map by Name (Normalized)
        if (ch.name && Array.isArray(ch.name)) {
            for (const n of ch.name) {
                if (n.value) {
                    const norm = normalize(n.value);
                    if (norm) {
                        // If conflict, first one wins (or maybe we should store array?)
                        // For simple matching, first one is usually fine.
                        if (!epgNameMap.has(norm)) {
                            epgNameMap.set(norm, ch);
                        }
                    }
                    // Also map the raw trimmed name for exact match
                    const raw = n.value.trim();
                    if (raw && !epgNameMap.has(raw)) {
                        epgNameMap.set(raw, ch);
                    }
                     // Also map the lowercased raw name
                    const lower = raw.toLowerCase();
                    if (lower && !epgNameMap.has(lower)) {
                        epgNameMap.set(lower, ch);
                    }
                }
            }
        }
    }
    console.log(loggerLabel, `maps built. IDs: ${epgIdMap.size}, Names: ${epgNameMap.size}`);
};

/**
 * Fetches the epg data from the given url
 * @param epgUrl url of the epg file
 */
const fetchEpgDataFromUrl = (epgUrl: string) => {
    try {
        let axiosConfig = {};
        if (epgUrl.endsWith('.gz')) {
            axiosConfig = {
                responseType: 'arraybuffer',
            };
        }
        axios
            .get(epgUrl.trim(), axiosConfig)
            .then((response) => {
                console.log(loggerLabel, 'url content was fetched...');
                const { data } = response;
                if (epgUrl.endsWith('.gz')) {
                    console.log(loggerLabel, 'start unzipping...');
                    zlib.gunzip(data, (_err, output) => {
                        parseAndSetEpg(output);
                    });
                } else {
                    parseAndSetEpg(data);
                }
            })
            .catch((err) => {
                console.log(loggerLabel, err);
                ipcRenderer.send(EPG_ERROR);
            });
    } catch (error) {
        console.log(loggerLabel, error);
        ipcRenderer.send(EPG_ERROR);
    }
};

/**
 * Parses and sets the epg data
 * @param xmlString xml file content from the fetched url as string
 */
const parseAndSetEpg = (xmlString) => {
    console.log(loggerLabel, 'start parsing...');
    const parsedEpg = parser.parse(xmlString.toString());
    EPG_DATA = {
        channels: [...EPG_DATA.channels, ...parsedEpg.channels],
        programs: [...EPG_DATA.programs, ...parsedEpg.programs],
    };
    // map programs to channels
    EPG_DATA_MERGED = convertEpgData();
    buildEpgMaps(); // Build index
    ipcRenderer.send(EPG_FETCH_DONE);
    console.log(loggerLabel, 'done, parsing was finished...');
};

const convertEpgData = () => {
    const result: {
        [id: string]: EpgChannel & { programs: EpgProgram[] };
    } = {};

    EPG_DATA?.programs?.forEach((program) => {
        if (!result[program.channel]) {
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
            const channel = EPG_DATA?.channels?.find(
                (channel) => channel.id === program.channel
            ) as EpgChannel;
            result[program.channel] = {
                ...channel,
                programs: [program],
            };
        } else {
            result[program.channel] = {
                ...result[program.channel],
                programs: [...result[program.channel].programs, program],
            };
        }
    });
    return result;
};

// fetches epg data from the provided URL
ipcRenderer.on(EPG_FETCH, (event, epgUrl: string) => {
    console.log(loggerLabel, 'epg fetch command was triggered');
    if (fetchedUrls.indexOf(epgUrl) > -1) {
        ipcRenderer.send(EPG_FETCH_DONE);
        return;
    }
    fetchedUrls.push(epgUrl);
    fetchEpgDataFromUrl(epgUrl);
});

// --- Improved matching utils for channel <-> EPG ---
const normalize = (str: string) => {
    if (!str) return '';
    return String(str)
        .toLowerCase()
        .replace(/\s+/g, '')
        .replace(/[【】\[\]\(\)\-_.·]/g, '')
        .replace(/频道|频道高清|频道超清|频道超高清|频道标清|台/g, '')
        .replace(/超高清|超清|标清|高清|hd|sd/g, '') // Keep 4k/uhd to distinguish 4K channels
        .replace(/cctv-?/g, 'cctv')
        .replace(/央视频道/g, '')
        .replace(/湖南卫视高清/g, '湖南卫视')
        .replace(/北京卫视高清/g, '北京卫视')
        .replace(/东方卫视高清/g, '东方卫视')
        .trim();
};

const epgChannelHasName = (epgChannel, predicate: (s: string) => boolean) => {
    return epgChannel?.name?.some(
        (n) => n?.value && predicate(String(n.value))
    );
};

const findBestMatchingEpgChannel = (
    channelName?: string,
    tvgId?: string,
    tvgName?: string
) => {
    if (!EPG_DATA || !EPG_DATA.channels) return undefined;
    
    // 1) Exact tvg-id match (O(1))
    if (tvgId && epgIdMap.has(tvgId)) {
        return epgIdMap.get(tvgId);
    }

    const srcNames = [
        channelName?.trim() || '',
        tvgName?.trim() || '',
    ].filter(Boolean);

    // 2) Exact Name Match (O(1))
    for (const name of srcNames) {
        if (epgNameMap.has(name)) {
            return epgNameMap.get(name);
        }
    }

    // 3) Lowercase Name Match (O(1))
    for (const name of srcNames) {
        const lower = name.toLowerCase();
        if (epgNameMap.has(lower)) {
            return epgNameMap.get(lower);
        }
    }

    // 4) Normalized Name Match (O(1))
    const normSrc = srcNames.map(normalize).filter(Boolean);
    for (const norm of normSrc) {
        if (epgNameMap.has(norm)) {
            return epgNameMap.get(norm);
        }
    }
    
    // Fallback: If map lookup fails, we *could* do the slow linear scan for substring matching,
    // but the user wanted optimization.
    // Given the "CCTV" mismatch issue earlier, strict matching via Map is safer and faster.
    // We will skip the fuzzy substring search to avoid O(N) cost and false positives.
    
    return undefined;
};

// returns the epg data for the provided channel name and date
ipcRenderer.on(EPG_GET_PROGRAM, (event, args) => {
    const channelName = args.channel?.name;
    const tvgId = args.channel?.tvg?.id;
    const tvgName = args.channel?.tvg?.name;
    const origin = args.channel;
    if (!EPG_DATA || !EPG_DATA.channels) return;
    const foundChannel =
        findBestMatchingEpgChannel(channelName, tvgId, tvgName) || null;

    if (foundChannel) {
        const programs = EPG_DATA?.programs?.filter(
            (ch) => ch.channel === foundChannel.id
        );
        ipcRenderer.send(EPG_GET_PROGRAM_DONE, {
            payload: { channel: foundChannel, items: programs, origin },
        });
    } else {
        console.log('EPG program for the channel was not found...');
        ipcRenderer.send(EPG_GET_PROGRAM_DONE, {
            payload: { channel: {}, items: [], origin },
        });
    }
});

ipcRenderer.on(EPG_GET_CHANNELS, () => {
    ipcRenderer.send(EPG_GET_CHANNELS_DONE, {
        payload: EPG_DATA,
    });
});

ipcRenderer.on(EPG_GET_CHANNELS_BY_RANGE, (event, args) => {
    ipcRenderer.send(EPG_GET_CHANNELS_BY_RANGE_RESPONSE, {
        payload: Object.entries(EPG_DATA_MERGED)
            .slice(args.skip, args.limit)
            .map((entry) => entry[1]),
    });
});

ipcRenderer.on(EPG_FORCE_FETCH, (event, url: string) => {
    fetchEpgDataFromUrl(url);
});
