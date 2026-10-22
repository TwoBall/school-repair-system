# 学校总务报修管理系统 - Cloudflare Pages + D1 + R2 纯云端版

本分支专为 **Cloudflare Serverless 纯云端环境** 定制，利用 Cloudflare 官方永久免费服务，实现 **无需本地开电脑、7×24小时在线、0秒冷启动、永不休眠、工单与照片永久持久化存储**。

---

## 🌟 架构亮点

- **前端与 CDN**：由 **Cloudflare Pages** 托管，全球免费 CDN 加速，自带免费 HTTPS 专属域名（`xxx.pages.dev`），支持自定义域名。
- **后端服务**：由 **Cloudflare Pages Functions** 提供全套 RESTful API 与 Webhook 消息通知。
- **持久化数据库**：基于 **Cloudflare D1**（底子即分布式 SQLite），免费提供 5GB 存储空间与每日 10 万次写操作，系统内置首次访问**自动建表与种子数据填充**。
- **现场图片存储**：基于 **Cloudflare R2**（S3 兼容对象存储），每月提供 **10GB 免费存储且 0 出网流量费**，专门保存现场报修照片与完工验收照片。

---

## 🚀 3 分钟一键部署到 Cloudflare Pages

### 步骤 1：导入 GitHub 仓库并创建 Pages 应用
1. 打开并登录 [Cloudflare 控制台](https://dash.cloudflare.com/)。
2. 在左侧菜单点击 **Workers 和 Pages (Workers & Pages)** → 点击 **创建 (Create application)**。
3. 切换到 **Pages** 标签页 → 点击 **连接到 Git (Connect to Git)**。
4. 选中您的 GitHub 仓库 **`TwoBall/school-repair-system`** 并点击开始设置。
5. 配置构建参数：
   - **分支 (Production branch)**：选择 **`cloudflare-pages`**
   - **框架预设 (Framework preset)**：选择 **`None`**
   - **构建命令 (Build command)**：**留空**
   - **构建输出目录 (Build output directory)**：填写 **`public`**
6. 点击底部的 **保存并部署 (Save and Deploy)**。

---

### 步骤 2：创建 D1 数据库并绑定（存放工单与配置）
1. 在 Cloudflare 左侧导航栏点击 **存储和数据库 (Storage & Databases)** → 选择 **D1 SQL 数据库**。
2. 点击 **创建数据库 (Create database)**：
   - 数据库名称填写：`school-repair-db`
   - 点击保存创建。
3. 将 D1 绑定到刚才创建的 Pages 项目：
   - 回到 **Workers 和 Pages** → 点击您刚刚创建的 Pages 项目。
   - 切换到 **设置 (Settings)** → 点击左侧的 **函数 (Functions)**。
   - 向下滚动找到 **D1 数据库绑定 (D1 database bindings)**，点击 **添加绑定 (Add binding)**：
     - **变量名称 (Variable name)**：必须填大写的 **`DB`**
     - **D1 数据库 (D1 database)**：选择刚才创建的 **`school-repair-db`**
   - 点击 **保存 (Save)**。

---

### 步骤 3：创建 R2 存储桶并绑定（存放现场照片）
1. 在 Cloudflare 左侧导航栏点击 **存储和数据库 (Storage & Databases)** → 选择 **R2 对象存储**。
2. 点击 **创建存储桶 (Create bucket)**：
   - 存储桶名称填写：`school-repair-photos`
   - 点击创建。
3. 将 R2 存储桶绑定到 Pages 项目：
   - 回到 **Workers 和 Pages** → 点击您的 Pages 项目。
   - 切换到 **设置 (Settings)** → 点击左侧的 **函数 (Functions)**。
   - 向下滚动找到 **R2 存储桶绑定 (R2 bucket bindings)**，点击 **添加绑定 (Add binding)**：
     - **变量名称 (Variable name)**：填写 **`PHOTOS`**（系统亦兼容 `BUCKET`）
     - **R2 存储桶 (R2 bucket)**：选择刚才创建的 **`school-repair-photos`**
   - 点击 **保存 (Save)**。

---

### 步骤 4：重新部署生效
1. 切换到项目的 **部署 (Deployments)** 标签页。
2. 点击最新一条部署右侧的 **查看详情** 或 **重新部署 (Retry deployment)**。
3. 部署完成后，点击 Cloudflare 自动分配的专属公网链接（如 `https://school-repair-system.pages.dev`）即可使用！
   *(首次打开页面时，系统会自动初始化 D1 数据表及预设的维修师傅名单，上传的图片会自动直传至您的 R2 存储桶)*。

---

## 🔑 初始默认账号

| 角色 | 入口 | 账号 | 初始密码 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| **总务处管理员** | 右上角切换到「总务处」 | 管理员口令 | `admin888` | 拥有全部管理权限，可在后台修改口令 |
| **维修师傅** | 右上角切换到「维修师傅」 | `13800000001` (张建国) | `worker888` | 独立登录接单 |
| **师生 (报修人)** | 右上角切换到「报修人」 | 免登录 | 免密码 | 填写手机号即可报修、查单、催单 |

---

## 📁 本分支文件清单

- `functions/api/[[route]].js`：Cloudflare Pages Functions 边缘 API 全局网关（集成 D1 + R2）
- `public/index.html`：报修响应式前端单页应用
- `public/js/qrcode.min.js`：离线二维码生成库
- `schema.sql`：D1 数据库建表脚本定义
- `wrangler.toml`：Cloudflare D1 与 R2 配置文件
