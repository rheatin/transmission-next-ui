## 群辉

使用**群辉**套件，可参考以下脚本，其中使用的套件来源为矿神群晖SPK，首先从[Release](https://github.com/hisproc/transmission-next-ui/releases)下载最新版本的压缩包`release.zip`，并下载[synology.sh](scripts/synology.sh)脚本到同一目录下，执行以下命令，脚本将自动解压并尝试解压到目标路径:

```bash
chmod +x synology.sh
sudo bash synology.sh
```

输出 `Deployment complete` 即表示安装完成，旧的web目录内容会备份到当前执行目录下，文件为`backup.zip`，如果需要恢复到安装前的状态，请重命名`backup.zip`为`release.zip`，并重新执行上述命令。

更新时只需要再次执行脚本即可。

## 飞牛OS

飞牛OS自带了Docker环境，首先确定你要安装的路径，例如先创建一个文件夹，这里以transmission为例，获取文件夹的路径，通过SSH登入飞牛OS，执行脚本:

![fnos_file.png](../pic/fnos_file.png)

```bash
cd /vol1/1000/transmission # 此处替换为你要安装的路径
sudo curl -fsSL https://raw.githubusercontent.com/hisproc/transmission-next-ui/main/download.sh | bash
```

执行后将在当前目录如下结构:

![fnos_file_struct.png](../pic/fnos_file_struct.png)

最后使用飞牛自带的Docker compose服务启动即可，默认用户名密码为`transmission:transmission`，可以直接在窗口下方的配置中修改:

![fnos_docker.png](../pic/fnos_docker.png)

启动后访问`http://IP:9091`即可访问。更新时只需要在transmission目录下重新执行一次脚本即可，无需重启docker-compose服务。

### 同容器创建种子服务

Web UI 仍按上面的方式构建并复制到 `config/webui`。种子生成服务使用容器内已有的 `/usr/bin/transmission-create` 和 Python 3，不另建容器或令牌。仓库中的服务文件放在 `/share/NAS/AppData/transmission/config/torrent-create`，在 Transmission 的 Compose `volumes` 中添加持久化挂载：

```yaml
- /share/NAS/AppData/transmission/config/torrent-create:/config/torrent-create:ro
- /share/NAS/AppData/transmission/config/torrent-create/custom-services.d:/custom-services.d:ro
```

`config.example.json` 复制为 `config.json`，`allowed_roots` 只列数据目录，不要设为 `/share`，因为 `/share/NAS` 下还包含应用数据。当前 QNAP 可保留 `/share/NAS/Downloads`、`/share/Private`、`/share/incompleted` 和 `/downloads`。按实际 qnet 地址设置配置中的 `host`。

Compose 管理的挂载会随容器升级和重建保留。保存 Compose 修改后，在 Container Station 更新项目，或在 Compose 目录执行 `docker compose up -d`。Transmission 会短暂重启，数据卷保持不变。

本 NAS 的 Transmission 使用静态 QNAP 网络地址 `192.168.1.91`，API 绑定 `192.168.1.91:3001`，无须额外 Docker 端口映射；其他网络模式需按需映射该端口。Web UI 手动填写容器内源路径，经 Transmission 原生 RPC 验证后即可生成。