# 学校总务报修管理系统 - Cloudflare Pages + D1 + R2 纯云端版

本分支专为 **Cloudflare Serverless 纯云端环境** 定制，利用 Cloudflare 官方永久免费服务，实现 **无需本地开电脑、7×24小时在线、0秒冷启动、工单与照片永久持久化存储**。

前端采用 **Vite 多页面微应用架构**，将 **师生报修端**、**维修师傅端** 与 **总务管理端** 彻底拆分为 3 个独立页面，互相解耦、不相互干扰，并针对移动端与桌面端深度优化了响应式交互。

---

## 🌟 架构亮点

- **前端三端独立**：基于 Vite 构建的 3 个独立入口（师生端 `/`、师傅端 `/worker`、总务端 `/admin`），物理隔离，安全纯粹。
- **全端响应式设计**：移动端大触控靶点（≥44px）、网格弹性表单、工单流转卡片、全屏模态窗口。
- **后端服务**：由 **Cloudflare Pages Functions** 提供全套 RESTful API 与 Webhook 消息通知。
- **持久化数据库**：基于 **Cloudflare D1**（分布式 SQLite），免费提供 5GB 存储空间与每日 10 万次写操作，系统内置首次访问**自动建表与种子数据填充**。
- **现场图片存储**：基于 **Cloudflare R2**（S3 兼容对象存储），每月提供 **10GB 免费存储且 0 出网流量费**，专门保存现场报修照片与完工验收照片。

---

## 🎨 UI/UX 设计说明

本轮对三端 UI 做了从零重做与体验打磨，完整记录见 👉 **[UI-UX优化成果报告.md](./UI-UX优化成果报告.md)**。

- **Design System**：`src/common/style.css` 分为 令牌层 → 基础层 → 布局层 → 组件层 → 工具类 → 打印 → 减弱动效。浅色定义在 `:root`，深色由 `[data-theme="dark"]` 覆盖**同一套变量**，组件样式不写两遍。
- **内联 SVG 图标**：`src/common/icons.js` 提供 56 个图标，全部 `stroke="currentColor"`，自动适配深浅色、零网络请求，**全项目零 emoji**。
- **深色模式**：跟随系统 + 顶栏手动切换（`localStorage: bx_theme`）。三端 HTML 内联同步脚本预设主题，避免深色闪屏；切换时支持 View Transitions 圆形揭示动画，并在开启「减弱动效」时自动降级。
- **交互原语统一**：Toast / Modal / Loading / 上传进度 / 轮询 / 事件委托全部在 `src/common/utils.js` **实现一次**，三端只做引用。
- **可访问性**：单选 chips 具备 `radiogroup` 语义与方向键导航，表单错误可被读屏播报（`role="alert"`），表单控件均已建立标签关联。
- **移动端专项**：≥44px 大触控靶点、 `<input capture="environment">` 直调相机、图片上传前自动压缩（默认长边 1600px / 质量 0.82）并显示真实进度。

### 已落地的体验优化

| 分类 | 内容 |
| :--- | :--- |
| **反馈与状态** | 9 处原生 `prompt`/`confirm` 改为自定义弹窗；13 个异步按钮统一 loading 与 spinner；列表失败态提供「重新加载」；网络异常可一键重试 |
| **实时性** | 工单大池 / 师傅待办 30s 自动刷新，我的报修 45s；页面切后台自动停表，切回立即补拉；新工单与状态变更会上色提示 |
| **表单体验** | 7 天本地草稿自动保存（`bx_reporter_draft`）；失焦即时校验；提交前**重复报修提醒**，防止重复派工 |
| **健壮性** | 请求统一 20s 超时；网络 / 超时 / 5xx 判定为可重试，业务 4xx 不给重试；16 个 `window.*` 全局函数改造为事件委托，源码零全局挂载、CSP 友好 |
| **白屏治理** | 三端 HTML 内联 critical CSS + 骨架屏（骨架自带变量，不依赖 CSS 令牌注入顺序） |

---

## 🚪 三大独立访问入口

| 入口角色 | 访问路径 | 适用群体 | 功能描述 |
| :--- | :--- | :--- | :--- |
| **师生在线报修端** | `https://your-domain.pages.dev/` | 全校师生、员工、访客 | 免登录极速报修、手机号查单、多图上传、撤销工单、催单、完工验收评价 |
| **维修师傅工作台** | `https://your-domain.pages.dev/worker` | 维修师傅团队 | 工号/手机号登录、待接工单接单、施工维修、上传完工照片、**登记耗材/配件与配件购方**、工作统计、修改密码 |
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

## 🏫 内置楼栋字典

首次初始化写入的 16 条楼栋（编号 + 用途），可在 **管理后台 → 基础数据 → 楼栋** 增删改：

`A1–A4 教学楼`、`B1–B2 实训楼`、`C1–C8 宿舍`（C7 为教师宿舍）、`D区 行政办公楼`、`室外公共区域`

> 已上线的库会在下次访问时自动把**内置旧字典**（教学楼A栋 / 学生公寓1栋…）替换为上述编号；若你已自行改过字典，系统**不会覆盖**。
> 注意：楼栋改名**不回溯历史工单**（工单存的是名称快照）。

---

## 📁 本分支文件清单

- `index.html`：师生在线报修专区入口页面
- `worker.html`：维修师傅移动工作台入口页面
- `admin.html`：总务处综合调度中心入口页面
- `vite.config.js`：Vite 多页面微应用构建配置
- `src/`：前端模块化源码目录
  - `src/common/`：全局主题样式、响应式布局、API 请求、离线二维码与工具库
    - `style.css`：Design System 样式令牌与全部组件样式
    - `utils.js`：**交互原语唯一实现入口**（Toast / Modal / Loading / 上传 / 轮询 / 事件委托）
    - `icons.js`：56 个内联 SVG 图标与深浅色主题管理
    - `api.js`：统一 API 客户端（超时控制、错误归一化、可重试判定）
    - `qrcode.js`：离线二维码渲染
  - `src/reporter/`：师生端专属业务逻辑
  - `src/worker/`：维修师傅端专属业务逻辑
  - `src/admin/`：总务处调度端专属业务逻辑
- `functions/api/[[route]].js`：Cloudflare Pages Functions 边缘 API 全局网关（集成 D1 + R2）
- `schema.sql`：D1 数据库建表脚本定义
- `README.md`：本文件
- [总务报修系统使用手册.md](./总务报修系统使用手册.md)：面向师生 / 师傅 / 管理员的操作手册
- [UI-UX优化成果报告.md](./UI-UX优化成果报告.md)：UI 重做与 P0~P2 体验优化的完整技术记录

---

## 🛠 本地开发

```bash
npm install
npm run dev      # 本地开发，/api 代理到 http://localhost:3000
npm run build    # 产出到 dist/
npm run preview  # 预览构建产物
```

### 开发约定（改动前端前请先读一遍）

1. **交互原语只在 `src/common/utils.js` 实现一次**，三端引用，不要在各端重写。
2. **异步按钮一律用 `runAction()`**，禁止手写 `btn.disabled`。
3. **列表视图一律配 `createPoller` + 错误态重试**，`silent` 刷新失败必须保持原界面不动。
4. **新增 `data-act` 必须同时补进 `delegateActions` 映射**。
5. **骨架屏样式不能依赖 design token**（CSS 由 JS 注入、加载更晚），需自带变量。
6. **新增动效必须被 `prefers-reduced-motion` 兜住**；注意伪元素不受全局 `*` 规则约束。
