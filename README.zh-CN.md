# IPTVnator - IPTV 播放器应用

**IPTVnator** 是一款跨平台、开源的 IPTV 播放器，支持播放和管理 m3u/m3u8 播放列表。你可以通过远程 URL 或本地文件导入播放列表；同时支持基于 XMLTV 的节目单（EPG）。

应用基于 Electron 和 Angular 开发，支持 Windows、macOS 与 Linux。

⚠️ 说明：IPTVnator 不提供任何播放列表或数字内容。截图中的频道与图片仅用于演示。

## 针对中国 IPTV 的客观优化说明

以下能力在不改变上游项目整体架构的前提下进行增强，旨在更好适配中国大陆常见的 IPTV 使用场景。实现方式为在播放器选择、EPG 匹配与地址规范化等方面提供可选策略与兼容性处理，不包含任何内置源或服务：

- 组播与单播适配
  - 自动识别组播/网关（udp/rtp/239.x、.ts/.flv/.mpegts 等）与单播（m3u8/mp4 等）来源
  - 组播优先采用 mpegts.js，单播统一采用 HTML5（集成 hls.js）以提升兼容性
  - 源地址中 “$” 之后的扩展标注仅用于显示与识别，实际播放前会自动剥离并清理空参数
- 回放（时移）支持
  - 支持基于 XMLTV 的回放模板，兼容常见两类格式（形如 {utc}/{utcend} 与 ${b}/{e} 形式）
  - 默认支持 7 天时移窗口（可被频道自身 timeshift/catchup.days 覆盖）
  - 首次直接回放时进行地址合法化与播放器预选，减少因空参数或内核不匹配导致的失败
- 4K/画质策略
  - 单播 4K 直播与回放默认采用 HTML5（hls.js），以提高高码率播放稳定性
  - 频道切源时按“组播/单播-UHD/HD/SD-xxfps”显示来源标签，便于快速识别
- EPG 匹配与可视化
  - 增强频道名称匹配：在有 tvg-id 时优先精确匹配；名称匹配加入归一化（去除空格/符号/画质标识、统一 CCTV/卫视常见写法）与模糊包含策略
  - 节目单状态中文化与高亮：直播/待播/已播；当前直播标红，回放标绿；信息浮层同步显示“正在直播/正在回放”
- 频道列表体验
  - 统一矩形台标（48×32，等比居中，白底），无台标时使用内置占位图
  - 同名频道源合并（保留 4K/非 4K 区分），顶部工具栏便捷切源

![IPTVnator: 主界面](./iptv-dark-theme.png)

## 功能特性

- 支持 m3u 与 m3u8 播放列表 📺
- 支持 Xtream Code (XC) 与 Stalker portal (STB)
- 支持外部播放器（mpv、VLC）
- 从本地文件或远程 URL 添加播放列表 📂
- 应用启动时自动更新播放列表
- 频道搜索 🔍
- 支持 EPG（电视节目单），展示详细信息
- 电视存档/时移/回看
- 按分组显示频道
- 收藏频道并统一管理
- 支持 HTML 播放器（hls.js）或基于 Video.js 的播放器
- 内置多语言（目前支持 en, ru, de, ko, es, zh, fr, it）
- 可为播放列表设置自定义 User-Agent
- 明暗主题切换
- 提供可自托管的 Docker 版本

## 下载

- 前往 [Releases 页面](https://github.com/CGG888/iptvnator/releases) 获取适用于 macOS、Windows、Linux 的最新安装包。
- Snap 包：

```
$ sudo snap install iptvnator
```

- Arch Linux（AUR）：[iptvnator-bin](https://aur.archlinux.org/packages/iptvnator-bin/)

```
$ yay -S iptvnator-bin
```

[![Get it from the Snap Store](https://snapcraft.io/static/images/badges/en/snap-store-black.svg)](https://snapcraft.io/iptvnator)

## 自托管（Docker）

如果你想在本地以 PWA 方式运行，可参考 [docker/README.md](./docker/README.md) 获取前后端启动与构建说明。

## 本地构建

前置条件：已安装 Node.js 与 npm。

1. 安装依赖：

```
$ npm install
```

2. 构建桌面应用：

```
# Linux
$ npm run electron:build:linux

# macOS
$ npm run electron:build:mac

# Windows
$ npm run electron:build:windows
```

构建产物将输出到 `release` 目录；打包配置位于 `electron-builder.json` 与 `package.json`。如需跨平台构建的注意事项，请参考 [electron-builder 文档](https://www.electron.build/)。

> 注：不要期望在单一平台为所有平台构建应用，详情见上游文档的多平台构建说明。

## 开发调试

安装依赖后运行：

```
$ npm run start
```

Electron 版本会以独立窗口打开；PWA 版本可在浏览器访问 http://localhost:4200。

仅运行 Angular 前端：

```
$ npm run ng:serve
```

## 回放格式示例与说明

支持两类常见 EPG 回放模板，播放器会根据所选节目单的起止时间自动替换模板中的时间占位符并生成可播放的回放地址：
- 模板一：`{utc:yyyyMMddHHmmss}` 与 `{utcend:yyyyMMddHHmmss}`
- 模板二：`${(b)yyyyMMdd|UTC}T${(b)HHmmss|UTC}` 与 `${(e)yyyyMMdd|UTC}T${(e)HHmmss|UTC}`

说明与规则：
- 频道项中的 `catchup="default"` 与 `catchup-source="..."` 用于提供回放模板；点击 EPG 中的节目时，应用会以节目 UTC 起止时间替换模板生成实际回放 URL。
- 直播源地址中 `$` 之后的文本仅用于在界面上展示来源标签（如“组播超高清-50.00fps”），不会参与真实播放；应用会自动剥离 `$` 及其后的内容，并清理空查询参数。
- 组播/TS 流直播优先使用 mpegts.js；单播与回放统一使用 HTML5（集成 hls.js）。4K 单播直播与回放也使用 HTML5。
- 若频道未提供 `catchup-source`，则该频道不支持回放。
- 未在频道中声明时移窗口时，默认窗口为 7 天（可被频道自身 `timeshift`/`catchup.days` 等参数覆盖）。

示例1（占位域名）：

```m3u
#EXTINF:-1 tvg-id="北京卫视4K" tvg-name="北京卫视4K" tvg-logo="https://cdn.example.com/logo/beijing-4k.png" group-title="4K频道" catchup="default" catchup-source="https://catchup.example.com/asset/201500000638/index.m3u8?starttime={utc:yyyyMMddHHmmss}&endtime={utcend:yyyyMMddHHmmss}",北京卫视4K
http://gateway.example/rtp/239.0.0.1:9000$组播超高清-50.00fps

#EXTINF:-1 tvg-id="北京卫视" tvg-name="北京卫视" tvg-logo="https://cdn.example.com/logo/beijing.png" group-title="4K频道" catchup="default" catchup-source="https://catchup.example.com/asset/201500000065/index.m3u8?starttime={utc:yyyyMMddHHmmss}&endtime={utcend:yyyyMMddHHmmss}",北京卫视4K
http://gateway.example/rtp/239.0.0.2:9000$组播超高清-25.00fps

#EXTINF:-1 tvg-id="" tvg-name="北京卫视4K" tvg-logo="https://cdn.example.com/logo/beijing-4k.png" group-title="4K频道" catchup="default" catchup-source="https://catchup.example.com/asset/201500000638/index.m3u8?starttime={utc:yyyyMMddHHmmss}&endtime={utcend:yyyyMMddHHmmss}",北京卫视4K
https://live.example.com/asset/201500000638/index.m3u8?starttime=$单播$单播超高清-50.00fps
```

示例2（占位域名）：

```m3u
#EXTINF:-1 tvg-id="北京卫视4K" tvg-name="北京卫视4K" tvg-logo="https://cdn.example.com/logo/beijing-4k.png" group-title="4K频道" catchup="default" catchup-source="https://catchup.example.com/asset/201500000638/index.m3u8?starttime=${(b)yyyyMMdd|UTC}T${(b)HHmmss|UTC}&endtime=${(e)yyyyMMdd|UTC}T${(e)HHmmss|UTC}",北京卫视4K
http://gateway.example/rtp/239.0.0.1:9000$组播超高清-50.00fps

#EXTINF:-1 tvg-id="" tvg-name="北京卫视4K" tvg-logo="https://cdn.example.com/logo/beijing-4k.png" group-title="4K频道" catchup="default" catchup-source="https://catchup.example.com/asset/201500000640/index.m3u8?starttime=${(b)yyyyMMdd|UTC}T${(b)HHmmss|UTC}&endtime=${(e)yyyyMMdd|UTC}T${(e)HHmmss|UTC}",北京卫视4K
https://live.example.com/asset/201500000640/index.m3u8?starttime=$单播$单播超高清-25.00fps
```

## 免责声明

IPTVnator 不提供任何播放列表或其他数字内容。

## 项目来源

本仓库来源于 GitHub 上的开源项目 [4gray/iptvnator](https://github.com/4gray/iptvnator)。项目由上游社区发起并维护，采用 MIT 许可证。在此感谢上游作者与所有贡献者。

## 致谢

本项目在原仓库基础上进行本地化与功能增强，特别感谢上游项目与维护者：
- 原仓库地址：https://github.com/4gray/iptvnator

许可证见 [LICENSE.md](./LICENSE.md)。

