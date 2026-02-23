# IPTVnator - IPTV Player Application

Translations: [简体中文](./README.md)

**IPTVnator** is a cross‑platform, open‑source IPTV player for m3u/m3u8 playlists. You can import playlists from a remote URL or local files and optionally add EPG (XMLTV).

The app is built with Electron and Angular and runs on Windows, macOS and Linux.

⚠️ Note: IPTVnator does not provide any playlists or digital content. Channel names and images in screenshots are for demonstration only.

## China IPTV – Objective Enhancements

Without changing the upstream project’s architecture, we add optional, objective improvements to better fit common China IPTV scenarios. No built‑in sources or services are included.

- Multicast vs. Unicast
  - Automatically detects multicast/gateway links (udp/rtp/239.x, .ts/.flv/.mpegts) vs. unicast (m3u8/mp4).
  - Multicast uses mpegts.js; unicast uses HTML5 with hls.js for better compatibility.
  - Any suffix after “$” in source URLs is used only for labeling; it is stripped before playback. Empty query parameters are removed.
- Catch‑up (Timeshift/Replay)
  - Supports two common XMLTV catch‑up templates (e.g., `{utc}/{utcend}` and `${(b)}/${(e)}` styles).
  - Default 7‑day window when the channel doesn’t specify `tvg-rec`, `timeshift`, or `catchup.days`.
  - First‑time replay stabilized by sanitizing the base URL and pre‑selecting the correct player.
- 4K/Quality Strategy
  - Unicast 4K live and replay default to HTML5 (hls.js) for stability at higher bitrates.
  - Source switch menu labels: “Multicast/Unicast‑UHD/HD/SD‑xxfps” for quick identification.
- EPG Matching and Visualization
  - Matching prioritizes exact `tvg-id`; otherwise uses name normalization (remove spaces/symbols/quality marks; unify CCTV and common satellite TV naming) with fuzzy containment.
  - Program status in Chinese with highlighting: Live (red), Replay (green), Upcoming.
  - Overlay shows “Live”/“Replaying” consistently.
- Channel List UX
  - Unified rectangular logos (48×32, centered with white background). Project placeholder is used when a logo is missing.
  - Merge same‑name channels while keeping 4K vs non‑4K separated. Quick source switching in the top toolbar.

![IPTVnator: main UI](./iptv-dark-theme.png)

## Features

- M3u and M3u8 playlists support 📺
- Xtream Code (XC) and Stalker portal (STB) support
- External player support – mpv, VLC
- Add playlists from file system or remote URL 📂
- Auto‑update playlists on app startup
- Channel search 🔍
- EPG (TV Guide) with details
- TV archive/catch‑up/timeshift
- Group‑based channels
- Favorites and global favorites
- HTML video player (hls.js) or Video.js
- i18n with multiple languages (en, ru, de, ko, es, zh, fr, it)
- Custom User‑Agent per playlist
- Light/Dark themes
- Docker image for self‑hosting

## Download

Get the latest binaries for macOS, Windows and Linux from the [Releases](https://github.com/CGG888/iptvnator/releases) page.

Snap:

```
$ sudo snap install iptvnator
```

Arch Linux (AUR): [iptvnator-bin](https://aur.archlinux.org/packages/iptvnator-bin/)

```
$ yay -S iptvnator-bin
```

[![Get it from the Snap Store](https://snapcraft.io/static/images/badges/en/snap-store-black.svg)](https://snapcraft.io/iptvnator)

## Build Locally

Requirements: Node.js and npm.

```
$ npm install

# Linux
$ npm run electron:build:linux

# macOS
$ npm run electron:build:mac

# Windows
$ npm run electron:build:windows
```

## Development

```
$ npm install
$ npm run start
```

Electron opens in a separate window; PWA runs at http://localhost:4200.

Run only Angular:

```
$ npm run ng:serve
```

## Catch‑up Formats: Examples and Notes

The app supports two common EPG catch‑up templates. When you click a program in the EPG, start/end UTC timestamps are substituted into the template to generate a playable URL:
- Template A : `{utc:yyyyMMddHHmmss}` and `{utcend:yyyyMMddHHmmss}`
- Template B : `${(b)yyyyMMdd|UTC}T${(b)HHmmss|UTC}` and `${(e)yyyyMMdd|UTC}T${(e)HHmmss|UTC}`

Notes:
- Use `catchup="default"` with `catchup-source="..."` on the channel item to provide a catch‑up template. When a program is selected, its UTC start/end are injected into the URL.
- Text after `$` in a live URL is only a display label (e.g., “Multicast‑UHD‑50.00fps”) and is stripped before playback. Empty query parameters are removed.
- Multicast/TS live uses mpegts.js. Unicast and catch‑up use the HTML5 player (with hls.js). 4K unicast live and catch‑up also use HTML5.
- If a channel has no `catchup-source`, catch‑up is not available.
- If no timeshift window is provided by the channel, a 7‑day default is applied (can be overridden by channel attributes like `timeshift`/`catchup.days`).

Example 1 (placeholder domains):

```m3u
#EXTINF:-1 tvg-id="Beijing Satellite 4K" tvg-name="Beijing Satellite 4K" tvg-logo="https://cdn.example.com/logo/beijing-4k.png" group-title="4K" catchup="default" catchup-source="https://catchup.example.com/asset/201500000638/index.m3u8?starttime={utc:yyyyMMddHHmmss}&endtime={utcend:yyyyMMddHHmmss}",Beijing Satellite 4K
http://gateway.example/rtp/239.0.0.1:9000$Multicast-UHD-50.00fps

#EXTINF:-1 tvg-id="Beijing Satellite" tvg-name="Beijing Satellite" tvg-logo="https://cdn.example.com/logo/beijing.png" group-title="4K" catchup="default" catchup-source="https://catchup.example.com/asset/201500000065/index.m3u8?starttime={utc:yyyyMMddHHmmss}&endtime={utcend:yyyyMMddHHmmss}",Beijing Satellite 4K
http://gateway.example/rtp/239.0.0.2:9000$Multicast-UHD-25.00fps

#EXTINF:-1 tvg-id="" tvg-name="Beijing Satellite 4K" tvg-logo="https://cdn.example.com/logo/beijing-4k.png" group-title="4K" catchup="default" catchup-source="https://catchup.example.com/asset/201500000638/index.m3u8?starttime={utc:yyyyMMddHHmmss}&endtime={utcend:yyyyMMddHHmmss}",Beijing Satellite 4K
https://live.example.com/asset/201500000638/index.m3u8?starttime=$Unicast$Unicast-UHD-50.00fps
```

Example (placeholder domains):

```m3u
#EXTINF:-1 tvg-id="Beijing Satellite 4K" tvg-name="Beijing Satellite 4K" tvg-logo="https://cdn.example.com/logo/beijing-4k.png" group-title="4K" catchup="default" catchup-source="https://catchup.example.com/asset/201500000638/index.m3u8?starttime=${(b)yyyyMMdd|UTC}T${(b)HHmmss|UTC}&endtime=${(e)yyyyMMdd|UTC}T${(e)HHmmss|UTC}",Beijing Satellite 4K
http://gateway.example/rtp/239.0.0.1:9000$Multicast-UHD-50.00fps

#EXTINF:-1 tvg-id="" tvg-name="Beijing Satellite 4K" tvg-logo="https://cdn.example.com/logo/beijing-4k.png" group-title="4K" catchup="default" catchup-source="https://catchup.example.com/asset/201500000640/index.m3u8?starttime=${(b)yyyyMMdd|UTC}T${(b)HHmmss|UTC}&endtime=${(e)yyyyMMdd|UTC}T${(e)HHmmss|UTC}",Beijing Satellite 4K
https://live.example.com/asset/201500000640/index.m3u8?starttime=$Unicast$Unicast-UHD-25.00fps
```
## Disclaimer

IPTVnator doesn’t provide any playlists or other digital content.

## Acknowledgements

This project builds upon the upstream work of 4gray/iptvnator. Many thanks to the original authors and contributors.
- Upstream repository: https://github.com/4gray/iptvnator
