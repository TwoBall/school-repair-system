# 学校总务报修管理系统 · Docker 私有化部署手册

> 本系统已支持**无缝 Docker 容器化运行**。
> 无需依赖 Cloudflare，可在**腾讯云/阿里云轻量服务器、校园内网服务器、自建机房、NAS** 等任何支持 Docker 的环境中独立部署。
> 数据库（SQLite）与照片均保存在本地宿主机，**无需额外部署 MySQL 或购买对象存储**。

---

## 一、一键快速启动

### 1. 准备工作
确保服务器已安装 `Docker` 与 `Docker Compose`（主流 Linux 系统如 Ubuntu/Debian/CentOS/TencentOS 均可）：
```bash
# 验证 Docker 环境
docker -v
docker compose version
```

### 2. 克隆代码并启动
```bash
# 1. 克隆代码仓库并进入目录
git clone -b docker-support https://github.com/TwoBall/school-repair-system.git
cd school-repair-system

# 2. 一键构建并启动容器（后台常驻）
docker compose up -d --build
```

### 3. 访问系统
容器默认映射宿主机 **80 端口**：
* **师生报修端**：`http://<你的服务器IP>/`
* **维修师傅工作台**：`http://<你的服务器IP>/worker`（初始口令 `worker888`）
* **总务处管理后台**：`http://<你的服务器IP>/admin`（初始口令 `admin888`）

> [!IMPORTANT]
> **初次登录第一件事**：请立即登录管理后台将管理员口令 `admin888` 修改为高强度密码！

---

## 二、数据持久化与极简备份

系统所有产生的数据均保存在项目根目录的 `./data` 文件夹内：
```
school-repair-system/
  └── data/
       ├── school-repair.db         # 全量工单、人员、字典与设置数据
       ├── school-repair.db-wal     # SQLite 高性能预写日志
       └── photos/                  # 师生现场照片与师傅完工照原图
```

### 1. 数据冷备份（建议加入 crontab 定期执行）
只需压缩备份 `./data` 目录即可打包全系统数据：
```bash
tar -czvf /backup/repair_data_$(date +%Y%m%d).tar.gz ./data
```

### 2. 更换服务器迁移
如果要将系统搬迁至新服务器，只需 3 步：
1. 在新服务器上拉取代码；
2. 将旧服务器备份的 `data` 目录拷贝到新服务器的项目目录下；
3. 执行 `docker compose up -d` 即可无损还原所有历史工单、账号与照片。

---

## 三、常用运维与管理命令

```bash
# 查看运行日志（实时跟随）
docker compose logs -f

# 查看资源占用（CPU、内存）
docker stats school-repair-app

# 停止服务
docker compose stop

# 启动服务
docker compose start

# 重启服务
docker compose restart

# 代码更新后重新构建并启动
git pull
docker compose up -d --build
```

---

## 四、高级配置（按需调整）

### 1. 修改对外端口
如果服务器 80 端口已被其他服务（如 Nginx、宝塔面板）占用，编辑 `docker-compose.yml`：
```yaml
ports:
  - "8080:8080"   # 左侧为宿主机暴露的端口，改为任意空闲端口
```
修改后执行 `docker compose up -d` 生效。

### 2. Nginx 反向代理与 HTTPS 配置示例
若您有已备案域名并已申请 SSL 证书，推荐在宿主机使用 Nginx 统一反向代理并开启 HTTPS：

```nginx
server {
    listen 80;
    server_name bx.your-school.edu.cn;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name bx.your-school.edu.cn;

    ssl_certificate     /etc/nginx/ssl/bx.crt;
    ssl_certificate_key /etc/nginx/ssl/bx.key;

    # 单张照片最大允许上传 10MB
    client_max_body_size 10M;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## 五、轻量应用服务器配置注意项（如腾讯云）

1. **防火墙 / 安全组配置**：
   * 登录云控制台 -> 实例安全组，放行 **TCP 80**、**TCP 443**（若改用了其他端口，需同步放行对应的自定义端口）。
2. **免费快照保障**：
   * 在轻量服务器控制台 -> 云硬盘 -> 快照策略，开启**每周自动定期快照**，双重保障数据安全。
