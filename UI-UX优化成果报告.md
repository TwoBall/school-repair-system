# 学校总务报修系统 · UI/UX 优化成果报告

> 分支：`cloudflare-pages` | 完成日期：2026-10-22 | 涉及版本：v2.1.0
> 本文记录本轮对话中 **UI 重新设计 → 问题盘点 → P0/P1/P2 分批落地** 的完整成果，含架构约定、验收数据与遗留事项。

---

## 一、总览

本轮工作分三个阶段递进：

| 阶段 | 目标 | 条目 | 状态 |
| :--- | :--- | :--- | :--- |
| **基线重构** | 三端 UI 统一重做（Design System + SVG 图标 + 深色模式） | #1 ~ #6 | ✅ 完成 |
| **P0 体验止血** | 原生弹窗、图片上传、loading 覆盖、首屏白屏 | #7 ~ #10 | ✅ 完成 |
| **P1 体感升级** | 轮询刷新、事件委托、草稿校验、网络重试 | #11 ~ #14 | ✅ 完成 |
| **P2 细节打磨** | 无障碍 aria、主题过渡动画、重复报修提醒 | #15 ~ #17 | ✅ 完成 |
| **P3 数据可视化** | 看板趋势图、KPI 下钻、二维码下载 PNG | — | ⏸ 暂缓 |

**核心收益**（均为代码块改动带来的可验证变化，非主观描述）：

- 原生 `prompt` / `confirm` **9 处 → 0 处**；`window.*` 全局函数 **16 处 → 0 处**（仅剩合法的 `location` / `print` / `matchMedia`）。
- 图片上传接入**压缩 + XHR 真实进度条**（原先直传原图、无反馈）。
- 三端列表从「手动刷新」变为 **30s / 45s 自动轮询**，页面 hidden 自动停表。
- 表单有了 **7 天草稿** 与 **失焦即时校验**，网络故障可**一键重试**。
- 所有 chips 单选组具备 **radiogroup 键盘语义**，错误提示可被读屏播报。
- 新增 **重复报修提醒**，从源头减少重复派工。

---

## 二、基线：UI 重新设计（#1 ~ #6）

用户确认的四个方向：**三端统一重构 / 现代 SaaS 清爽版 / 深色模式（跟随系统 + 手动切换）/ 内联 SVG 替代 emoji**。

### 产出

| 文件 | 行数 | 说明 |
| :--- | :--- | :--- |
| `src/common/style.css` | 2057 | 完全重写为 Design System：令牌层 → 基础层 → 布局层 → 组件层 → 工具类 → 打印 → 减弱动效 |
| `src/common/icons.js` | 198 | 新增。56 个内联线性 SVG，全部 `stroke="currentColor"` |
| `src/reporter/main.js` | 1078 | 师生端重写，移除全部 emoji |
| `src/worker/main.js` | 603 | 师傅端重写 |
| `src/admin/main.js` | 1266 | 总务端重写 |

### 关键架构约定

1. **深浅色同构**：浅色定义在 `:root`，深色由 `[data-theme="dark"]` **覆盖同一套变量**，组件样式不写两遍。
2. **防深色闪屏**：三端 HTML 各内嵌一段同步 IIFE，在 `module` 加载前就设置 `data-theme` 与 `<meta name="theme-color">`（localStorage key：`bx_theme`）。
3. **响应式表格降级**：admin 工单大池用 `<table class="tbl">`，`td` 带 `data-l`；`@media (max-width:880px)` 下靠 `::before` 降级为卡片，由 `.cell-primary` / `.no-label` 控制标签显隐。
4. **打印样式内联**：派工单 `.print-head` / `.print-table` / `.print-sign` 全部收在 `@media print` 内。
5. **骨架屏不依赖 design token**：CSR 白屏治理中，`.boot-view` 作用域自带 `--boot-*` 变量。原因是 `style.css` 由 JS 注入、加载更晚，骨架不能依赖它；深浅色用 `html[data-theme="dark"]` 与 `@media (prefers-color-scheme: dark)` 双规则兜住，因此 `style.css` 内不留任何 `.boot-*` 定义。

---

## 三、问题盘点方法

未凭直觉列清单，而是**全量扫描 `src/` 源码**，把每个痛点定位到具体文件与行号：

| 痛点 | 定位证据 |
| :--- | :--- |
| 原生弹窗 9 处 | `admin/main.js` 407/798/810/900/912/947/959，`reporter/main.js` 543 |
| 图片无压缩无进度 | `api.js:42 uploadImage` 直传 FormData 原图，`<input type=file>` 缺 `capture` |
| 无自动刷新 | 全项目 0 处 `setInterval` / `visibilitychange` |
| 首屏白闪 | `index.html` 的 `#app` 为空，纯 CSR |
| loading 覆盖不全 | `btn.disabled` 散落 6 处，仅文案切换、无 spinner |
| CSP 不友好 | 16 个 `window.*` 全局函数 + 模板串内 `onclick` |
| 无障碍缺失 | `.label` 是 div/span，未与 input 建立 `for` 关联 |
| 校验时机滞后 | `markInvalid` 仅在 submit 调用；表单无草稿 |

据此排出 P0（止血）→ P1（体感）→ P2（细节）→ P3（增值）四级。

---

## 四、P0：体验止血（#7 ~ #10）

### #7 交互原语层

`src/common/utils.js` 收口为**全项目唯一实现**，禁止三端重复手写。本阶段新增：

- `withLoading(btn, text, task)` — 自动存/还原按钮原 HTML（存 `btn.dataset.rawHtml`），插 `.spinner`，`finally` 恢复。**约定：所有异步按钮必须走它，禁止手写 `btn.disabled`。**
- `confirmDialog({title, desc, okText, cancelText, danger, iconName})` → `Promise<boolean>`
- `promptDialog({title, desc, label, value, rows, maxlength, validate})` → `Promise<string|null>`
  - 两者统一经 `bindDialogEvents()` 支持 **ESC / 点遮罩取消、自动聚焦、输入即清错**。
- `compressImage(file, {maxEdge=1600, quality=0.82})` — 跳过 GIF 与 <300KB；压缩后反而变大则退回原图。
- `uploadWithProgress()` — 用 XHR（`xhr.upload.onprogress`，60s 超时）拿到**真实上传进度**。
- `uploadPhoto()` — 组合压缩 + 上传，>12MB 直接拒绝。
- `uploadingTile(id, label)` / `updateUploadTile(id, pct)` — 占位块进度条走 CSS 变量 `--p`。

### #8 替换 9 处原生弹窗

驳回原因 / 重置师傅密码 / 删师傅 / 删楼栋 / 新建楼栋 / 删分类 / 新建分类 / 报修人催单。
删除类统一 **danger 红色确认 + 不可撤销提示**。

### #9 图片上传接入压缩与进度

两端接入，`<input type=file>` 补 `capture="environment"`（移动端可直接调起相机）；同时允许重复选择同一张文件（`e.target.value = ''` 复位）。

### #10 统一 loading 与首屏骨架

- `withLoading` 接入 **13 个异步按钮**（admin 6 / reporter 3 / worker 4）。
- **顺带修掉一个既有 bug**：reporter 详情留言原文写的是 `send.disabled = true`（给函数对象赋属性），按钮从未真正禁用。
- 三端 HTML 内联 critical CSS + boot 骨架，消除白屏。
- 修 CSS bug：原先误写不存在的 `var(--danger-fg)`，已改为 `--danger-soft-fg`。

---

## 五、P1：体感升级（#11 ~ #14）

### utils.js 新增（续）

- `delegateActions(map, root=document)` — 从 `[data-act]` 用 `closest` 派发，同时挂 `click` 与 `keydown`（Enter/Space 仅对非 `BUTTON`/`A` 的 `role=button` 生效，天然补齐了 11 处自定义按钮的键盘可达性）。
- `createPoller(task, intervalMs, onDone)` — **页面隐藏自动停表，切回来立即补拉一次**；task 返回 `false` 表示本轮跳过（不在该标签页 / 有弹窗打开 / 容器不存在）；轮询异常静默吞掉不打扰用户。返回 `{refresh, stop, destroy, lastOkAt}`。
- `relTimeFrom(ts)` → 「刚刚更新 / N 秒前 / N 分钟前」。
- `toastRetry(msg, onRetry)` + `reportFailure(err, retry)` — 仅 `err.retryable` 时才给重试按钮。
- `runAction(btn, loadingText, task)` = `withLoading` + `reportFailure`，**重试会原样再跑一次 task**（已填内容保留）。三端 13 处原 `withLoading(...).catch(...)` 全部替换，`withLoading` 不再被三端直接引用。

### #12 事件委托替换 window 全局函数

- 41 处 `onclick="window.xxx()"` → `data-act`；15 处 `window.X = fn` → `const X = fn`。**源码已无任何 window 全局挂载**，CSP 友好。
- worker 的 `removeFinishPhoto` / `renderFinishPhotos` / `finishPhotos` 原定义在 `openFinishModal` 内部，委托取不到，**已提升到模块作用域**（open 时 `finishPhotos = []` 重置）。
- 写了交叉校验脚本：三端模板 `data-act` 与委托表键逐一比对，结果 **admin 10/10、reporter 8/8、worker 8/8 全对齐**。

### #11 轮询自动刷新 + 新高亮

| 端 | 场景 | 间隔 | 高亮策略 |
| :--- | :--- | :--- | :--- |
| admin | 工单大池 | 30s | `seenTicketIds` 累积集合算首见，>800 自动重建 |
| worker | 我的待办 | 30s | `seenTaskIds` 同上 |
| reporter | 我的报修 | 45s | 无「新单」概念，改为比对 `lastStatusMap` 的**状态变更**上色 |

- **首屏 non-silent 加载刻意不上色**，否则整屏会闪。
- CSS：`@keyframes rowFlash`（表行背景渐隐）与 `cardFlash`（卡片**边框 + 投影**渐隐，刻意不动 `background`，否则卡片会闪白）。
- 列表头 / 表格底加 `.poll-bar`：脉冲点 + 相对时间 + 立即刷新按钮。

### #13 表单草稿 + 即时校验

- **草稿**：`bx_reporter_draft`，TTL 7 天，600ms 防抖；覆盖 `bldg/room/desc/reporter/phone` + 三个 chips + 已上传照片 URL；`pagehide` 时把待写入草稿同步落盘（避免最后 600ms 输入丢失）。
- **UI**：`#draftBarHost` 两种态 —— 恢复态（`alert-warn` 提示已恢复 + 清空草稿）与已保存态（`草稿已自动保存 · HH:MM:SS`）。提交成功后 `clearFormDraft()`。
- **即时校验**：`FIELD_RULES` 集中定义 4 条规则（房间号 ≥2 字 / 描述 ≥5 字 / 联系人必填 / 手机号正则）；`touched` 集合控制「失焦后才实时校验」；提交时 `validateAll()` 强制校验并 focus 第一个错误项。替换了原先 submit 里逐行 `markInvalid` 的写法。

### #14 网络异常可重试

`src/common/api.js` 重写，**让上层能安全地提示重试**：

| 场景 | 判定 |
| :--- | :--- |
| AbortController 20s 超时 | `isTimeout` + `retryable = true` |
| fetch catch（断网） | `isNetwork` + `retryable = true` |
| HTTP 401 / 403 | `isAuth`（鉴权失效） |
| HTTP ≥ 500 | `retryable = true` |
| 业务 4xx | **不给重试**（重试也没用） |

- `.toast-notice` 原本 `pointer-events:none`，重试场景加 `.toast-retry { pointer-events:auto }`（含深色适配）。
- admin 大池 / 师傅 / 楼栋 / 分类、worker 列表、reporter 查询共 **6 处错误态**都带「重新加载」按钮；轮询失败则**保持原界面不动**（`if (silent) return`）。

---

## 六、P2：细节打磨（#15 ~ #17）

### #15 无障碍：label 与表单控件的 aria 关联

- `utils.js` 新增 `bindChipRadioGroup(box, {valueKey, label, labelId, onChange})`：`role=radiogroup` / `role=radio` / `aria-checked` + **roving tabindex** + 方向键 / Home / End 导航。
- 接入点：reporter 三组 chips（故障类别 / 紧急程度 / 身份）+ 评价星级组；admin 的 `poolStatusChips`、`manageSubTabChips`。
- 6 个无伴生标签的孤立控件补齐 `aria-label`：`photoFileInput`、`inputQueryPhone`、`finishFileInput`、三端的 `dlgCommentInput`。
- 校验反馈升级为 `aria-invalid` + `aria-describedby` + `id="${id}_err"` + `role="alert"`（读屏可即时播报）；4 个必填字段加 `aria-required="true"`。`clearFieldError` 同步移除这两个属性，避免指针残留到已删除节点。
- **踩坑记录**：`switchTab` 中必须先 `setupDraft()` 再 `bindFormEvents()` —— 草稿回填会 `innerHTML` 重绘照片区，绑定在前会被整片冲掉。

### #16 主题切换过渡动画

`toggleTheme()` 包进 `animateThemeSwitch()`，**三级降级**：

1. **支持 View Transitions**（Chrome / Edge / Safari 18+）：从主题按钮位置做**圆形揭示**，圆心坐标由按钮 `getBoundingClientRect()` 写入 `--theme-x` / `--theme-y`。
2. **不支持**：给 `<html>` 挂 `.theme-anim` 做 320ms 全局颜色淡变，动画窗口结束即摘除 —— 全局常驻 `transition` 会拖累渲染。
3. **开启「减弱动效」**：直接跳到终态。

配套 CSS 有两个值得记住的点：

- `:where(html.theme-anim) :where(*, *::before, *::after)` 把特异性压到 **0**。效果是：**自带 `transition` 的组件仍走自己的短过渡**，只有没写过渡的元素才吃这条全局淡变，两者互不打断。若不加 `:where()`，`html.theme-anim *` 的 `0,1,1` 会压过 `.chip` 的 `0,1,0`，把它们自己的过渡冲掉。
- 全局 `* { transition-duration: 0.01ms !important }` **命不中 `::view-transition-*` 伪元素**，因此单独补了一条 reduce 媒体查询。

### #17 重复报修提醒

后端 API（`functions/api/[[route]].js`）在本仓库内，但本项**刻意选择纯前端实现**：复用现有 `/api/tickets?phone=` 即可拿到同一手机号的工单，无需新增接口与数据库索引，且能在用户填写过程中**实时**给出提示，而不是等点提交后才被服务端拒绝。

**判重口径** —— 同一手机号 + 近 30 天 + 同楼栋 + 归一化房间号 + 同类别 + 工单仍未完结（`pending` / `assigned` / `working` / `done`）。

- `normRoom()`：去空白、转小写、剥掉「教室 / 房间 / 寝室 / 宿舍 / 办公室 / 号」后缀。`305教室`、`305 `、`305` 归一为同一处。
- **触发时机**：楼栋 change、房间号与手机号 blur、故障类别切换 → 800ms 防抖；进入表单页立即跑一次（草稿回填后可能已构成重复）。列表结果 **60s 内存缓存**，避免每次按键打接口。
- **UI**：`#dupBarHost` 落在提交按钮上方，`role="status"`；每条重复工单展示工单号 + 状态徽章 + 报修时间，可「查看进度」直达详情，或整条「知道了」折叠。
- **提交二次确认**：`bindSubmit` 里最后一刻再查一次，命中则弹 `confirmDialog(danger)` 让用户选「仍然提交 / 返回修改」。查重包了 **`Promise.race` 3 秒上限**，接口慢也绝不会把用户卡在提交这一步；查重接口失败则**静默降级**，不阻塞提交。

---

## 七、验证结果

### 构建产物

```
dist/assets/utils-*.css   31.48 kB │ gzip:  7.47 kB
dist/assets/utils-*.js    21.27 kB │ gzip:  8.44 kB
dist/assets/main-*.js     29.22 kB │ gzip:  9.44 kB   (reporter)
dist/assets/admin-*.js    60.64 kB │ gzip: 18.51 kB
dist/assets/worker-*.js   18.49 kB │ gzip:  5.80 kB
dist/index.html            3.23 kB │ gzip:  1.36 kB
dist/worker.html           3.23 kB │ gzip:  1.33 kB
dist/admin.html            3.42 kB │ gzip:  1.34 kB
✓ 16 modules transformed, built in ~3.3s
```

### 自动化校验

| 校验项 | 方法 | 结果 |
| :--- | :--- | :--- |
| dev 冒烟 | 单机起 Vite，请求 11 个关键资源 | **全 200，0 transform 错误** |
| window 全局挂载 | `grep "window.\w* ="` 排除 location/print/matchMedia | **0 处** |
| 原生 prompt / confirm | 源码 + dist 产物双重扫描 | **0 处**（仅注释提及） |
| emoji 残留 | Unicode 区段正则扫描 | **0 处** |
| SVG 图标完整性 | 解析 `PATHS` 与全部调用点比对 | 56 个全部命中，缺失 0 |
| `data-act` × 委托键对齐 | 脚本交叉比对三端模板与委托表 | admin 10/10、reporter 8/8、worker 8/8 |
| 查重逻辑单测 | 6 条样例数据的 Node 断言 | 正确排除已结单 / 超 30 天 / 不同楼栋 / 不同类别 4 类反例 |

---

## 八、工程约定（供后续维护遵循）

1. **交互原语只在 `utils.js` 实现一次**，三端引用。新增任何 Toast / Modal / Loading / 轮询行为前先看该文件是否已有。
2. **异步按钮一律用 `runAction`**（= `withLoading` + `reportFailure`），不允许手写 `btn.disabled`。
3. **列表类视图一律配 Poller + 错误态重试**，`silent` 刷新失败必须保持原界面。
4. **新增 `data-act` 必须同时补进 `delegateActions` 映射**，改完跑一次交叉比对脚本。
5. **骨架 / boot 样式不能依赖 design token**，自带变量并用双规则适配深浅色。
6. **动效必须被 `prefers-reduced-motion` 兜住**；注意伪元素不受全局 `*` 规则约束。
7. Vite 后台进程会随工具调用结束被回收，**启服务与发请求必须写在同一次命令内**；项目内写临时文件会触发 HMR reload，用完即删。

---

## 九、遗留事项（P3，暂缓）

| 项 | 说明 | 建议切入方式 |
| :--- | :--- | :--- |
| 看板趋势图 | admin 洞察页补近 N 日工单量 / 完结率曲线 | 复用 Design System 色令牌，SVG 内联绘制，不引第三方图表库 |
| KPI 下钻 | 首页 KPI 卡片点击钻取到对应工单列表 | 复用工单大池组件，透传筛选参数即可 |
| 二维码下载 PNG | 楼栋二维码当前为 canvas/SVG 渲染 | 用 `canvas.toDataURL('image/png')` + `<a download>`，注意 iOS Safari 需降级为长按保存 |

已知可改进点（非阻塞）：

- 重复报修提醒目前**只比对本机手机号**的工单。若要覆盖「同一房间的不同报修人」，需要后端提供按 `building + room` 的查询接口。
- `seenTicketIds` 累积集合在单页长期挂机场景下会增长（>800 自动重建），内存可控但状态会丢失，届时换新机会重新高亮一次。
