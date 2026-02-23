# IPTVnator 自托管（Docker）

该目录提供使用 Docker 自托管 IPTVnator 的方案。

## 快速开始（Linux 主机，Host 网络）

1. 进入 docker 目录：
   - `cd docker`
2. 后台启动：
   - `docker compose up -d`

当前使用 Host 网络以获得更好的组播（Multicast）支持，容器直接绑定在宿主机网络上：
- 前端（Nginx）：80 端口
- 后端（Node）：7333 端口

访问地址：http://127.0.0.1/

说明：Docker 的 Host 网络模式仅在 Linux 原生环境可用。Windows/macOS 环境建议在 Linux 虚拟机或 WSL2 内运行以获得组播能力。

## 配置方式

你可以在与 `docker-compose.yml` 同目录的 `.env` 文件中覆盖镜像与端口变量。

示例 `.env`：

- `FRONTEND_IMAGE=ghcr.io/cgg888/iptvnator:latest`
- `BACKEND_IMAGE=4gray/iptvnator-backend:latest`
- `FRONTEND_PORT=4333`
- `BACKEND_PORT=7333`

默认值（未提供 `.env` 时）：
- 前端镜像：`ghcr.io/cgg888/iptvnator:latest`
- 后端镜像：`4gray/iptvnator-backend:latest`
- 前端端口变量：`4333`（用于拼接 URL）
- 后端端口：`7333`

如需改用 Docker Hub 的前端镜像，可设置：
- `FRONTEND_IMAGE=cgg888/iptvnator:latest`

## 端口与 URL 说明

- 前端容器默认由 Nginx 在宿主机 80 端口提供服务；若要修改端口，请编辑 `docker/nginx.conf` 的 `listen` 配置。
- 前端通过环境变量 `BACKEND_URL`（在容器启动时注入）访问后端。默认情况下，它指向 `http://127.0.0.1:${BACKEND_PORT}`，在 Host 网络下可在同一台机器直接联通。

## 本地构建（可选）

构建前端镜像：
- `docker build -t ghcr.io/cgg888/iptvnator:latest -f docker/Dockerfile .`

后端源码与说明：
- https://github.com/4gray/iptvnator-backend
