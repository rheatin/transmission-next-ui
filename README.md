<h1 align="center" style="border-bottom: none;"><img src="public/favicon.svg" width="24" style="vertical-align: middle; margin-right: 8px;" /> Transmission Next UI</h1>
<h3 align="center"> 一个Transmission的第三方Web UI，使用shadcn/ui和Vite构建。</h3>

<p align="center">
  <img alt="GitHub License" src="https://img.shields.io/github/license/hisproc/transmission-next-ui">
  <img alt="GitHub Release" src="https://img.shields.io/github/release/hisproc/transmission-next-ui">
  <img alt="GitHub Workflow Status" src="https://img.shields.io/github/actions/workflow/status/hisproc/transmission-next-ui/build.yml">
</p>

---

## 技术栈

- **前端框架**: [React 19](https://react.dev/) + [Vite 7](https://vite.dev/)
- **CSS 框架**: [Tailwind CSS 4.0](https://tailwindcss.com/)
- **组件库**: [shadcn/ui](https://ui.shadcn.com/)
- **图标库**: [Lucide React](https://lucide.dev/)
- **路由管理**: [React Router 7](https://reactrouter.com/)

---

简体中文 | [English](README_EN.md)


## 预览

[**在线演示 (Live Demo)**](https://transmission-next-ui-demo.pages.dev)

| Light Mode | Dark Mode |
| :---: | :---: |
| ![dashboard_light.png](pic/dashboard_light.png) | ![dashboard_dark.png](pic/dashboard_dark.png) |

| Torrent Details | Settings |
| :---: | :---: |
| ![torrent_details.png](pic/torrent_details.png) | ![settings.png](pic/settings.png) |

## 功能

- 现代化 UI 设计
- 响应式布局，适配所有设备
- 适配 Transmission 4.0+ 版本
- [x] 种子管理，信息查看
- [x] 配置设置
- [x] 拖拽/粘贴添加种子
- [x] 深色模式支持
- [x] Tracker 过滤
- [x] 支持种子标签
- [x] 批量替换 Tracker
- [x] 批量移动下载目录
- [x] 批量设置种子标签
- [x] 从 Transmission 可访问的目录创建种子

⚠️本项目为早期版本，尚未经过完整测试，正式使用前请自行验证其功能是否符合预期。

## 快速开始

可以通过三种方式部署 Transmission Next UI，另外提供对于[群辉](doc/NasInstall.md#群辉)和[飞牛OS](doc/NasInstall.md#飞牛OS)的安装指引:

### 1. 一键安装

> 依赖环境：`docker`、`docker-compose` 和 `curl`

> [!TIP]
> 建议先创建一个专用目录来存放相关文件，例如：
> ```bash
> mkdir -p ~/transmission && cd ~/transmission
> ```

初次安装或升级到最新版本，运行以下命令：

```bash
curl -fsSL https://raw.githubusercontent.com/hisproc/transmission-next-ui/main/download.sh | bash
```

执行后将在当前目录生成一个 `docker-compose.yml` 文件。

### 创建种子教程

创建服务运行在 Transmission 容器内，使用镜像已有的 `transmission-create`，不另建容器，也不需要令牌。首次部署复制配置模板：

```bash
cp torrent-helper/config.example.json torrent-helper/config.json
```

按 Transmission 容器内路径修改 `allowed_roots`，只列出数据目录。例如 QNAP 可使用 `/share/NAS/Downloads`、`/share/Private`、`/share/incompleted` 和 `/downloads`。不要把 `/share` 整体加入白名单，因为其中还包含应用数据。`host` 应设为 Transmission 容器的局域网地址；普通 Docker bridge 部署可用 `0.0.0.0` 并仅向可信局域网发布端口。

Compose 需要将服务源码和 LinuxServer 启动脚本挂载到容器。仓库的 `docker-compose.yml` 已包含这些挂载；使用自己的 Compose 时，加入：

```yaml
services:
  transmission:
    volumes:
      - ./torrent-helper:/config/torrent-create:ro
      - ./torrent-helper/custom-services.d:/custom-services.d:ro
    ports:
      - "3001:3001"
```

确保启动脚本可执行，然后应用 Compose 配置。服务随容器启动，挂载也会在升级或重建后保留。TCP `3001` 仅供可信局域网访问，不要暴露到公网。

打开 Web UI 工具栏的“创建种子”，填写容器内绝对路径，例如 `/share/NAS/Downloads/Movies`，点击“验证路径”。验证通过后填写 Tracker 并设置私有标记、分块大小等选项，再点击“生成种子”。完成后可以下载 `.torrent`，也可以添加到 Transmission 并校验已有数据。

编辑该文件来自定义 Transmission 的用户名、密码和时区：

```yaml
environment:
  - USER=your-username
  - PASS=your-password
  - TZ=Asia/Shanghai
```

然后通过以下命令启动或停止服务：

```bash
docker-compose up -d   # 后台启动
docker-compose down    # 停止并移除容器
```

默认使用端口映射方式，映射了以下两个端口：

| 端口 | 协议 | 用途 |
| --- | --- | --- |
| `9091` | TCP | Web UI 及 RPC 接口，启动后通此端口访问 Web UI（如 `http://localhost:9091`） |
| `3001` | TCP | 同容器种子创建 API，仅限可信网络访问 |
| `51413` | TCP/UDP | BT 数据传输端口，用于与其他节点交换数据 |

如果修改了 Transmission 在 config 目录下的配置文件中的端口设置，请确保在 `docker-compose.yml` 中也做相应修改。

### 2. 手动安装

1. 打开 [Releases](https://github.com/hisproc/transmission-next-ui/releases) 页面
2. 下载最新或稳定版本（如 `transmission-next-ui-v1.0.0.zip`）
3. 解压并将其中的内容复制到 Transmission 的 Web 目录（如 `transmission/web/src`）

### 3. 源代码打包

```bash
git clone git@github.com:hisproc/transmission-next-ui.git
cd transmission-next-ui
pnpm install
pnpm build
```

构建完成后，将 `dist/` 目录下的所有内容复制到 Transmission 的 Web 目录下即可。服务源码和 LinuxServer custom-service 需通过 Compose 挂载到容器；手动复制 `dist/` 本身不会更新服务端代码。

## 许可证

本项目采用 [MIT 许可证](LICENSE) 进行授权。
