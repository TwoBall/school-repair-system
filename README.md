# 学校总务报修管理系统 - Cloudflare Pages + D1 + R2 纯云端版

本分支专为 **Cloudflare Serverless 纯云端环境** 定制，利用 Cloudflare 官方永久免费服务，实现 **无需本地开电脑、7×24小时在线、0秒冷启动、工单与照片永久持久化存储**。

前端采用 **Vite 多页面微应用架构**，将 **师生报修端**、**维修师傅端** 与 **总务管理端** 彻底拆分为 3 个独立页面，互相解耦、不相互干扰，并针对移动端与桌面端深度优化了响应式交互。

---

## 🌟 架构亮点

- **前端三端独立**：基于 Vite 构建的 3 个独立独立入口（师生端 `/`、师傅端 `/worker`、总务端 `/admin`），物理隔离，安全纯粹。
- **全端响应式设计**：移动端大触控靶点（≥44px）、网格弹性表单、工单流转卡片、全屏模态窗口。
- **后端服务**：由 **Cloudflare Pages Functions** 提供全套 RESTful API 与 Webhook 消息通知。
- **持久化数据库**：基于 **Cloudflare D1**（分布式 SQLite），免费提供 5GB 存储空间与每日 10 万次写操作，系统内置首次访问**自动建表与种子数据填充**。
- **现场图片存储**：基于 **Cloudflare R2**（S3 兼容对象存储），每月提供 **10GB 免费存储且 0 出网流量费**，专门保存现场报修照片与完工验收照片。

---

## 🚪 三大独立访问入口

| 入口角色 | 访问路径 | 适用群体 | 功能描述 |
| :--- | :--- | :--- | :--- |
| **师生在线报修端** | `https://your-domain.pages.dev/` | 全校师生、员工、访客 | 免登录极速报修、手机号查单、多图上传、撤销工单、催单、完工验收评价 |
| **维修师傅工作台** | `https://your-domain.pages.dev/worker` | 维修师傅团队 | 工号/手机号登录、待接工单接单、施工维修、上传完工照片、工作统计、修改密码 |
| **总务处调度中心** | `https://your-domain.pages.dev/admin` | 总务处管理人员 | 口令登录、工单池派工、驳回、超时SLA预警、人员与字典配置、钉钉/企微通知、二维码生成 |

---

## 🚀 3 分钟一键部署到 Cloudflare Pages

### 步骤 1：导入 GitHub 仓库并创建 Pages 应用
1. 打开并登录 [Cloudflare 控制台](https://dash.cloudflare.com/)。
2. 在左侧菜单点击 **Workers 和 Pages (Workers & Pages)** → 点击 **创建 (Create application)**。
3. 切换到 **Pages** 标签页 → 点击 **连接到 Git (Connect to Git)**。
4. 选中您的 GitHub 仓库 **`TwoBall/school-repair-system`** 并点击开始设置。
5. 配置构建参数：
   - **分支 (Production branch)**：选择 **`cloudflare-pages`**
   - **框架预设 (Framework preset)**：选择 **`Vite`** (或 `None`)
   - **构建命令 (Build command)**：填写 **`npm run build`**
   - **构建输出目录 (Build output directory)**：填写 **`dist`**
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
     - **变量名称 (Variable name)**：填写 **`PHOTOS`**
     - **R2 存储桶 (R2 bucket)**：选择刚才创建的 **`school-repair-photos`**
   - 点击 **保存 (Save)**。

---

### 步骤 4：重新部署生效
1. 切换到项目的 **部署 (Deployments)** 标签页。
2. 点击最新一条部署右侧的 **查看详情** 或 **重新部署 (Retry deployment)**。
3. 部署完成后，通过分配的域名即可分别访问三大端！
   *(首次打开页面时，系统会自动在 D1 中初始化数据表与预设数据)*。

---

## 🔑 初始默认账号

| 角色 | 入口地址 | 默认账号 | 初始密码 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| **总务处管理员** | `/admin` | 管理员口令 | `admin888` | 拥有全部管理权限，可在后台修改口令 |
| **维修师傅** | `/worker` | `13800000001` (张建国) | `worker888` | 独立登录接单与完工操作 |
| **师生 (报修人)** | `/` | 免登录 | 免密码 | 填写手机号即可报修、查单、催单 |

---

## 📁 本分支文件清单

- `index.html`：师生在线报修专区入口页面
- `worker.html`：维修师傅移动工作台入口页面
- `admin.html`：总务处综合调度中心入口页面
- `vite.config.js`：Vite 多页面微应用构建配置
- `src/`：前端模块化源码目录
  - `src/common/`：全局主题样式、响应式布局、API 请求、离线二维码与工具库
  - `src/reporter/`：师生端专属业务逻辑
  - `src/worker/`：维修师傅端专属业务逻辑
  - `src/admin/`：总务处调度端专属业务逻辑
- `functions/api/[[route]].js`：Cloudflare Pages Functions 边缘 API 全局网关（集成 D1 + R2）
- `schema.sql`：D1 数据库建表脚本定义
