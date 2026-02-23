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
        .replace(/超高清|超清|标清|高清|uhd|4k|hd|sd/g, '')
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
    // 1) Exact tvg-id match
    if (tvgId) {
        const byId = EPG_DATA.channels.find((c) => c.id === tvgId);
        if (byId) return byId;
    }
    const candidates = EPG_DATA.channels;
    const srcNames = [
        channelName?.trim() || '',
        tvgName?.trim() || '',
    ].filter(Boolean);
    const normSrc = srcNames.map(normalize).filter(Boolean);

    // 2) Exact trim/case-insensitive
    for (const epgCh of candidates) {
        if (
            epgChannelHasName(epgCh, (v) =>
                srcNames.includes(String(v).trim())
            )
        ) {
            return epgCh;
        }
    }
    // 3) Normalized equality
    for (const epgCh of candidates) {
        if (
            epgChannelHasName(epgCh, (v) => {
                const nv = normalize(v);
                return normSrc.includes(nv);
            })
        ) {
            return epgCh;
        }
    }
    // 4) Includes/substring after normalization
    for (const epgCh of candidates) {
        const epgNormNames =
            epgCh?.name?.map((n) => normalize(n?.value || '')) || [];
        if (
            epgNormNames.some(
                (en) => en && normSrc.some((ns) => ns.includes(en) || en.includes(ns))
            )
        ) {
            return epgCh;
        }
    }
    return undefined;
};

// returns the epg data for the provided channel name and date
ipcRenderer.on(EPG_GET_PROGRAM, (event, args) => {
    const channelName = args.channel?.name;
    const tvgId = args.channel?.tvg?.id;
    const tvgName = args.channel?.tvg?.name;
    if (!EPG_DATA || !EPG_DATA.channels) return;
    const foundChannel =
        findBestMatchingEpgChannel(channelName, tvgId, tvgName) || null;

    if (foundChannel) {
        const programs = EPG_DATA?.programs?.filter(
            (ch) => ch.channel === foundChannel.id
        );
        ipcRenderer.send(EPG_GET_PROGRAM_DONE, {
            payload: { channel: foundChannel, items: programs },
        });
    } else {
        console.log('EPG program for the channel was not found...');
        ipcRenderer.send(EPG_GET_PROGRAM_DONE, {
            payload: { channel: {}, items: [] },
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
