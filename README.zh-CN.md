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

## 使用指南（Wiki）

### 1. 快速上手
- 添加播放列表：在首页选择「上传/选择播放列表」，支持本地文件或远程 m3u/m3u8 URL。
- 绑定节目单（EPG）：在设置或导入时填写 XMLTV 地址。应用会优先按 `tvg-id` 匹配，其次按名称归一后模糊匹配。
- 开始播放：从左侧频道列表点选一个频道；右侧播放器自动按源类型选择合适内核。

### 2. 频道列表与常用操作
- 搜索：在频道页按 Ctrl+F 聚焦搜索框，输入关键字即时过滤。
- 分组：切换到「分组」页按分类浏览频道。
- 收藏：在频道项右侧点击星标，常用频道将出现在「收藏」页。
- 拖拽排序：在收藏页可拖动条目改变顺序。
- 台标：支持 tvg-logo；无台标时显示占位图；列表中的台标背景为透明底色，避免白块。

### 3. 播放器与源选择
- 自动模式：应用会根据地址类型选择播放器：
  - 组播/TS/网关类（udp/rtp/239.x、.ts/.mpegts/.flv 等）→ mpegts.js
  - 单播/HLS（.m3u8 等）与所有回放 → HTML5（内置 hls.js）
  - 也可在设置中改用 MPV/VLC 外部播放器（需本机已安装）
- 源标签展示：工具栏显示「组播/单播-画质-帧率」，例如「组播-UHD-50fps」。该标签来自地址 `$` 之后的标注或频道名，不影响真实播放。

### 4. 播放器信息浮层
- 鼠标移动到播放器区域会显示信息浮层：
  - 网络类型：组播/单播（回放一律显示单播）
  - 分辨率：UHD/HD/SD
  - 帧率：例如 25.00fps/50.00fps
  - 状态：正在直播 / 正在回放

### 5. 节目单（EPG）与回放
- 直播/回放：点击当前或未开始节目即切换直播；点击已播节目则按频道的 `catchup-source` 模板生成单播回放地址并播放。
- 无 EPG 渠道：应用会为当天生成每小时的「精彩节目」占位项，点击即可按时间窗触发回放。
- 注意时区：模板内时间使用 UTC；应用会以节目 UTC 时间替换模板占位符。

### 6. 地址后缀与参数
- UI 标注：地址中 `$` 之后的所有文本仅用于 UI 展示（如「单播超清-25.00fps」），不会参与播放。
- 清理逻辑：真实播放前会剥离 `$` 及其后的内容，并清理空查询参数，避免「?param=&」导致的 404 或跨域报错。

### 7. 自定义 UA 与 Referer
- 在导入的播放列表上可以设置 `#EXTHTTP` 或在应用设置中配置 User-Agent/Referer。
- 播放时应用会将 UA 与 Referer 注入请求头，以适配部分防盗链源。

### 8. 常见问题与排查
- 组播无法播放：
  - 桌面版：通常可直接播放；若为 PWA/自托管，请在 Linux/WSL2 上以 Docker「host」网络模式部署。
  - 网络环境：确保路由或交换设备允许多播转发，或通过运营商提供的 TS 网关地址。
- 回放无效：
  - 频道需提供 `catchup-source` 模板；若缺失则不支持回放。
  - 模板时间占位符需与本指南所述格式一致。
- EPG 对不上：
  - 优先在 m3u 中填入正确的 `tvg-id`；若名称匹配失败，可去除频道名中的 4K/高清/帧率等附加字样后再试。
- 调试日志：
  - 从菜单 Help → Open DevTools 打开开发者工具，查看 Console 与 Network 以定位问题。

### 9. 隐私与安全
- 应用不会上传你的播放列表、EPG 或观看记录。
- 请勿在公开仓库或截图中泄露带鉴权信息的播放地址。

## 免责声明

IPTVnator 不提供任何播放列表或其他数字内容。

## 项目来源

本仓库来源于 GitHub 上的开源项目 [4gray/iptvnator](https://github.com/4gray/iptvnator)。项目由上游社区发起并维护，采用 MIT 许可证。在此感谢上游作者与所有贡献者。

## 致谢

本项目在原仓库基础上进行本地化与功能增强，特别感谢上游项目与维护者：
- 原仓库地址：https://github.com/4gray/iptvnator

许可证见 [LICENSE.md](./LICENSE.md)。

