/**
 * 总务处调度管理中心 - 前端主逻辑
 * UI 层：design system (style.css) + 内联 SVG 图标 (icons.js)
 */
import '../common/style.css';
import { request, STATUS_MAP } from '../common/api.js';
import { escapeHtml, formatTime, formatShortTime, toast, openModal, closeModal, viewImage, exportToCsv, confirmDialog, promptDialog, runAction, delegateActions, createPoller, relTimeFrom, bindChipRadioGroup } from '../common/utils.js';
import { generateQrImage } from '../common/qrcode.js';
import { icon, categoryIcon, themeToggleBtn, bindThemeToggle } from '../common/icons.js';

let adminToken = localStorage.getItem('bx_admin_token') || '';
let currentTab = 'pool'; // 'pool' | 'dash' | 'manage' | 'qrcode'
let subManageTab = 'workers'; // 'workers' | 'buildings' | 'categories' | 'settings'

let allTickets = [];
// #11 轮询自动刷新：已见过的工单 id（用于识别新增）
const seenTicketIds = new Set();
let poolPoller = null;
let labelTimer = null;
let lastPoolRefresh = 0;

/** 批次徽标：多房间同批提交的工单共用 batchToken，标出「同批 N 间」便于整批派工 */
function batchBadgeHtml(t) {
  if (!t || !t.batchToken || (t.batchSize || 1) < 2) return '';
  return `<span class="batch-badge" title="批次 ${escapeHtml(t.batchToken)}">${icon('layers', 11)}同批 ${t.batchSize} 间</span>`;
}

/** 同一批次里除自己以外的其它房间（用当前列表做本地匹配，不额外打接口） */
function batchSiblings(t) {
  if (!t || !t.batchToken) return [];
  return allTickets.filter((x) => x.batchToken === t.batchToken && x.id !== t.id);
}

/** 工单档案里的「同批其它房间」一行，可点开对应工单 */
function batchRowHtml(t) {
  const sibs = batchSiblings(t);
  if (!sibs.length) return '';
  const items = sibs
    .map((x) => {
      const label = `${escapeHtml(x.room)}`;
      const st = STATUS_MAP[x.status] || { label: x.status };
      return `<button class="batch-link" type="button" data-act="admin-detail" data-id="${escapeHtml(x.id)}" title="${escapeHtml(x.id)} · ${escapeHtml(st.label)}">${label}</button>`;
    })
    .join('');
  return `<div class="info-row"><span class="k">同批其它房间</span><span class="v"><span class="batch-links">${items}</span></span></div>`;
}
let appConfig = { buildings: [], categories: [], workers: [], sla: {} };
let filterState = {
  status: 'all',
  building: 'all',
  category: 'all',
  search: '',
  timeoutOnly: false,
};

async function init() {
  if (!adminToken) {
    renderLoginView();
  } else {
    await loadConfig();
    renderAdminView();
  }
}

async function loadConfig() {
  try {
    appConfig = await request('/api/config');
  } catch (e) {
    console.error('加载系统基础配置失败:', e);
  }
}

// ----------------- 登录 -----------------
function renderLoginView() {
  document.getElementById('app').innerHTML = `
    <header class="topbar">
      <div class="nav-wrap">
        <div class="brand">
          <span class="logo-mark">${icon('school', 19)}</span>
          <div class="titles">
            <div class="title">总务处调度管理中心</div>
            <div class="subtitle">学校总务报修系统</div>
          </div>
        </div>
        <div class="topbar-actions">
          ${themeToggleBtn()}
        </div>
      </div>
    </header>

    <main class="app-container narrow">
      <div class="card mt-20">
        <div class="card-head">
          <div class="card-title">${icon('lock', 16)}管理员登录</div>
          <span class="card-sub">总务处专用</span>
        </div>
        <div class="field">
          <label class="label" for="adminKeyInput">总务管理员口令</label>
          <input class="control" type="password" id="adminKeyInput" placeholder="请输入管理口令" autocomplete="current-password">
        </div>
        <button class="btn btn-primary btn-block btn-lg mt-12" id="btnAdminLogin" type="button">${icon('dashboard', 17)}进入调度中心</button>
        <div class="hint center mt-12">${icon('info', 13)}忘记口令请联系系统维护人员重置</div>
      </div>
    </main>
  `;

  bindThemeToggle();

  const submit = async () => {
    const key = document.getElementById('adminKeyInput').value.trim();
    if (!key) {
      toast('请输入管理口令');
      return;
    }
    const btn = document.getElementById('btnAdminLogin');
    await runAction(btn, '正在验证…', async () => {
      const res = await request('/api/auth/login', { method: 'POST', body: { role: 'admin', key } });
      adminToken = res.token;
      localStorage.setItem('bx_admin_token', res.token);
      toast('验证成功，进入总务调度中心');
      await loadConfig();
      renderAdminView();
    });
  };

  document.getElementById('btnAdminLogin').onclick = submit;
  document.getElementById('adminKeyInput').onkeydown = (e) => { if (e.key === 'Enter') submit(); };
}

// ----------------- 后台骨架 -----------------
function renderAdminView() {
  const schoolName = escapeHtml(appConfig.schoolName || '总务处');
  document.getElementById('app').innerHTML = `
    <header class="topbar">
      <div class="nav-wrap">
        <div class="brand">
          <span class="logo-mark">${icon('school', 19)}</span>
          <div class="titles">
            <div class="title">${schoolName} · 调度管理中心</div>
            <div class="subtitle">工单派单 · 数据看板 · 基础配置</div>
          </div>
        </div>
        <div class="topbar-actions">
          <span class="user-chip hide-sm"><span class="avatar">${icon('user', 14)}</span><span class="name">总务处管理员</span></span>
          <button class="icon-btn" id="btnLogoutAdmin" type="button" aria-label="退出登录" title="退出登录">${icon('logout', 18)}</button>
          ${themeToggleBtn()}
        </div>
      </div>
    </header>

    <main class="app-container wide" id="adminMainContainer"></main>

    <nav class="tabbar" aria-label="后台导航">
      <button class="tabbar-item active" id="tabPoolBtn" type="button">
        ${icon('clipboard', 21)}<span>工单大池</span>
      </button>
      <button class="tabbar-item" id="tabDashBtn" type="button">
        ${icon('chart', 21)}<span>数据看板</span>
      </button>
      <button class="tabbar-item" id="tabManageBtn" type="button">
        ${icon('sliders', 21)}<span>基础配置</span>
      </button>
      <button class="tabbar-item" id="tabQrcodeBtn" type="button">
        ${icon('qr', 21)}<span>报修码</span>
      </button>
    </nav>
  `;

  document.getElementById('tabPoolBtn').onclick = () => switchTab('pool');
  document.getElementById('tabDashBtn').onclick = () => switchTab('dash');
  document.getElementById('tabManageBtn').onclick = () => switchTab('manage');
  document.getElementById('tabQrcodeBtn').onclick = () => switchTab('qrcode');
  document.getElementById('btnLogoutAdmin').onclick = logout;
  bindThemeToggle();

  switchTab('pool');
}

function switchTab(tab) {
  currentTab = tab;
  const map = { pool: 'tabPoolBtn', dash: 'tabDashBtn', manage: 'tabManageBtn', qrcode: 'tabQrcodeBtn' };
  Object.entries(map).forEach(([key, id]) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('active', tab === key);
  });

  const container = document.getElementById('adminMainContainer');
  if (tab === 'pool') {
    container.innerHTML = renderPoolView();
    bindPoolEvents();
    loadPoolTickets();
    startPoolPoller();
  } else if (tab === 'dash') {
    container.innerHTML = skeletonRows(3);
    loadDashboard();
  } else if (tab === 'manage') {
    container.innerHTML = renderManageView();
    bindManageEvents();
  } else if (tab === 'qrcode') {
    container.innerHTML = renderQrView();
    bindQrEvents();
  }
}

function skeletonRows(n) {
  return Array.from({ length: n }, () => '<div class="skeleton sk-block"></div>').join('');
}

function emptyBlock(iconName, title, desc) {
  return `<div class="card"><div class="empty">
    <div class="empty-icon">${icon(iconName, 22)}</div>
    <div class="empty-title">${escapeHtml(title)}</div>
    <div class="empty-desc">${escapeHtml(desc)}</div>
  </div></div>`;
}

/** 带「重新加载」的错误空态，用于首屏加载失败后给回退路径 */
function loadErrorBlock(err) {
  const title = err && err.retryable ? '网络异常，加载失败' : '加载失败';
  return `<div class="card"><div class="empty">
    <div class="empty-icon">${icon('alert', 22)}</div>
    <div class="empty-title">${escapeHtml(title)}</div>
    <div class="empty-desc">${escapeHtml(err && err.message ? err.message : '未知错误')}</div>
    <button class="btn btn-primary mt-16" type="button" id="btnBlockRetry">${icon('refresh', 14)}重新加载</button>
  </div></div>`;
}

/** 渲染错误空态并绑定重试按钮 */
function renderLoadError(container, err, retry) {
  if (!container) return;
  container.innerHTML = loadErrorBlock(err);
  const btn = document.getElementById('btnBlockRetry');
  if (btn) btn.onclick = retry;
}

// ----------------- 1. 工单调度大池 -----------------
function renderPoolView() {
  const bldgOptions = `<option value="all">全部楼栋</option>` + appConfig.buildings.map((b) => `<option value="${escapeHtml(b)}" ${filterState.building === b ? 'selected' : ''}>${escapeHtml(b)}</option>`).join('');
  const catOptions = `<option value="all">全部分类</option>` + appConfig.categories.map((c) => `<option value="${escapeHtml(c)}" ${filterState.category === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');

  return `
    <section class="card">
      <div class="card-head wrap">
        <div class="card-title">${icon('clipboard', 16)}工单调度大池</div>
        <button class="btn btn-sm btn-outline" id="btnExportCsv" type="button">${icon('download', 14)}导出 CSV 报表</button>
      </div>

      <div class="grid-form">
        <div class="field">
          <label class="label" for="poolSearchInput">关键词搜索</label>
          <input class="control" type="text" id="poolSearchInput" placeholder="单号 / 房间 / 描述 / 报修人 / 师傅" value="${escapeHtml(filterState.search)}">
        </div>
        <div class="field">
          <label class="label" for="poolBldgSelect">楼栋筛选</label>
          <div class="select-wrap"><select class="control" id="poolBldgSelect">${bldgOptions}</select></div>
        </div>
        <div class="field">
          <label class="label" for="poolCatSelect">分类筛选</label>
          <div class="select-wrap"><select class="control" id="poolCatSelect">${catOptions}</select></div>
        </div>
      </div>

      <div class="chips-group mt-8" id="poolStatusChips">
        <span class="chip ${filterState.status === 'all' && !filterState.timeoutOnly ? 'active' : ''}" data-st="all">全部</span>
        <span class="chip ${filterState.status === 'pending' ? 'active' : ''}" data-st="pending">待受理</span>
        <span class="chip ${filterState.status === 'assigned' ? 'active' : ''}" data-st="assigned">已派工</span>
        <span class="chip ${filterState.status === 'working' ? 'active' : ''}" data-st="working">维修中</span>
        <span class="chip ${filterState.status === 'done' ? 'active' : ''}" data-st="done">待验收</span>
        <span class="chip ${filterState.status === 'closed' ? 'active' : ''}" data-st="closed">已结单</span>
        <span class="chip danger ${filterState.timeoutOnly ? 'active' : ''}" data-st="timeout">${icon('alert', 14)}超时预警</span>
      </div>
    </section>

    <div id="poolListContainer">${skeletonRows(3)}</div>
  `;
}

function bindPoolEvents() {
  bindChipRadioGroup(document.getElementById('poolStatusChips'), {
    valueKey: 'st',
    label: '工单状态筛选',
    onChange: (st) => {
      if (st === 'timeout') {
        filterState.timeoutOnly = true;
        filterState.status = 'all';
      } else {
        filterState.timeoutOnly = false;
        filterState.status = st;
      }
      loadPoolTickets();
    },
  });

  const search = () => {
    filterState.search = document.getElementById('poolSearchInput').value.trim();
    filterState.building = document.getElementById('poolBldgSelect').value;
    filterState.category = document.getElementById('poolCatSelect').value;
    loadPoolTickets();
  };

  const btn = document.getElementById('btnFilterSearch');
  if (btn) btn.onclick = search;
  const input = document.getElementById('poolSearchInput');
  if (input) input.onkeydown = (e) => { if (e.key === 'Enter') search(); };
  ['poolBldgSelect', 'poolCatSelect'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.onchange = search;
  });

  const exportBtn = document.getElementById('btnExportCsv');
  if (exportBtn) exportBtn.onclick = handleExportCsv;
}

/** 记录本次工单 id，返回首见的 id 集合（silent 模式下才用于高亮） */
function diffNewIds(list) {
  const fresh = new Set(list.filter((t) => !seenTicketIds.has(t.id)).map((t) => t.id));
  list.forEach((t) => seenTicketIds.add(t.id));
  if (seenTicketIds.size > 800) {
    seenTicketIds.clear();
    list.forEach((t) => seenTicketIds.add(t.id));
  }
  return fresh;
}

/** 表格底部：统计 + 自动刷新状态条 */
function poolFootHtml(list, timeoutCount) {
  return `
    <div class="tbl-foot">
      <span>共 ${list.length} 条工单${timeoutCount > 0 ? `，其中超时 ${timeoutCount} 条` : ''}</span>
      <span class="poll-bar">
        <span class="poll-dot" aria-hidden="true"></span>
        <span id="poolPollLabel">${relTimeFrom(lastPoolRefresh)}</span>
        <button class="poll-refresh" type="button" id="btnPoolRefresh">${icon('refresh', 12)}立即刷新</button>
      </span>
    </div>`;
}

function updatePollLabel() {
  const el = document.getElementById('poolPollLabel');
  if (el) el.textContent = relTimeFrom(lastPoolRefresh);
}

/** 启动大池轮询（仅在"调度大池"标签页生效） */
function startPoolPoller() {
  if (poolPoller) return;
  poolPoller = createPoller(async () => {
    if (currentTab !== 'pool') return false; // 不在该页：跳过本轮
    if (document.querySelector('.modal-overlay')) return false; // 正在操作弹窗：不打断
    if (!document.getElementById('poolListContainer')) return false;
    await loadPoolTickets({ silent: true });
    return true;
  }, 30000, () => updatePollLabel());

  if (!labelTimer) labelTimer = setInterval(updatePollLabel, 30000);
}

async function loadPoolTickets({ silent = false } = {}) {
  const container = document.getElementById('poolListContainer');
  if (!container) return;
  if (!silent) container.innerHTML = skeletonRows(3);

  let q = '/api/tickets?';
  if (filterState.status !== 'all') q += `&status=${encodeURIComponent(filterState.status)}`;
  if (filterState.building !== 'all') q += `&building=${encodeURIComponent(filterState.building)}`;
  if (filterState.category !== 'all') q += `&category=${encodeURIComponent(filterState.category)}`;
  if (filterState.search) q += `&search=${encodeURIComponent(filterState.search)}`;

  try {
    let list = await request(q, { token: adminToken });
    if (filterState.timeoutOnly) list = list.filter((t) => t.isTimeout);

    // 静默轮询时算出新增工单用于高亮；首屏加载不上色（否则整屏都在闪）
    const newIds = diffNewIds(list);
    if (silent && newIds.size > 0) toast(`新增 ${newIds.size} 条报修工单`);

    allTickets = list;
    lastPoolRefresh = Date.now();

    if (list.length === 0) {
      container.innerHTML = emptyBlock('search', '未找到匹配的工单', '试试调整筛选条件或清空关键词');
      return;
    }

    const timeoutCount = list.filter((t) => t.isTimeout).length;
    const markNew = silent ? newIds : new Set();
    container.innerHTML = `
      ${timeoutCount > 0 ? `<div class="alert alert-danger mb-12">${icon('alert', 16)}<div>当前有 <strong>${timeoutCount}</strong> 单已超 SLA 时限，请尽快调度处理。</div></div>` : ''}
      <div class="tbl-wrap">
        <div class="tbl-scroll">
          <table class="tbl">
            <thead>
              <tr>
                <th>工单号</th>
                <th>报修位置</th>
                <th>报修人</th>
                <th>负责师傅</th>
                <th>状态</th>
                <th class="text-right">操作</th>
              </tr>
            </thead>
            <tbody>${list.map((t) => renderPoolRow(t, markNew.has(t.id))).join('')}</tbody>
          </table>
        </div>
        ${poolFootHtml(list, timeoutCount)}
      </div>`;

    const refreshBtn = document.getElementById('btnPoolRefresh');
    if (refreshBtn) refreshBtn.onclick = () => { updatePollLabel(); loadPoolTickets({ silent: true }); };
  } catch (err) {
    if (err.message && err.message.includes('未授权')) {
      logout();
      return;
    }
    if (silent) return; // 轮询失败保持原界面，避免整块被错误态覆盖
    renderLoadError(container, err, () => loadPoolTickets());
  }
}

function renderPoolRow(t, isNew = false) {
  const st = STATUS_MAP[t.status] || { label: t.status, cls: 'b-pending' };
  const timeoutBadge = t.isTimeout ? `<span class="badge b-timeout">${icon('alert', 12)}超时</span>` : '';
  const remindBadge = t.remindCount > 0 ? `<span class="badge b-remind">${icon('bell', 12)}催单 ${t.remindCount}</span>` : '';

  let actionsHtml = `<button class="btn btn-sm btn-outline" type="button" data-act="admin-detail" data-id="${escapeHtml(t.id)}">${icon('message', 14)}详情</button>`;
  if (t.status === 'pending' || t.status === 'assigned') {
    actionsHtml += `<button class="btn btn-sm btn-primary" type="button" data-act="assign" data-id="${escapeHtml(t.id)}">${icon('userCheck', 14)}派单</button>`;
  }
  if (t.status === 'pending') {
    actionsHtml += `<button class="btn btn-sm btn-danger" type="button" data-act="reject" data-id="${escapeHtml(t.id)}">${icon('ban', 14)}驳回</button>`;
  }
  actionsHtml += `<button class="btn btn-sm btn-ghost" type="button" data-act="print" data-id="${escapeHtml(t.id)}">${icon('printer', 14)}派工单</button>`;

  return `
    <tr class="${t.isTimeout ? 'is-timeout' : ''}${isNew ? ' is-new' : ''}">
      <td data-l="工单号"><span class="ticket-no">${escapeHtml(t.id)}</span></td>
      <td class="cell-primary" data-l="">
        <div class="cell-title">${icon('mapPin', 14)}<span>${escapeHtml(t.building)} ${escapeHtml(t.room)}</span>${batchBadgeHtml(t)}</div>
        <div class="cell-sub row gap-6 wrap">
          <span class="row gap-4">${categoryIcon(t.category, 13)}${escapeHtml(t.category)}</span>
          <span>·</span>
          <span class="row gap-4 ${t.urgency === '紧急' ? 'urgent strong' : ''}">${icon('alert', 13)}${escapeHtml(t.urgency)}</span>
          <span>·</span>
          <span>${formatShortTime(t.createdAt)}</span>
        </div>
      </td>
      <td data-l="报修人">
        <div>${escapeHtml(t.reporter)}<span class="cell-sub">${escapeHtml(t.identity)}</span></div>
        <div class="cell-sub mono">${escapeHtml(t.phone)}</div>
      </td>
      <td data-l="师傅">${t.assignee ? `<strong>${escapeHtml(t.assignee)}</strong>` : '<span class="subtle">未指派</span>'}</td>
      <td data-l="状态"><div class="badge-row start">${remindBadge}${timeoutBadge}<span class="badge ${st.cls}">${st.label}</span></div></td>
      <td data-l="" class="no-label"><div class="tbl-actions">${actionsHtml}</div></td>
    </tr>`;
}

// ----------------- 派单 / 驳回 / 详情 -----------------
const openAssignModal = (id) => {
  const options = appConfig.workers
    .map((w) => `<option value="${escapeHtml(w.name)}">${escapeHtml(w.name)}｜${escapeHtml(w.skill || '综合维修')}｜${escapeHtml(w.phone)}</option>`)
    .join('');

  openModal(`
    <div class="modal-header">
      <h3>${icon('userCheck', 18)}指派维修师傅</h3>
      <button class="modal-close-btn" type="button" data-act="modal-close" aria-label="关闭">${icon('close', 16)}</button>
    </div>
    <div class="modal-body">
      <div class="field">
        <label class="label" for="assignWorkerSelect"><span class="req">*</span>选择负责师傅</label>
        <div class="select-wrap"><select class="control" id="assignWorkerSelect">${options}</select></div>
      </div>
      <div class="field">
        <label class="label" for="assignNoteInput">派工说明 / 批注</label>
        <textarea class="control" id="assignNoteInput" placeholder="例如：带上专用工具，请在上午尽快到场排查"></textarea>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" type="button" data-act="modal-close">取消</button>
      <button class="btn btn-primary" id="btnConfirmAssign" type="button">${icon('check', 16)}确认指派</button>
    </div>
  `);

  document.getElementById('btnConfirmAssign').onclick = async () => {
    const worker = document.getElementById('assignWorkerSelect').value;
    const note = document.getElementById('assignNoteInput').value.trim();
    const btn = document.getElementById('btnConfirmAssign');
    await runAction(btn, '正在派工…', async () => {
      await request(`/api/tickets/${id}/assign`, { method: 'POST', token: adminToken, body: { worker, note } });
      toast(`已派工给 ${worker}`);
      closeModal();
      loadPoolTickets();
    });
  };
};

const rejectTicket = async (id) => {
  const note = await promptDialog({
    title: '驳回工单',
    desc: '驳回原因会同步展示给报修人，请写清原因便于对方理解。',
    label: '驳回原因',
    value: '不在维修范围或重复报修',
    rows: 3,
    maxlength: 100,
    iconName: 'close',
  });
  if (!note) return;
  try {
    await request(`/api/tickets/${id}/reject`, { method: 'POST', token: adminToken, body: { note } });
    toast('已驳回该工单');
    loadPoolTickets();
  } catch (err) {
    toast(err.message);
  }
};

const openAdminDetail = async (id) => {
  try {
    const t = await request(`/api/tickets/${id}`, { token: adminToken });
    const st = STATUS_MAP[t.status] || { label: t.status, cls: 'b-pending' };

    const timeoutAlert = t.isTimeout
      ? `<div class="alert alert-danger mb-12">${icon('alert', 16)}<div><strong>超时预警</strong>：${escapeHtml(t.timeoutReason)}</div></div>`
      : '';

    const photosHtml = t.photos && t.photos.length > 0
      ? `<div class="mt-12">
          <div class="label">现场报修照片</div>
          <div class="photos-grid">${t.photos.map((p, i) => `<div class="photo-item"><img src="${escapeHtml(p)}" alt="现场照片 ${i + 1}" data-act="view-photo" data-src="${escapeHtml(p)}" role="button" tabindex="0"></div>`).join('')}</div>
        </div>`
      : '';

    const finishHtml = t.result
      ? `<div class="alert alert-ok mt-12 col gap-4 start">
          ${icon('checkCircle', 16)}
          <div>
            <strong>维修结果</strong>
            <div class="mt-4">${escapeHtml(t.result)}</div>
            ${(t.material || t.materialSource) ? `<div class="mt-4">${icon('receipt', 13)} <strong>耗材/配件</strong>：${escapeHtml(t.material || '未填写')} ｜ <strong>配件购方</strong>：${escapeHtml(t.materialSource || '未填写')}</div>` : ''}
            ${t.finishPhotos && t.finishPhotos.length > 0 ? `<div class="photos-grid">${t.finishPhotos.map((p, i) => `<div class="photo-item"><img src="${escapeHtml(p)}" alt="完工照片 ${i + 1}" data-act="view-photo" data-src="${escapeHtml(p)}" role="button" tabindex="0"></div>`).join('')}</div>` : ''}
          </div>
        </div>`
      : '';

    const ratingHtml = t.rating
      ? `<div class="alert alert-warn mt-12 col gap-4 start">
          ${icon('star', 16)}
          <div><strong>用户评分</strong> ${t.rating.score} 星
            <div class="mt-4">${escapeHtml(t.rating.comment || '未填写评价')}</div>
          </div>
        </div>`
      : '';

    const timelineHtml = `
      <div class="mt-16">
        <div class="card-title mb-8 fs-14">${icon('history', 16)}流转轨迹</div>
        <div class="timeline">
          ${(t.timeline || []).map((tl) => `
            <div class="tl-item">
              <div class="tl-action">${escapeHtml(tl.action)}<span class="tl-meta">${escapeHtml(tl.by)} · ${formatShortTime(tl.t)}</span></div>
              ${tl.note ? `<div class="tl-note">${escapeHtml(tl.note)}</div>` : ''}
            </div>`).join('')}
        </div>
      </div>`;

    const roleLabel = (r) => (r === 'admin' ? '总务处' : r === 'worker' ? '维修师傅' : '报修人');
    const commentsHtml = `
      <div class="thread mt-12">
        <div class="thread-head">${icon('message', 16)}各方沟通留言 <span class="badge b-plain">${(t.comments || []).length}</span></div>
        <div class="thread-list">
          ${(t.comments || []).length === 0
            ? `<div class="subtle fs-13">暂无留言</div>`
            : (t.comments || []).map((c) => `
              <div class="thread-item">
                <div class="thread-meta">
                  <span><strong>${escapeHtml(c.senderName)}</strong> · ${roleLabel(c.senderRole)}</span>
                  <span>${formatShortTime(c.createdAt)}</span>
                </div>
                <div class="thread-body">${escapeHtml(c.content)}</div>
              </div>`).join('')}
        </div>
        <div class="composer">
          <input class="control" type="text" id="dlgCommentInput" aria-label="留言内容" placeholder="输入总务处指导意见...">
          <button class="btn btn-primary shrink-0" id="dlgSendCommentBtn" type="button">${icon('send', 16)}</button>
        </div>
      </div>`;

    openModal(`
      <div class="modal-header">
        <h3>${icon('receipt', 18)}工单档案<span class="subtle fs-13 mono">${escapeHtml(t.id)}</span></h3>
        <button class="modal-close-btn" type="button" data-act="modal-close" aria-label="关闭">${icon('close', 16)}</button>
      </div>
      <div class="modal-body">
        ${timeoutAlert}
        <div class="row gap-8 wrap mb-12">
          <span class="badge ${st.cls}">${st.label}</span>
          <strong class="fs-16">${escapeHtml(t.building)} ${escapeHtml(t.room)}</strong>
          ${batchBadgeHtml(t)}
        </div>
        <div class="soft-block">
          <div class="info-list">
            <div class="info-row"><span class="k">故障分类</span><span class="v">${categoryIcon(t.category, 14)}${escapeHtml(t.category)}｜紧急度 <strong>${escapeHtml(t.urgency)}</strong></span></div>
            <div class="info-row"><span class="k">报修人</span><span class="v">${escapeHtml(t.reporter)}（${escapeHtml(t.identity)}）· <span class="mono">${escapeHtml(t.phone)}</span></span></div>
            <div class="info-row"><span class="k">负责师傅</span><span class="v">${t.assignee ? escapeHtml(t.assignee) : '<span class="subtle">未指派</span>'}</span></div>
            <div class="info-row"><span class="k">提交时间</span><span class="v">${formatTime(t.createdAt)}</span></div>
            <div class="info-row"><span class="k">故障描述</span><span class="v">${escapeHtml(t.desc)}</span></div>
            ${batchRowHtml(t)}
          </div>
          ${photosHtml}
        </div>
        ${finishHtml}
        ${ratingHtml}
        ${timelineHtml}
        ${commentsHtml}
      </div>
    `);

    const input = document.getElementById('dlgCommentInput');
    const btn = document.getElementById('dlgSendCommentBtn');
    const send = async () => {
      const content = input.value.trim();
      if (!content) return;
      const run = async () => {
        await request(`/api/tickets/${t.id}/comments`, {
          method: 'POST',
          token: adminToken,
          body: { senderRole: 'admin', senderName: '总务处管理员', content },
        });
        openAdminDetail(t.id);
      };
      await runAction(btn, '发送中…', run);
    };
    btn.onclick = send;
    input.onkeydown = (e) => { if (e.key === 'Enter') send(); };
  } catch (err) {
    toast(err.message);
  }
};

const printTicket = async (id) => {
  const t = await request(`/api/tickets/${id}`, { token: adminToken });
  const st = STATUS_MAP[t.status] || { label: t.status };

  // 耗材信息仅在师傅已登记时出现，派工单保持干净，完工后自动成为存档记录
  const materialRowHtml = (t.material || t.materialSource)
    ? `<tr>
        <th>耗材 / 配件</th><td class="cell-wide">${escapeHtml(t.material || '无')}</td>
        <th>配件购方</th><td class="cell-wide">${escapeHtml(t.materialSource || '无')}</td>
      </tr>`
    : '';

  const printDiv = document.createElement('div');
  printDiv.className = 'print-sheet';
  printDiv.innerHTML = `
    <div class="print-head">
      <h2>${escapeHtml(appConfig.schoolName || '学校总务处')} · 设备报修派工单</h2>
      <div class="print-sub">工单编号：${escapeHtml(t.id)} ｜ 打印时间：${formatTime(Date.now())}</div>
    </div>
    <table class="print-table">
      <tr>
        <th>报修地点</th><td class="cell-wide">${escapeHtml(t.building)} ${escapeHtml(t.room)}</td>
        <th>故障类别</th><td class="cell-wide">${escapeHtml(t.category)} (${escapeHtml(t.urgency)})</td>
      </tr>
      <tr>
        <th>报修人员</th><td>${escapeHtml(t.reporter)} (${escapeHtml(t.identity)})</td>
        <th>联系电话</th><td>${escapeHtml(t.phone)}</td>
      </tr>
      <tr>
        <th>报修时间</th><td>${formatTime(t.createdAt)}</td>
        <th>当前状态</th><td>${st.label}</td>
      </tr>
      <tr>
        <th>指派师傅</th><td>${escapeHtml(t.assignee || '未指派')}</td>
        <th>完工时间</th><td>${formatTime(t.completedAt)}</td>
      </tr>
      <tr>
        <th>故障描述</th>
        <td colspan="3" class="tall-60">${escapeHtml(t.desc)}</td>
      </tr>
      <tr>
        <th class="th-wrap">维修记录及耗材说明</th>
        <td colspan="3" class="tall-80">${escapeHtml(t.result || '现场排查中...')}</td>
      </tr>
      ${materialRowHtml}
    </table>
    <div class="print-sign">
      <div class="sign-item"><span class="sign-line"></span><span class="sign-cap">报修人验收签名</span></div>
      <div class="sign-item"><span class="sign-line"></span><span class="sign-cap">维修师傅签名</span></div>
      <div class="sign-item"><span class="sign-line"></span><span class="sign-cap">总务处审核盖章</span></div>
    </div>
  `;
  document.body.appendChild(printDiv);
  window.print();
  setTimeout(() => {
    if (printDiv.parentNode) printDiv.parentNode.removeChild(printDiv);
  }, 1000);
};

function handleExportCsv() {
  if (!allTickets || allTickets.length === 0) {
    toast('当前列表无工单可导出');
    return;
  }
  const headers = ['工单编号', '报修时间', '楼栋', '房间', '类别', '紧急度', '报修人', '电话', '身份', '状态', '师傅', '描述', '结果', '耗材/配件', '配件购方', '超时情况', '评分', '评价内容', '批次号'];
  const rows = allTickets.map((t) => [
    t.id,
    formatTime(t.createdAt),
    t.building,
    t.room,
    t.category,
    t.urgency,
    t.reporter,
    t.phone,
    t.identity,
    STATUS_MAP[t.status]?.label || t.status,
    t.assignee || '',
    (t.desc || '').replace(/[\r\n]+/g, ' '),
    (t.result || '').replace(/[\r\n]+/g, ' '),
    (t.material || '').replace(/[\r\n]+/g, ' '),
    (t.materialSource || '').replace(/[\r\n]+/g, ' '),
    t.isTimeout ? t.timeoutReason : '正常',
    t.rating?.score || '',
    (t.rating?.comment || '').replace(/[\r\n]+/g, ' '),
    t.batchToken || '',
  ]);
  exportToCsv(`总务报修导出_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
}

// ----------------- 2. 数据统计看板 -----------------
async function loadDashboard() {
  const container = document.getElementById('adminMainContainer');
  try {
    const st = await request('/api/stats/dashboard', { token: adminToken });
    const kpi = (cls, iconName, val, label, clickable) => `
      <div class="kpi-card ${clickable ? 'clickable' : ''}" ${clickable ? 'id="cardKpiTimeout"' : ''}>
        <div class="kpi-body">
          <div class="val">${val}</div>
          <div class="lbl">${label}</div>
        </div>
        <span class="kpi-icon ${cls}">${icon(iconName, 20)}</span>
      </div>`;

    container.innerHTML = `
      <div class="kpi-grid">
        ${kpi('i-brand', 'receipt', st.total, '累计报修总数')}
        ${kpi('i-warn', 'clock', st.pending + st.assigned + st.working, '在办工单')}
        ${kpi('i-ok', 'checkCircle', `${st.finishRate}%`, '综合办结率')}
        ${kpi('i-cyan', 'star', `${st.avgScore}`, '平均服务评分')}
        ${kpi('i-danger', 'alert', st.timeouts, '超时工单（点击过滤）', true)}
      </div>

      <section class="card">
        <div class="card-head">
          <div class="card-title">${icon('chart', 16)}故障分类报修分布</div>
          <span class="card-sub">按工单量排序</span>
        </div>
        <div class="bar-list">${renderBarList(st.catMap)}</div>
      </section>

      <section class="card">
        <div class="card-head">
          <div class="card-title">${icon('school', 16)}校区楼栋报修频次</div>
          <span class="card-sub">便于定位高频区域</span>
        </div>
        <div class="bar-list">${renderBarList(st.bldgMap)}</div>
      </section>
    `;

    const timeoutCard = document.getElementById('cardKpiTimeout');
    if (timeoutCard) {
      timeoutCard.onclick = () => {
        filterState.timeoutOnly = true;
        filterState.status = 'all';
        switchTab('pool');
      };
    }
  } catch (err) {
    container.innerHTML = emptyBlock('alert', '统计加载失败', err.message);
  }
}

function renderBarList(map) {
  if (!map) return '<div class="subtle fs-13">暂无数据</div>';
  const keys = Object.keys(map).sort((a, b) => map[b] - map[a]);
  if (keys.length === 0) return '<div class="subtle fs-13">暂无数据</div>';
  const max = map[keys[0]] || 1;
  return keys
    .map((k) => {
      const v = map[k];
      const pct = Math.round((v / max) * 100);
      return `
        <div class="bar-row">
          <span class="bar-name">${escapeHtml(k)}</span>
          <span class="bar-track"><span class="bar-fill" style="width: ${pct}%;"></span></span>
          <span class="bar-val">${v}</span>
        </div>`;
    })
    .join('');
}

// ----------------- 3. 基础配置中心 -----------------
function renderManageView() {
  const sub = (key, iconName, label) =>
    `<span class="chip ${subManageTab === key ? 'active' : ''}" data-sub="${key}">${icon(iconName, 15)}${label}</span>`;

  return `
    <section class="card">
      <div class="card-head">
        <div class="card-title">${icon('sliders', 16)}基础数据与系统设置</div>
      </div>
      <div class="chips-group" id="manageSubTabChips">
        ${sub('workers', 'users', '维修师傅')}
        ${sub('buildings', 'school', '校区楼栋')}
        ${sub('categories', 'layers', '故障分类')}
        ${sub('settings', 'bell', '预警与通知')}
      </div>
    </section>
    <div id="manageSubContainer"></div>
  `;
}

function bindManageEvents() {
  bindChipRadioGroup(document.getElementById('manageSubTabChips'), {
    valueKey: 'sub',
    label: '基础数据配置分类',
    onChange: (sub) => {
      subManageTab = sub;
      loadSubManage();
    },
  });
  loadSubManage();
}

function subCardShell(title, iconName, addBtnId, addLabel, wrapperId) {
  return `
    <section class="card">
      <div class="card-head wrap">
        <div class="card-title">${icon(iconName, 16)}${title}</div>
        <button class="btn btn-sm btn-primary" id="${addBtnId}" type="button">${icon('plus', 14)}${addLabel}</button>
      </div>
      <div id="${wrapperId}">${skeletonRows(2)}</div>
    </section>`;
}

async function loadSubManage() {
  const container = document.getElementById('manageSubContainer');
  if (!container) return;

  if (subManageTab === 'workers') {
    container.innerHTML = subCardShell('维修师傅账号与专长', 'users', 'btnAddWorkerBtn', '添加师傅', 'workerListWrapper');
    document.getElementById('btnAddWorkerBtn').onclick = openAddWorkerModal;
    loadWorkersTable();
  } else if (subManageTab === 'buildings') {
    container.innerHTML = subCardShell('校区楼栋区域维护', 'school', 'btnAddBldgBtn', '添加楼栋', 'bldgListWrapper');
    document.getElementById('btnAddBldgBtn').onclick = openAddBldgModal;
    loadBldgsTable();
  } else if (subManageTab === 'categories') {
    container.innerHTML = subCardShell('报修分类项目维护', 'layers', 'btnAddCatBtn', '添加分类', 'catListWrapper');
    document.getElementById('btnAddCatBtn').onclick = openAddCatModal;
    loadCatsTable();
  } else if (subManageTab === 'settings') {
    container.innerHTML = skeletonRows(2);
    loadSettingsForm();
  }
}

function simpleTable(headers, rowsHtml) {
  return `
    <div class="tbl-wrap">
      <div class="tbl-scroll">
        <table class="tbl">
          <thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    </div>`;
}

async function loadWorkersTable() {
  const box = document.getElementById('workerListWrapper');
  if (!box) return;
  try {
    const list = await request('/api/admin/workers', { token: adminToken });
    if (!list.length) {
      box.innerHTML = emptyBlock('users', '暂无维修师傅', '点击右上角添加第一个师傅账号');
      return;
    }
    box.innerHTML = simpleTable(
      ['姓名', '工号 / 手机', '维修专长', '状态', '操作'],
      list.map((w) => `
        <tr>
          <td class="cell-primary"><div class="cell-title">${escapeHtml(w.name)}</div></td>
          <td data-l="手机号" class="mono">${escapeHtml(w.phone)}</td>
          <td data-l="专长">${escapeHtml(w.skill || '--')}</td>
          <td data-l="状态">${w.active ? '<span class="badge b-done">启用</span>' : '<span class="badge b-rejected">停用</span>'}</td>
          <td data-l="" class="no-label">
            <div class="tbl-actions">
              <button class="btn btn-sm btn-outline" type="button" data-act="worker-pwd" data-id="${escapeHtml(w.id)}">${icon('lock', 14)}重置密码</button>
              <button class="btn btn-sm btn-danger" type="button" data-act="worker-del" data-id="${escapeHtml(w.id)}">${icon('trash', 14)}删除</button>
            </div>
          </td>
        </tr>`).join('')
    );
  } catch (err) {
    renderLoadError(box, err, () => loadWorkersTable());
  }
}

const editWorkerPwd = async (id) => {
  const newPwd = await promptDialog({
    title: '重置登录密码',
    desc: '重置后请通知该师傅使用新密码登录。',
    label: '新密码',
    placeholder: '至少 4 位',
    maxlength: 32,
    iconName: 'lock',
    validate: (v) => (v.length < 4 ? '密码至少需要 4 位' : null),
  });
  if (!newPwd) return;
  try {
    await request(`/api/admin/workers/${id}`, { method: 'PUT', token: adminToken, body: { password: newPwd } });
    toast('密码已重置');
    loadWorkersTable();
  } catch (err) {
    toast(err.message);
  }
};

const deleteWorker = async (id) => {
  const ok = await confirmDialog({
    title: '删除维修师傅账号',
    desc: '删除后该师傅将无法登录，其历史完工记录会保留。此操作不可撤销。',
    okText: '确认删除',
    danger: true,
    iconName: 'trash',
  });
  if (!ok) return;
  try {
    await request(`/api/admin/workers/${id}`, { method: 'DELETE', token: adminToken });
    toast('已删除');
    loadWorkersTable();
    loadConfig();
  } catch (err) {
    toast(err.message);
  }
};

function openAddWorkerModal() {
  openModal(`
    <div class="modal-header">
      <h3>${icon('plus', 18)}添加维修师傅账号</h3>
      <button class="modal-close-btn" type="button" data-act="modal-close" aria-label="关闭">${icon('close', 16)}</button>
    </div>
    <div class="modal-body">
      <div class="field">
        <label class="label" for="add_w_name"><span class="req">*</span>师傅姓名</label>
        <input class="control" type="text" id="add_w_name" placeholder="例如：刘师傅">
      </div>
      <div class="field">
        <label class="label" for="add_w_phone"><span class="req">*</span>手机号（兼登录账号）</label>
        <input class="control" type="tel" id="add_w_phone" maxlength="11" inputmode="numeric" placeholder="11 位手机号">
      </div>
      <div class="field">
        <label class="label" for="add_w_skill">擅长项目</label>
        <input class="control" type="text" id="add_w_skill" placeholder="例如：水电暖通、多媒体设施">
      </div>
      <div class="field">
        <label class="label" for="add_w_pwd">初始密码</label>
        <input class="control" type="text" id="add_w_pwd" value="worker888">
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" type="button" data-act="modal-close">取消</button>
      <button class="btn btn-primary" id="btnConfirmAddWorker" type="button">${icon('check', 16)}确认创建</button>
    </div>
  `);

  document.getElementById('btnConfirmAddWorker').onclick = async () => {
    const name = document.getElementById('add_w_name').value.trim();
    const phone = document.getElementById('add_w_phone').value.trim();
    const skill = document.getElementById('add_w_skill').value.trim();
    const password = document.getElementById('add_w_pwd').value.trim();
    if (!name || !phone) { toast('请填写姓名和手机号'); return; }
    const btn = document.getElementById('btnConfirmAddWorker');
    await runAction(btn, '正在创建…', async () => {
      await request('/api/admin/workers', { method: 'POST', token: adminToken, body: { name, phone, skill, password } });
      toast('师傅账号创建成功');
      closeModal();
      loadWorkersTable();
      loadConfig();
    });
  };
}

async function loadBldgsTable() {
  const box = document.getElementById('bldgListWrapper');
  if (!box) return;
  try {
    const list = await request('/api/admin/buildings', { token: adminToken });
    if (!list.length) {
      box.innerHTML = emptyBlock('school', '暂无楼栋', '点击右上角添加楼栋');
      return;
    }
    box.innerHTML = simpleTable(
      ['楼栋名称', '状态', '操作'],
      list.map((b) => `
        <tr>
          <td class="cell-primary"><div class="cell-title">${icon('school', 14)}<span>${escapeHtml(b.name)}</span></div></td>
          <td data-l="状态"><span class="badge b-done">启用</span></td>
          <td data-l="" class="no-label">
            <div class="tbl-actions">
              <button class="btn btn-sm btn-danger" type="button" data-act="bldg-del" data-id="${b.id}">${icon('trash', 14)}删除</button>
            </div>
          </td>
        </tr>`).join('')
    );
  } catch (err) {
    renderLoadError(box, err, () => loadBldgsTable());
  }
}

const deleteBldg = async (id) => {
  const ok = await confirmDialog({
    title: '删除楼栋',
    desc: '删除后师生报修时将无法再选择该楼栋，历史工单不受影响。此操作不可撤销。',
    okText: '确认删除',
    danger: true,
    iconName: 'trash',
  });
  if (!ok) return;
  try {
    await request(`/api/admin/buildings/${id}`, { method: 'DELETE', token: adminToken });
    toast('已删除');
    loadBldgsTable();
    loadConfig();
  } catch (err) {
    toast(err.message);
  }
};

async function openAddBldgModal() {
  const name = await promptDialog({
    title: '添加楼栋',
    desc: '楼栋会出现在报修表单的位置下拉选项中。',
    label: '楼栋名称',
    placeholder: '例如：实验实训楼B座',
    maxlength: 20,
    iconName: 'layers',
  });
  if (!name) return;
  try {
    await request('/api/admin/buildings', { method: 'POST', token: adminToken, body: { name: name.trim() } });
    toast('楼栋添加成功');
    loadBldgsTable();
    loadConfig();
  } catch (err) {
    toast(err.message);
  }
}

async function loadCatsTable() {
  const box = document.getElementById('catListWrapper');
  if (!box) return;
  try {
    const list = await request('/api/admin/categories', { token: adminToken });
    if (!list.length) {
      box.innerHTML = emptyBlock('layers', '暂无分类', '点击右上角添加故障分类');
      return;
    }
    box.innerHTML = simpleTable(
      ['分类名称', '状态', '操作'],
      list.map((c) => `
        <tr>
          <td class="cell-primary"><div class="cell-title">${categoryIcon(c.name, 14)}<span>${escapeHtml(c.name)}</span></div></td>
          <td data-l="状态"><span class="badge b-done">启用</span></td>
          <td data-l="" class="no-label">
            <div class="tbl-actions">
              <button class="btn btn-sm btn-danger" type="button" data-act="cat-del" data-id="${c.id}">${icon('trash', 14)}删除</button>
            </div>
          </td>
        </tr>`).join('')
    );
  } catch (err) {
    renderLoadError(box, err, () => loadCatsTable());
  }
}

const deleteCat = async (id) => {
  const ok = await confirmDialog({
    title: '删除故障分类',
    desc: '删除后新建报修将无法选择该分类，已有工单的分类名称保留。此操作不可撤销。',
    okText: '确认删除',
    danger: true,
    iconName: 'trash',
  });
  if (!ok) return;
  try {
    await request(`/api/admin/categories/${id}`, { method: 'DELETE', token: adminToken });
    toast('已删除');
    loadCatsTable();
    loadConfig();
  } catch (err) {
    toast(err.message);
  }
};

async function openAddCatModal() {
  const name = await promptDialog({
    title: '添加故障分类',
    desc: '分类名称建议 2–6 个字，便于师生快速选择。',
    label: '分类名称',
    placeholder: '例如：弱电监控设备',
    maxlength: 12,
    iconName: 'layers',
  });
  if (!name) return;
  try {
    await request('/api/admin/categories', { method: 'POST', token: adminToken, body: { name: name.trim() } });
    toast('分类添加成功');
    loadCatsTable();
    loadConfig();
  } catch (err) {
    toast(err.message);
  }
}

async function loadSettingsForm() {
  const box = document.getElementById('manageSubContainer');
  try {
    const s = await request('/api/admin/settings', { token: adminToken });
    box.innerHTML = `
      <section class="card">
        <div class="card-head">
          <div class="card-title">${icon('school', 16)}机构信息</div>
        </div>
        <div class="field">
          <label class="label" for="s_school_name">系统单位抬头名称</label>
          <input class="control" type="text" id="s_school_name" value="${escapeHtml(s.school_name || '')}">
        </div>
      </section>

      <section class="card">
        <div class="card-head">
          <div class="card-title">${icon('clock', 16)}SLA 超时预警（小时）</div>
        </div>
        <div class="grid-form">
          <div class="field">
            <label class="label" for="s_sla_pending">待受理超时</label>
            <input class="control" type="number" id="s_sla_pending" value="${escapeHtml(s.sla_pending_hours || 4)}">
          </div>
          <div class="field">
            <label class="label" for="s_sla_accept">派工未接单超时</label>
            <input class="control" type="number" id="s_sla_accept" value="${escapeHtml(s.sla_accept_hours || 8)}">
          </div>
          <div class="field">
            <label class="label" for="s_sla_finish">接单未完工超时</label>
            <input class="control" type="number" id="s_sla_finish" value="${escapeHtml(s.sla_finish_hours || 24)}">
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card-head">
          <div class="card-title">${icon('bell', 16)}工作群机器人通知</div>
        </div>
        <div class="field">
          <label class="label" for="s_webhook_type">推送渠道</label>
          <div class="select-wrap">
            <select class="control" id="s_webhook_type">
              <option value="none" ${s.webhook_type === 'none' ? 'selected' : ''}>关闭推送</option>
              <option value="wecom" ${s.webhook_type === 'wecom' ? 'selected' : ''}>企业微信群机器人</option>
              <option value="dingtalk" ${s.webhook_type === 'dingtalk' ? 'selected' : ''}>钉钉群机器人</option>
              <option value="feishu" ${s.webhook_type === 'feishu' ? 'selected' : ''}>飞书自定义机器人</option>
            </select>
          </div>
        </div>
        <div class="field">
          <label class="label" for="s_webhook_url">Webhook 推送地址</label>
          <input class="control" type="text" id="s_webhook_url" placeholder="https://qyapi.weixin.qq.com/..." value="${escapeHtml(s.webhook_url || '')}">
        </div>
        <div class="field">
          <label class="label" for="s_webhook_secret">加签安全密钥<span class="opt">钉钉可选</span></label>
          <input class="control" type="text" id="s_webhook_secret" placeholder="SEC..." value="${escapeHtml(s.webhook_secret || '')}">
        </div>
        <button class="btn btn-sm btn-outline" id="btnTestWebhook" type="button">${icon('send', 14)}发送测试卡片到群</button>
      </section>

      <section class="card">
        <div class="card-head">
          <div class="card-title">${icon('lock', 16)}管理员口令</div>
        </div>
        <div class="field">
          <label class="label" for="s_admin_pwd">修改登录口令<span class="opt">留空则不修改</span></label>
          <input class="control" type="password" id="s_admin_pwd" placeholder="输入新的总务管理密码" autocomplete="new-password">
        </div>
        <button class="btn btn-primary btn-block mt-8" id="btnSaveSettings" type="button">${icon('check', 16)}保存所有设置</button>
      </section>
    `;

    document.getElementById('btnTestWebhook').onclick = async () => {
      const webhook_type = document.getElementById('s_webhook_type').value;
      const webhook_url = document.getElementById('s_webhook_url').value.trim();
      const webhook_secret = document.getElementById('s_webhook_secret').value.trim();
      if (!webhook_url) { toast('请先输入 Webhook 推送地址'); return; }
      const btn = document.getElementById('btnTestWebhook');
      await runAction(btn, '推送中…', async () => {
        await request('/api/admin/settings/test-webhook', {
          method: 'POST',
          token: adminToken,
          body: { webhook_type, webhook_url, webhook_secret },
        });
        toast('测试卡片已成功推送到工作群');
      });
    };

    document.getElementById('btnSaveSettings').onclick = async () => {
      const payload = {
        school_name: document.getElementById('s_school_name').value.trim(),
        sla_pending_hours: document.getElementById('s_sla_pending').value.trim(),
        sla_accept_hours: document.getElementById('s_sla_accept').value.trim(),
        sla_finish_hours: document.getElementById('s_sla_finish').value.trim(),
        webhook_type: document.getElementById('s_webhook_type').value,
        webhook_url: document.getElementById('s_webhook_url').value.trim(),
        webhook_secret: document.getElementById('s_webhook_secret').value.trim(),
      };
      const pwd = document.getElementById('s_admin_pwd').value.trim();
      if (pwd) payload.admin_password = pwd;

      const btn = document.getElementById('btnSaveSettings');
      await runAction(btn, '正在保存…', async () => {
        await request('/api/admin/settings', { method: 'POST', token: adminToken, body: payload });
        toast('系统配置已更新');
        loadConfig();
      });
    };
  } catch (err) {
    box.innerHTML = emptyBlock('alert', '配置加载失败', err.message);
  }
}

// ----------------- 4. 场所报修码 -----------------
function renderQrView() {
  const options = appConfig.buildings.map((b) => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join('');
  return `
    <section class="card">
      <div class="card-head">
        <div class="card-title">${icon('qr', 16)}场所二维码生成器</div>
        <span class="card-sub">扫码自动带入楼栋与房间</span>
      </div>
      <p class="hint mb-12">${icon('info', 13)}张贴在教室、寝室或实验室门前；师生扫码后自动带入该楼栋与房间，直接进入报修表单，故障信息仍需本人填写。</p>
      <div class="grid-form">
        <div class="field">
          <label class="label" for="qrBldgSelect">所属楼栋</label>
          <div class="select-wrap"><select class="control" id="qrBldgSelect">${options}</select></div>
        </div>
        <div class="field">
          <label class="label" for="qrRoomInput">房间 / 区域</label>
          <input class="control" type="text" id="qrRoomInput" placeholder="例如：305教室" value="305教室">
        </div>
      </div>
      <button class="btn btn-primary mt-8" id="btnMakeQr" type="button">${icon('qr', 16)}生成报修码</button>
      <div class="text-center mt-16" id="qrCodeResultBox"></div>
    </section>
  `;
}

function bindQrEvents() {
  const btn = document.getElementById('btnMakeQr');
  if (!btn) return;
  btn.onclick = () => {
    const bldg = document.getElementById('qrBldgSelect').value;
    const room = document.getElementById('qrRoomInput').value.trim();
    const url = `${window.location.origin}/?bldg=${encodeURIComponent(bldg)}&room=${encodeURIComponent(room)}`;
    const imgTag = generateQrImage(url, 6);
    document.getElementById('qrCodeResultBox').innerHTML = `
      <div class="qr-card">
        ${imgTag}
        <div class="qr-title">${escapeHtml(bldg)} · ${escapeHtml(room)}</div>
        <div class="qr-desc">扫码打开报修表单</div>
      </div>`;
  };
}

function logout() {
  adminToken = '';
  localStorage.removeItem('bx_admin_token');
  if (poolPoller) { poolPoller.destroy(); poolPoller = null; }
  if (labelTimer) { clearInterval(labelTimer); labelTimer = null; }
  seenTicketIds.clear();
  lastPoolRefresh = 0;
  renderLoginView();
}

// ----------------- 事件委托（替代 onclick="window.xxx()"） -----------------
delegateActions({
  'admin-detail': ({ id }) => openAdminDetail(id),
  assign: ({ id }) => openAssignModal(id),
  reject: ({ id }) => rejectTicket(id),
  print: ({ id }) => printTicket(id),
  'worker-pwd': ({ id }) => editWorkerPwd(id),
  'worker-del': ({ id }) => deleteWorker(id),
  'bldg-del': ({ id }) => deleteBldg(id),
  'cat-del': ({ id }) => deleteCat(id),
  'view-photo': ({ src }) => viewImage(src),
  'modal-close': () => closeModal(),
});

init();
