/**
 * 总务处调度管理中心 - 前端主逻辑
 * 升级：纯矢量 SVG 现代图标 + 渐变波浪骨架屏 + 科技指挥中心质感 + 左右分栏抽屉极速调度
 */
import '../common/style.css';
import { Icons } from '../common/icons.js';
import { request, STATUS_MAP } from '../common/api.js';
import { escapeHtml, formatTime, formatShortTime, toast, openModal, closeModal, viewImage, exportToCsv, initTheme, copyText, renderTicketSkeleton, renderWorkbenchDetailSkeleton, renderKpiSkeleton } from '../common/utils.js';
import { generateQrImage } from '../common/qrcode.js';
import { renderStepperTimeline } from '../reporter/main.js';

let adminToken = localStorage.getItem('bx_admin_token') || '';
let currentTab = 'pool'; // 'pool' | 'dash' | 'manage' | 'qrcode'
let subManageTab = 'workers'; // 'workers' | 'buildings' | 'categories' | 'settings'

let allTickets = [];
let selectedTicketId = ''; // 左右分栏中当前选中的工单 ID
let appConfig = { buildings: [], categories: [], workers: [], sla: {} };
let filterState = {
  status: 'all',
  building: 'all',
  category: 'all',
  search: '',
  timeoutOnly: false,
};

async function init() {
  initTheme();
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

function renderLoginView() {
  document.getElementById('app').innerHTML = `
    <header class="topbar">
      <div class="nav-wrap">
        <div class="brand">
          <span style="color: var(--cyan);">${Icons.building(22)}</span>
          <div class="title">学校总务报修 - 调度管理中心</div>
        </div>
        <div class="topbar-actions">
          <div class="portal-tag">总务管理端</div>
          <button class="theme-toggle-btn" onclick="window.toggleTheme()" title="切换深浅主题"></button>
        </div>
      </div>
    </header>

    <main class="app-container" style="max-width: 440px; margin-top: 40px;">
      <div class="card">
        <div class="card-title">
          <span style="display: flex; align-items: center; gap: 6px;">
            ${Icons.doorLock(18, 'text-cyan')}
            <span>总务处调度员验证</span>
          </span>
        </div>
        <div class="form-group">
          <label>调度管理员口令 / 密码</label>
          <input type="password" id="adminKeyInput" placeholder="默认初始口令 admin888" autocomplete="current-password">
        </div>
        <button class="btn" id="btnAdminLogin" style="margin-top: 10px;">
          ${Icons.bolt(16)}
          <span>登 录 调 度 中 心</span>
        </button>
      </div>
    </main>
  `;

  document.getElementById('btnAdminLogin').onclick = async () => {
    const key = document.getElementById('adminKeyInput').value.trim();
    if (!key) {
      toast('请输入管理口令');
      return;
    }
    try {
      const res = await request('/api/auth/login', {
        method: 'POST',
        body: { role: 'admin', key },
      });
      adminToken = res.token;
      localStorage.setItem('bx_admin_token', res.token);
      toast('验证成功，进入总务调度中心');
      await loadConfig();
      renderAdminView();
    } catch (err) {
      toast(err.message || '口令错误');
    }
  };
}

function renderAdminView() {
  document.getElementById('app').innerHTML = `
    <header class="topbar">
      <div class="nav-wrap">
        <div class="brand">
          <span style="color: var(--cyan);">${Icons.building(22)}</span>
          <div class="title">${escapeHtml(appConfig.schoolName || '总务处')} · 调度指挥中心</div>
        </div>
        <div class="topbar-actions">
          <button class="theme-toggle-btn" onclick="window.toggleTheme()" title="切换深浅主题"></button>
          <div class="portal-tag"><span class="pulse-dot ok"></span> 调度员在线</div>
          <button class="btn btn-sm btn-danger" id="btnLogoutAdmin">退出</button>
        </div>
      </div>
    </header>

    <main class="app-container wide" id="adminMainContainer"></main>

    <nav class="tabbar">
      <button class="tabbar-item active" id="tabPoolBtn">
        <span class="icon">${Icons.layers(20)}</span>
        <span>调度大池</span>
      </button>
      <button class="tabbar-item" id="tabDashBtn">
        <span class="icon">${Icons.barChart(20)}</span>
        <span>后勤大屏</span>
      </button>
      <button class="tabbar-item" id="tabManageBtn">
        <span class="icon">${Icons.settings(20)}</span>
        <span>基础配置</span>
      </button>
      <button class="tabbar-item" id="tabQrcodeBtn">
        <span class="icon">${Icons.qrCode(20)}</span>
        <span>报修码</span>
      </button>
    </nav>
  `;

  document.getElementById('tabPoolBtn').onclick = () => switchTab('pool');
  document.getElementById('tabDashBtn').onclick = () => switchTab('dash');
  document.getElementById('tabManageBtn').onclick = () => switchTab('manage');
  document.getElementById('tabQrcodeBtn').onclick = () => switchTab('qrcode');
  document.getElementById('btnLogoutAdmin').onclick = logout;

  switchTab('pool');
}

function switchTab(tab) {
  currentTab = tab;
  document.getElementById('tabPoolBtn').classList.toggle('active', tab === 'pool');
  document.getElementById('tabDashBtn').classList.toggle('active', tab === 'dash');
  document.getElementById('tabManageBtn').classList.toggle('active', tab === 'manage');
  document.getElementById('tabQrcodeBtn').classList.toggle('active', tab === 'qrcode');

  const container = document.getElementById('adminMainContainer');
  if (tab === 'pool') {
    container.innerHTML = renderPoolView();
    bindPoolEvents();
    loadPoolTickets();
  } else if (tab === 'dash') {
    container.innerHTML = renderKpiSkeleton();
    loadDashboard();
  } else if (tab === 'manage') {
    container.innerHTML = renderManageView();
    bindManageEvents();
  } else if (tab === 'qrcode') {
    container.innerHTML = renderQrView();
    bindQrEvents();
  }
}

// ----------------- 1. 工单调度大池 (左右分栏抽屉式极速调度) -----------------
function renderPoolView() {
  const bldgOptions = `<option value="all">全部楼栋</option>` + appConfig.buildings.map((b) => `<option value="${escapeHtml(b)}" ${filterState.building === b ? 'selected' : ''}>${escapeHtml(b)}</option>`).join('');
  const catOptions = `<option value="all">全部分类</option>` + appConfig.categories.map((c) => `<option value="${escapeHtml(c)}" ${filterState.category === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');

  return `
    <div class="card" style="margin-bottom: 12px;">
      <div class="card-title">
        <span style="display: flex; align-items: center; gap: 6px;">
          ${Icons.layers(18, 'text-cyan')}
          <span>全校工单调度大池</span>
        </span>
        <button class="btn btn-sm btn-ghost" id="btnExportCsv">
          ${Icons.download(14)}
          <span>导出 Excel/CSV 报表</span>
        </button>
      </div>

      <div class="grid-form" style="margin-bottom: 10px;">
        <input type="text" id="poolSearchInput" placeholder="输入单号/房间/描述/报修人/师傅姓名..." value="${escapeHtml(filterState.search)}">
        <div style="display: flex; gap: 8px;">
          <select id="poolBldgSelect">${bldgOptions}</select>
          <select id="poolCatSelect">${catOptions}</select>
          <button class="btn btn-sm" id="btnFilterSearch" style="flex: none; width: 85px;">快速筛选</button>
        </div>
      </div>

      <div class="chips-group" id="poolStatusChips">
        <span class="chip ${filterState.status === 'all' && !filterState.timeoutOnly ? 'active' : ''}" data-st="all">全部工单</span>
        <span class="chip ${filterState.status === 'pending' ? 'active' : ''}" data-st="pending">待受理</span>
        <span class="chip ${filterState.status === 'assigned' ? 'active' : ''}" data-st="assigned">已派工</span>
        <span class="chip ${filterState.status === 'working' ? 'active' : ''}" data-st="working">维修中</span>
        <span class="chip ${filterState.status === 'done' ? 'active' : ''}" data-st="done">待验收</span>
        <span class="chip ${filterState.status === 'closed' ? 'active' : ''}" data-st="closed">已结单</span>
        <span class="chip danger ${filterState.timeoutOnly ? 'active' : ''}" data-st="timeout">
          ${Icons.alertTriangle(13)} 超时预警工单
        </span>
      </div>
    </div>

    <!-- 左右分栏极速调度工作台 -->
    <div class="admin-split-layout">
      <!-- 左栏: 瀑布流工单列表 -->
      <div class="split-list-pane" id="poolListContainer">
        ${renderTicketSkeleton(4)}
      </div>

      <!-- 右栏: 抽屉式极速调度与详情工作台 (Sticky) -->
      <div class="split-detail-pane" id="poolDetailWorkbench">
        ${renderWorkbenchDetailSkeleton()}
      </div>
    </div>
  `;
}

function bindPoolEvents() {
  document.getElementById('poolStatusChips').onclick = (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const st = chip.dataset.st;
    if (st === 'timeout') {
      filterState.timeoutOnly = true;
      filterState.status = 'all';
    } else {
      filterState.timeoutOnly = false;
      filterState.status = st;
    }
    document.querySelectorAll('#poolStatusChips .chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    loadPoolTickets();
  };

  document.getElementById('btnFilterSearch').onclick = () => {
    filterState.search = document.getElementById('poolSearchInput').value.trim();
    filterState.building = document.getElementById('poolBldgSelect').value;
    filterState.category = document.getElementById('poolCatSelect').value;
    loadPoolTickets();
  };

  document.getElementById('btnExportCsv').onclick = handleExportCsv;
}

async function loadPoolTickets() {
  const container = document.getElementById('poolListContainer');
  if (!container) return;

  // 呈现左侧工单瀑布流骨架屏
  container.innerHTML = renderTicketSkeleton(4);

  let q = `/api/tickets?`;
  if (filterState.status !== 'all') q += `&status=${encodeURIComponent(filterState.status)}`;
  if (filterState.building !== 'all') q += `&building=${encodeURIComponent(filterState.building)}`;
  if (filterState.category !== 'all') q += `&category=${encodeURIComponent(filterState.category)}`;
  if (filterState.search) q += `&search=${encodeURIComponent(filterState.search)}`;

  try {
    let list = await request(q, { token: adminToken });
    if (filterState.timeoutOnly) {
      list = list.filter((t) => t.isTimeout);
    }
    allTickets = list;

    if (list.length === 0) {
      container.innerHTML = `<div class="card text-muted" style="text-align: center; padding: 40px;">未找到匹配的工单记录</div>`;
      document.getElementById('poolDetailWorkbench').innerHTML = `
        <div class="card text-muted" style="text-align: center; padding: 50px 20px;">当前筛选条件下无可用工单</div>
      `;
      return;
    }

    if (!selectedTicketId || !list.find((t) => t.id === selectedTicketId)) {
      selectedTicketId = list[0].id;
    }

    container.innerHTML = list.map((t) => renderAdminTicketCard(t, t.id === selectedTicketId)).join('');

    renderWorkbenchDetail(selectedTicketId);
  } catch (err) {
    if (err.message && err.message.includes('未授权')) {
      logout();
      return;
    }
    container.innerHTML = `<div class="card text-muted" style="text-align: center; color: var(--danger);">加载失败: ${escapeHtml(err.message)}</div>`;
  }
}

function renderAdminTicketCard(t, isSelected) {
  const st = STATUS_MAP[t.status] || { label: t.status, cls: 'b-pending' };
  const timeoutBadge = t.isTimeout ? `<span class="badge b-timeout">${Icons.alertTriangle(12)} ${escapeHtml(t.timeoutReason)}</span>` : '';
  const remindBadge = t.remindCount > 0 ? `<span class="badge b-remind">${Icons.bell(12)} 催单(${t.remindCount})</span>` : '';

  return `
    <div class="ticket-card ticket-card-interactive ${t.isTimeout ? 'is-timeout' : ''} ${isSelected ? 'active' : ''}" 
         id="card_${escapeHtml(t.id)}" 
         onclick="window.selectTicket('${escapeHtml(t.id)}')">
      <div class="ticket-head">
        <span class="ticket-no">#${escapeHtml(t.id)}</span>
        <div style="display: flex; gap: 4px; align-items: center;">
          ${remindBadge}
          ${timeoutBadge}
          <span class="badge ${st.cls}">${st.label}</span>
        </div>
      </div>
      <div class="ticket-title">${escapeHtml(t.building)} ${escapeHtml(t.room)}</div>
      <div class="ticket-meta">
        <span>类别：${escapeHtml(t.category)}</span> | 
        <span>紧急度：<strong style="${t.urgency === '紧急' ? 'color: var(--danger);' : ''}">${escapeHtml(t.urgency)}</strong></span><br>
        <span>报修人：${escapeHtml(t.reporter)} · ${Icons.phone(12)} ${escapeHtml(t.phone)}</span>
        ${t.assignee ? `<br><strong style="color: var(--brand);">负责师傅：${escapeHtml(t.assignee)}</strong>` : ''}
      </div>
      <div class="ticket-desc" style="max-height: 48px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
        ${escapeHtml(t.desc)}
      </div>
      <div style="margin-top: 10px; padding-top: 8px; border-top: 1px dashed var(--border); display: flex; justify-content: space-between; align-items: center;">
        <span style="font-size: 11.5px; color: var(--text-muted);">${formatShortTime(t.createdAt)}</span>
        <button class="btn btn-sm btn-ghost" style="padding: 3px 10px; font-size: 12px; font-weight: 700; color: var(--cyan); border: 1px solid var(--border);" onclick="event.stopPropagation(); window.selectTicket('${escapeHtml(t.id)}')">
          派工 / 详情 →
        </button>
      </div>
    </div>
  `;
}

window.selectTicket = (id, openMobileDrawer = true) => {
  selectedTicketId = id;
  document.querySelectorAll('#poolListContainer .ticket-card-interactive').forEach((el) => el.classList.remove('active'));
  const targetCard = document.getElementById(`card_${id}`);
  if (targetCard) targetCard.classList.add('active');

  if (openMobileDrawer) {
    document.querySelector('.admin-split-layout')?.classList.add('mobile-detail-active');
  }

  renderWorkbenchDetail(id);
};

window.closeMobileDetail = () => {
  document.querySelector('.admin-split-layout')?.classList.remove('mobile-detail-active');
};

// 渲染右侧抽屉式极速调度与详情工作台
async function renderWorkbenchDetail(id) {
  const wb = document.getElementById('poolDetailWorkbench');
  if (!wb) return;

  const t = allTickets.find((item) => item.id === id);
  if (!t) {
    wb.innerHTML = `<div class="card text-muted" style="text-align: center; padding: 40px;">工单未找到</div>`;
    return;
  }

  const st = STATUS_MAP[t.status] || { label: t.status, cls: 'b-pending' };
  const workerOptions = appConfig.workers.map((w) => `<option value="${escapeHtml(w.name)}">${escapeHtml(w.name)} (${escapeHtml(w.skill)} · ${escapeHtml(w.phone)})</option>`).join('');

  const photosHtml = t.photos && t.photos.length > 0
    ? `<div style="margin-top: 8px;"><strong>报修照片：</strong><div class="photos-grid">${t.photos.map((p) => `<div class="photo-item"><img src="${escapeHtml(p)}" onclick="window.viewImage('${escapeHtml(p)}')"></div>`).join('')}</div></div>`
    : '';

  const finishPhotosHtml = t.finishPhotos && t.finishPhotos.length > 0
    ? `<div style="margin-top: 8px;"><strong>完工照片：</strong><div class="photos-grid">${t.finishPhotos.map((p) => `<div class="photo-item"><img src="${escapeHtml(p)}" onclick="window.viewImage('${escapeHtml(p)}')"></div>`).join('')}</div></div>`
    : '';

  let dispatchBoxHtml = '';
  if (t.status === 'pending' || t.status === 'assigned') {
    dispatchBoxHtml = `
      <div style="background: var(--card-alt); border: 1px solid var(--border); border-radius: 9px; padding: 14px; margin-top: 14px;">
        <div style="font-weight: 700; color: var(--cyan); margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
          ${Icons.bolt(16)}
          <span>极速派工工作台</span>
          <span style="font-size: 11.5px; font-weight: normal; color: var(--text-muted);">(实时生效并向师傅推送)</span>
        </div>
        <div class="form-group" style="margin-bottom: 8px;">
          <label style="font-size: 12.5px;">指派负责师傅</label>
          <select id="inlineAssignWorker">${workerOptions}</select>
        </div>
        <div class="form-group" style="margin-bottom: 10px;">
          <label style="font-size: 12.5px;">派工指导说明</label>
          <input type="text" id="inlineAssignNote" placeholder="例如：带上登高折叠梯，上门前电话确认...">
        </div>
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-ok" id="btnInlineDispatch" style="flex: 2;">
            ${Icons.bolt(16)} 确认指派负责师傅
          </button>
          <button class="btn btn-danger" id="btnInlineReject" style="flex: 1;">驳回</button>
        </div>
      </div>
    `;
  }

  const stepperHtml = renderStepperTimeline(t);

  const commentsHtml = `
    <div style="background: var(--card-alt); border-radius: 9px; padding: 12px; margin-top: 14px; border: 1px solid var(--border);">
      <div style="font-weight: 700; font-size: 13.5px; margin-bottom: 8px; color: var(--text); display: flex; align-items: center; gap: 6px;">
        ${Icons.messageSquare(16, 'text-cyan')}
        <span>现场三方沟通与留言板 (${(t.comments || []).length})</span>
      </div>
      <div style="display: flex; flex-direction: column; gap: 8px; max-height: 160px; overflow-y: auto;">
        ${(t.comments || []).length === 0 ? `<div class="text-muted" style="font-size: 12px;">暂无留言</div>` : (t.comments || []).map((c) => `
          <div style="border-bottom: 1px dashed var(--border); padding-bottom: 4px;">
            <div style="display: flex; justify-content: space-between; font-size: 11px; color: var(--text-muted);">
              <span><strong>${escapeHtml(c.senderName)}</strong> (${escapeHtml(c.senderRole === 'admin' ? '总务处' : c.senderRole === 'worker' ? '维修师傅' : '报修人')})</span>
              <span>${formatShortTime(c.createdAt)}</span>
            </div>
            <div style="font-size: 13px; color: var(--text); margin-top: 2px;">${escapeHtml(c.content)}</div>
          </div>
        `).join('')}
      </div>
      <div style="display: flex; gap: 6px; margin-top: 10px;">
        <input type="text" id="wbCommentInput" placeholder="输入总务处调度指示...">
        <button class="btn btn-sm" id="btnWbSendComment" style="flex: none; width: 70px;">发送</button>
      </div>
    </div>
  `;

  wb.innerHTML = `
    <div class="mobile-drawer-header">
      <button class="btn btn-sm btn-ghost" onclick="window.closeMobileDetail()" style="display: flex; align-items: center; gap: 6px; font-weight: 700; color: var(--text);">
        ${Icons.arrowLeft(16)}
        <span>返回工单列表</span>
      </button>
      <div style="font-size: 13px; font-weight: 700; color: var(--cyan);">#${escapeHtml(t.id)} 派工工作台</div>
      <button class="btn btn-sm btn-ghost" onclick="window.closeMobileDetail()" style="padding: 4px 8px;" title="关闭">
        ${Icons.x(16)}
      </button>
    </div>

    <div class="card">
      <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 10px; margin-bottom: 12px;">
        <div>
          <span class="badge ${st.cls}">${st.label}</span>
          <span style="font-weight: 700; font-family: ui-monospace, monospace; margin-left: 6px;">#${escapeHtml(t.id)}</span>
        </div>
        <div style="display: flex; gap: 6px;">
          <button class="btn btn-sm btn-ghost" onclick="window.printTicket('${escapeHtml(t.id)}')">
            ${Icons.printer(14)}
            <span>打印派工单</span>
          </button>
        </div>
      </div>

      <div style="font-size: 18px; font-weight: 800; color: var(--text); margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
        <span>${Icons.pin(18, 'text-cyan')}</span>
        <span>${escapeHtml(t.building)} · ${escapeHtml(t.room)}</span>
      </div>

      <div style="background: var(--card-alt); border: 1px solid var(--border); border-radius: 9px; padding: 12px; font-size: 13.5px; line-height: 1.8;">
        <div><strong>报修类别：</strong>${escapeHtml(t.category)} | <strong>紧急程度：</strong><span style="${t.urgency === '紧急' ? 'color: var(--danger); font-weight: 700;' : ''}">${escapeHtml(t.urgency)}</span></div>
        <div>
          <strong>报修人员：</strong>${escapeHtml(t.reporter)} (${escapeHtml(t.identity)}) · ${Icons.phone(12)} ${escapeHtml(t.phone)} 
          <button class="btn btn-sm btn-ghost" style="padding: 2px 8px; font-size: 11px; margin-left: 6px;" onclick="window.copyText('${escapeHtml(t.phone)}', '已复制报修人手机号')">
            ${Icons.copy(11)} 复制
          </button>
        </div>
        <div><strong>指派师傅：</strong><strong style="color: var(--brand);">${escapeHtml(t.assignee || '未指派')}</strong></div>
        <div><strong>提交时间：</strong>${formatTime(t.createdAt)}</div>
        <div style="margin-top: 6px; border-top: 1px dashed var(--border); padding-top: 6px;">
          <strong>故障现象：</strong>${escapeHtml(t.desc)}
        </div>
        ${photosHtml}
      </div>

      ${t.result ? `
        <div style="background: var(--ok-light); border: 1px solid var(--ok); border-radius: 9px; padding: 12px; margin-top: 12px; font-size: 13.5px;">
          <div style="font-weight: 700; color: var(--ok); display: flex; align-items: center; gap: 6px;">
            ${Icons.check(16)} 维修完工报告：
          </div>
          <div style="margin-top: 4px;">${escapeHtml(t.result)}</div>
          ${finishPhotosHtml}
        </div>
      ` : ''}

      ${t.rating ? `
        <div style="background: var(--warn-light); border: 1px solid var(--warn); border-radius: 9px; padding: 12px; margin-top: 12px; font-size: 13.5px;">
          <div style="font-weight: 700; color: var(--warn); display: flex; align-items: center; gap: 4px;">
            ${Icons.star(16, '', '#f59e0b')} 师生验收好评：
          </div>
          <div style="margin: 3px 0;">${Icons.star(16, '', '#f59e0b').repeat(t.rating.score || 5)} (${t.rating.score}星)</div>
          <div style="color: var(--text-muted);">${escapeHtml(t.rating.comment || '满意')}</div>
        </div>
      ` : ''}

      ${dispatchBoxHtml}
      ${stepperHtml}
      ${commentsHtml}
    </div>
  `;

  const btnDispatch = document.getElementById('btnInlineDispatch');
  if (btnDispatch) {
    btnDispatch.onclick = async () => {
      const worker = document.getElementById('inlineAssignWorker').value;
      const note = document.getElementById('inlineAssignNote').value.trim();
      try {
        await request(`/api/tickets/${t.id}/assign`, {
          method: 'POST',
          token: adminToken,
          body: { worker, note },
        });
        toast(`已成功派发给 ${worker}！`);
        window.closeMobileDetail();
        loadPoolTickets();
      } catch (err) {
        toast(err.message);
      }
    };
  }

  const btnReject = document.getElementById('btnInlineReject');
  if (btnReject) {
    btnReject.onclick = async () => {
      const note = prompt('请输入驳回原因（将实时反馈给报修人）：', '不在总务维修范围或属于重复提交');
      if (note === null) return;
      try {
        await request(`/api/tickets/${t.id}/reject`, {
          method: 'POST',
          token: adminToken,
          body: { note },
        });
        toast('已驳回该工单');
        window.closeMobileDetail();
        loadPoolTickets();
      } catch (err) {
        toast(err.message);
      }
    };
  }

  const btnSendComment = document.getElementById('btnWbSendComment');
  if (btnSendComment) {
    btnSendComment.onclick = async () => {
      const content = document.getElementById('wbCommentInput').value.trim();
      if (!content) return;
      try {
        await request(`/api/tickets/${t.id}/comments`, {
          method: 'POST',
          token: adminToken,
          body: {
            senderRole: 'admin',
            senderName: '总务处调度员',
            content,
          },
        });
        renderWorkbenchDetail(t.id);
      } catch (e) {
        toast(e.message);
      }
    };
  }
}

// 打印标准 A4 派工单
window.printTicket = async (id) => {
  const t = await request(`/api/tickets/${id}`, { token: adminToken });
  const st = STATUS_MAP[t.status] || { label: t.status };

  const printDiv = document.createElement('div');
  printDiv.className = 'print-sheet';
  printDiv.innerHTML = `
    <div style="text-align: center; border-bottom: 2px solid #000; padding-bottom: 8px; margin-bottom: 14px;">
      <h2 style="margin: 0; font-size: 22px;">${escapeHtml(appConfig.schoolName || '学校总务处')} · 设备报修派工单</h2>
      <div style="font-size: 12px; margin-top: 4px;">工单编号：${escapeHtml(t.id)} | 打印时间：${formatTime(Date.now())}</div>
    </div>
    <table style="width: 100%; border-collapse: collapse; font-size: 13.5px;" border="1" cellpadding="8">
      <tr>
        <td style="width: 15%; background: #f2f2f2; font-weight: bold;">报修地点</td><td style="width: 35%;">${escapeHtml(t.building)} ${escapeHtml(t.room)}</td>
        <td style="width: 15%; background: #f2f2f2; font-weight: bold;">故障类别</td><td style="width: 35%;">${escapeHtml(t.category)} (${escapeHtml(t.urgency)})</td>
      </tr>
      <tr>
        <td style="background: #f2f2f2; font-weight: bold;">报修人员</td><td>${escapeHtml(t.reporter)} (${escapeHtml(t.identity)})</td>
        <td style="background: #f2f2f2; font-weight: bold;">联系电话</td><td>${escapeHtml(t.phone)}</td>
      </tr>
      <tr>
        <td style="background: #f2f2f2; font-weight: bold;">报修时间</td><td>${formatTime(t.createdAt)}</td>
        <td style="background: #f2f2f2; font-weight: bold;">当前状态</td><td>${st.label}</td>
      </tr>
      <tr>
        <td style="background: #f2f2f2; font-weight: bold;">指派师傅</td><td>${escapeHtml(t.assignee || '未指派')}</td>
        <td style="background: #f2f2f2; font-weight: bold;">完工时间</td><td>${formatTime(t.completedAt)}</td>
      </tr>
      <tr>
        <td style="background: #f2f2f2; font-weight: bold;">故障描述</td>
        <td colspan="3">${escapeHtml(t.desc)}</td>
      </tr>
      <tr style="height: 90px;">
        <td style="background: #f2f2f2; font-weight: bold;">现场维修记录及使用耗材</td>
        <td colspan="3">${escapeHtml(t.result || '')}</td>
      </tr>
      <tr>
        <td style="background: #f2f2f2; font-weight: bold;">维修师傅签字</td><td style="height: 45px;"></td>
        <td style="background: #f2f2f2; font-weight: bold;">报修人验收签字</td><td></td>
      </tr>
    </table>
    <div style="margin-top: 14px; display: flex; justify-content: space-between; font-size: 12px;">
      <span>总务处审核盖章：___________</span>
      <span>验收日期：20___年___月___日</span>
    </div>
  `;

  document.body.appendChild(printDiv);
  window.print();
  document.body.removeChild(printDiv);
};

// 导出 CSV 报表
function handleExportCsv() {
  if (!allTickets || allTickets.length === 0) {
    toast('当前列表暂无工单可导出');
    return;
  }
  const headers = ['工单号', '报修楼栋', '房号', '故障分类', '紧急度', '报修人', '身份', '联系电话', '提交时间', '状态', '指派师傅', '完工结果', 'SLA状态', '验收评分', '师生评价'];
  const rows = allTickets.map((t) => [
    t.id,
    t.building,
    t.room,
    t.category,
    t.urgency,
    t.reporter,
    t.identity,
    t.phone,
    formatTime(t.createdAt),
    STATUS_MAP[t.status]?.label || t.status,
    t.assignee || '未指派',
    (t.result || '').replace(/[\r\n]+/g, ' '),
    t.isTimeout ? t.timeoutReason : '正常',
    t.rating?.score || '',
    (t.rating?.comment || '').replace(/[\r\n]+/g, ' '),
  ]);
  exportToCsv(`总务报修导出_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
}

// ----------------- 2. 数据统计大屏 (带骨架屏动画) -----------------
async function loadDashboard() {
  const container = document.getElementById('adminMainContainer');
  // 呈现大屏骨架屏
  container.innerHTML = renderKpiSkeleton();

  try {
    const st = await request('/api/stats/dashboard', { token: adminToken });
    container.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi-card"><div class="val" style="color: var(--cyan);">${st.total}</div><div class="lbl">累计报修总数</div></div>
        <div class="kpi-card"><div class="val" style="color: var(--warn);">${st.pending + st.assigned + st.working}</div><div class="lbl">在办流转中</div></div>
        <div class="kpi-card success"><div class="val" style="color: var(--ok);">${st.finishRate}%</div><div class="lbl">综合办结率</div></div>
        <div class="kpi-card"><div class="val" style="color: #eab308; display: flex; align-items: center; justify-content: center; gap: 4px;">${Icons.star(20, '', '#eab308')} ${st.avgScore}</div><div class="lbl">满意度评分</div></div>
        <div class="kpi-card danger" id="cardKpiTimeout" style="cursor: pointer;"><div class="val" style="color: var(--danger);"><span class="pulse-dot danger"></span> ${st.timeouts}</div><div class="lbl">超时工单 (点击督办)</div></div>
      </div>

      <div class="card">
        <div class="card-title">
          <span style="display: flex; align-items: center; gap: 6px;">
            ${Icons.barChart(18, 'text-cyan')}
            <span>故障分类报修热力分布</span>
          </span>
        </div>
        <div style="display: flex; flex-direction: column; gap: 10px;">${renderBarList(st.catMap, st.total)}</div>
      </div>

      <div class="card">
        <div class="card-title">
          <span style="display: flex; align-items: center; gap: 6px;">
            ${Icons.building(18, 'text-cyan')}
            <span>校区楼栋报修频次热力排行</span>
          </span>
        </div>
        <div style="display: flex; flex-direction: column; gap: 10px;">${renderBarList(st.bldgMap, st.total)}</div>
      </div>
    `;

    document.getElementById('cardKpiTimeout').onclick = () => {
      filterState.timeoutOnly = true;
      filterState.status = 'all';
      switchTab('pool');
    };
  } catch (err) {
    container.innerHTML = `<div class="card text-muted" style="color: var(--danger);">加载统计失败: ${escapeHtml(err.message)}</div>`;
  }
}

function renderBarList(map, total) {
  if (!map) return '<div class="text-muted">暂无数据</div>';
  const keys = Object.keys(map).sort((a, b) => map[b] - map[a]);
  if (keys.length === 0) return '<div class="text-muted">暂无数据</div>';
  const max = map[keys[0]] || 1;
  return keys.map((k) => {
    const v = map[k];
    const pct = Math.round((v / max) * 100);
    return `
      <div style="display: flex; align-items: center; gap: 12px; font-size: 13.5px;">
        <div style="width: 95px; flex: none; text-align: right; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600;">${escapeHtml(k)}</div>
        <div style="flex: 1; height: 16px; background: var(--card-alt); border: 1px solid var(--border); border-radius: 8px; overflow: hidden;">
          <div style="width: ${pct}%; height: 100%; background: linear-gradient(90deg, var(--brand), var(--cyan)); border-radius: 8px;"></div>
        </div>
        <div style="width: 40px; flex: none; text-align: right; font-weight: 800; font-family: ui-monospace, monospace;">${v}</div>
      </div>
    `;
  }).join('');
}

// ----------------- 3. 基础配置中心 -----------------
function renderManageView() {
  return `
    <div class="card">
      <div class="card-title">
        <span style="display: flex; align-items: center; gap: 6px;">
          ${Icons.settings(18, 'text-cyan')}
          <span>后勤基础数据与系统设置</span>
        </span>
      </div>
      <div class="chips-group" id="manageSubTabChips">
        <span class="chip ${subManageTab === 'workers' ? 'active' : ''}" data-sub="workers">
          ${Icons.hardHat(14)} 维修师傅管理
        </span>
        <span class="chip ${subManageTab === 'buildings' ? 'active' : ''}" data-sub="buildings">
          ${Icons.building(14)} 校区楼栋管理
        </span>
        <span class="chip ${subManageTab === 'categories' ? 'active' : ''}" data-sub="categories">
          ${Icons.layers(14)} 故障分类管理
        </span>
        <span class="chip ${subManageTab === 'settings' ? 'active' : ''}" data-sub="settings">
          ${Icons.bell(14)} 预警与机器人通知
        </span>
      </div>
    </div>
    <div id="manageSubContainer"></div>
  `;
}

function bindManageEvents() {
  document.getElementById('manageSubTabChips').onclick = (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    subManageTab = chip.dataset.sub;
    document.querySelectorAll('#manageSubTabChips .chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    loadSubManage();
  };
  loadSubManage();
}

async function loadSubManage() {
  const container = document.getElementById('manageSubContainer');
  if (subManageTab === 'workers') {
    container.innerHTML = `
      <div class="card">
        <div class="card-title">
          <span>维修师傅账号与专长</span>
          <button class="btn btn-sm btn-ok" id="btnAddWorkerBtn">+ 添加师傅账号</button>
        </div>
        <div id="workerListWrapper"><div class="text-muted">正在加载师傅列表...</div></div>
      </div>
    `;
    document.getElementById('btnAddWorkerBtn').onclick = openAddWorkerModal;
    loadWorkersTable();
  } else if (subManageTab === 'buildings') {
    container.innerHTML = `
      <div class="card">
        <div class="card-title">
          <span>校区楼栋区域维护</span>
          <button class="btn btn-sm btn-ok" id="btnAddBldgBtn">+ 添加楼栋</button>
        </div>
        <div id="bldgListWrapper"><div class="text-muted">正在加载楼栋列表...</div></div>
      </div>
    `;
    document.getElementById('btnAddBldgBtn').onclick = openAddBldgModal;
    loadBldgsTable();
  } else if (subManageTab === 'categories') {
    container.innerHTML = `
      <div class="card">
        <div class="card-title">
          <span>报修分类项目维护</span>
          <button class="btn btn-sm btn-ok" id="btnAddCatBtn">+ 添加分类</button>
        </div>
        <div id="catListWrapper"><div class="text-muted">正在加载分类列表...</div></div>
      </div>
    `;
    document.getElementById('btnAddCatBtn').onclick = openAddCatModal;
    loadCatsTable();
  } else if (subManageTab === 'settings') {
    container.innerHTML = `<div class="card text-muted">正在读取系统设置...</div>`;
    loadSettingsForm();
  }
}

async function loadWorkersTable() {
  const box = document.getElementById('workerListWrapper');
  try {
    const list = await request('/api/admin/workers', { token: adminToken });
    box.innerHTML = `
      <table style="width: 100%; border-collapse: collapse; font-size: 13.5px;" border="1" cellpadding="8" bordercolor="var(--border)">
        <thead style="background: var(--card-alt);">
          <tr><th>姓名</th><th>工号/手机</th><th>维修专长</th><th>状态</th><th>操作</th></tr>
        </thead>
        <tbody>
          ${list.map((w) => `
            <tr>
              <td><strong>${escapeHtml(w.name)}</strong></td>
              <td>${escapeHtml(w.phone)}</td>
              <td>${escapeHtml(w.skill || '--')}</td>
              <td>${w.active ? '<span class="badge b-done">启用</span>' : '<span class="badge b-rejected">停用</span>'}</td>
              <td>
                <button class="btn btn-sm btn-ghost" onclick="window.editWorkerPwd('${escapeHtml(w.id)}')">重置密码</button>
                <button class="btn btn-sm btn-danger" onclick="window.deleteWorker('${escapeHtml(w.id)}')">删除</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    box.innerHTML = `<div class="text-muted" style="color: var(--danger);">加载失败: ${escapeHtml(err.message)}</div>`;
  }
}

window.editWorkerPwd = async (id) => {
  const newPwd = prompt('请输入要为该师傅重置的密码：');
  if (!newPwd) return;
  try {
    await request(`/api/admin/workers/${id}`, {
      method: 'PUT',
      token: adminToken,
      body: { password: newPwd },
    });
    toast('密码已重置！');
    loadWorkersTable();
  } catch (err) {
    toast(err.message);
  }
};

window.deleteWorker = async (id) => {
  if (!confirm('确定删除该师傅账号？')) return;
  try {
    await request(`/api/admin/workers/${id}`, {
      method: 'DELETE',
      token: adminToken,
    });
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
      <h3>添加维修师傅账号</h3>
      <button class="modal-close-btn" onclick="window.closeModal()">×</button>
    </div>
    <div class="form-group"><label><span class="req">*</span>师傅姓名</label><input type="text" id="add_w_name" placeholder="例如：刘师傅"></div>
    <div class="form-group"><label><span class="req">*</span>手机号 (兼登录账号)</label><input type="tel" id="add_w_phone" maxlength="11" placeholder="11位手机号"></div>
    <div class="form-group"><label>擅长项目</label><input type="text" id="add_w_skill" placeholder="例如：水电暖通、多媒体设施"></div>
    <div class="form-group"><label>初始密码</label><input type="text" id="add_w_pwd" value="worker888"></div>
    <button class="btn btn-ok" id="btnConfirmAddWorker">${Icons.bolt(16)} 确认创建师傅账号</button>
  `);

  document.getElementById('btnConfirmAddWorker').onclick = async () => {
    const name = document.getElementById('add_w_name').value.trim();
    const phone = document.getElementById('add_w_phone').value.trim();
    const skill = document.getElementById('add_w_skill').value.trim();
    const password = document.getElementById('add_w_pwd').value.trim();
    if (!name || !phone) { toast('请填写姓名和手机号'); return; }
    try {
      await request('/api/admin/workers', {
        method: 'POST',
        token: adminToken,
        body: { name, phone, skill, password },
      });
      toast('师傅账号创建成功！');
      closeModal();
      loadWorkersTable();
      loadConfig();
    } catch (err) {
      toast(err.message);
    }
  };
}

async function loadBldgsTable() {
  const box = document.getElementById('bldgListWrapper');
  const list = await request('/api/admin/buildings', { token: adminToken });
  box.innerHTML = `
    <table style="width: 100%; border-collapse: collapse; font-size: 13.5px;" border="1" cellpadding="8" bordercolor="var(--border)">
      <thead style="background: var(--card-alt);"><tr><th>楼栋名称</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>
        ${list.map((b) => `
          <tr>
            <td><strong>${escapeHtml(b.name)}</strong></td>
            <td><span class="badge b-done">启用</span></td>
            <td><button class="btn btn-sm btn-danger" onclick="window.deleteBldg(${b.id})">删除</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

window.deleteBldg = async (id) => {
  if (!confirm('确定删除该楼栋？')) return;
  await request(`/api/admin/buildings/${id}`, { method: 'DELETE', token: adminToken });
  toast('已删除');
  loadBldgsTable();
  loadConfig();
};

function openAddBldgModal() {
  const name = prompt('请输入新楼栋名称（例如：实验实训楼B座）：');
  if (!name) return;
  request('/api/admin/buildings', { method: 'POST', token: adminToken, body: { name: name.trim() } }).then(() => {
    toast('楼栋添加成功');
    loadBldgsTable();
    loadConfig();
  }).catch((err) => toast(err.message));
}

async function loadCatsTable() {
  const box = document.getElementById('catListWrapper');
  const list = await request('/api/admin/categories', { token: adminToken });
  box.innerHTML = `
    <table style="width: 100%; border-collapse: collapse; font-size: 13.5px;" border="1" cellpadding="8" bordercolor="var(--border)">
      <thead style="background: var(--card-alt);"><tr><th>分类名称</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>
        ${list.map((c) => `
          <tr>
            <td><strong>${escapeHtml(c.name)}</strong></td>
            <td><span class="badge b-done">启用</span></td>
            <td><button class="btn btn-sm btn-danger" onclick="window.deleteCat(${c.id})">删除</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

window.deleteCat = async (id) => {
  if (!confirm('确定删除该分类？')) return;
  await request(`/api/admin/categories/${id}`, { method: 'DELETE', token: adminToken });
  toast('已删除');
  loadCatsTable();
  loadConfig();
};

function openAddCatModal() {
  const name = prompt('请输入新故障分类名称（例如：电梯设施）：');
  if (!name) return;
  request('/api/admin/categories', { method: 'POST', token: adminToken, body: { name: name.trim() } }).then(() => {
    toast('分类添加成功');
    loadCatsTable();
    loadConfig();
  }).catch((err) => toast(err.message));
}

async function loadSettingsForm() {
  const box = document.getElementById('manageSubContainer');
  const s = await request('/api/admin/settings', { token: adminToken });
  box.innerHTML = `
    <div class="card">
      <div class="card-title">
        <span style="display: flex; align-items: center; gap: 6px;">
          ${Icons.bell(18, 'text-cyan')}
          <span>SLA 时限预警与 Webhook 群机器人通知设置</span>
        </span>
      </div>
      <div class="grid-form">
        <div class="form-group">
          <label>系统名称</label>
          <input type="text" id="setSchoolName" value="${escapeHtml(s.school_name || '学校总务报修服务中心')}">
        </div>
        <div class="form-group">
          <label>修改总务管理员登录口令</label>
          <input type="password" id="setAdminPwd" placeholder="若无需修改请留空">
        </div>
      </div>

      <div style="font-weight: 700; color: var(--cyan); margin: 12px 0 8px; display: flex; align-items: center; gap: 6px;">
        ${Icons.clock(16, 'text-cyan')}
        <span>SLA 服务水平超时考核阈值 (小时)</span>
      </div>
      <div class="grid-form">
        <div class="form-group">
          <label>待受理超时 (h)</label>
          <input type="number" id="setSlaPending" value="${escapeHtml(s.sla_pending_hours || '4')}">
        </div>
        <div class="form-group">
          <label>师傅待接单超时 (h)</label>
          <input type="number" id="setSlaAccept" value="${escapeHtml(s.sla_accept_hours || '8')}">
        </div>
        <div class="form-group">
          <label>接单施工超时 (h)</label>
          <input type="number" id="setSlaFinish" value="${escapeHtml(s.sla_finish_hours || '24')}">
        </div>
      </div>

      <div style="font-weight: 700; color: var(--cyan); margin: 14px 0 8px; display: flex; align-items: center; gap: 6px;">
        ${Icons.bot(16, 'text-cyan')}
        <span>企业微信 / 钉钉 / 飞书 机器人推送</span>
      </div>
      <div class="form-group">
        <label>机器人类型</label>
        <select id="setWebhookType">
          <option value="none" ${s.webhook_type === 'none' ? 'selected' : ''}>关闭推送通知</option>
          <option value="wecom" ${s.webhook_type === 'wecom' ? 'selected' : ''}>企业微信群机器人 (WeCom)</option>
          <option value="dingtalk" ${s.webhook_type === 'dingtalk' ? 'selected' : ''}>钉钉自定义群机器人 (DingTalk)</option>
          <option value="feishu" ${s.webhook_type === 'feishu' ? 'selected' : ''}>飞书自定义群机器人 (Lark)</option>
        </select>
      </div>
      <div class="form-group">
        <label>机器人 Webhook 地址</label>
        <input type="text" id="setWebhookUrl" placeholder="https://qyapi.weixin.qq.com/... 或 https://oapi.dingtalk.com/..." value="${escapeHtml(s.webhook_url || '')}">
      </div>
      <div style="display: flex; gap: 8px; margin-top: 14px;">
        <button class="btn btn-ok" id="btnSaveSettings" style="flex: 2;">
          ${Icons.check(16)} 保存系统配置
        </button>
        <button class="btn btn-ghost" id="btnTestWebhook" style="flex: 1;">
          ${Icons.bolt(16)} 测试推送
        </button>
      </div>
    </div>
  `;

  document.getElementById('btnTestWebhook').onclick = async () => {
    try {
      await request('/api/admin/settings/test-webhook', {
        method: 'POST',
        token: adminToken,
      });
      toast('测试消息已发出，请在工作群查看！');
    } catch (err) {
      toast(`测试失败: ${err.message}`);
    }
  };

  document.getElementById('btnSaveSettings').onclick = async () => {
    const schoolName = document.getElementById('setSchoolName').value.trim();
    const adminPwd = document.getElementById('setAdminPwd').value.trim();
    const slaPending = document.getElementById('setSlaPending').value.trim();
    const slaAccept = document.getElementById('setSlaAccept').value.trim();
    const slaFinish = document.getElementById('setSlaFinish').value.trim();
    const webhookType = document.getElementById('setWebhookType').value;
    const webhookUrl = document.getElementById('setWebhookUrl').value.trim();

    const body = {
      school_name: schoolName,
      sla_pending_hours: slaPending,
      sla_accept_hours: slaAccept,
      sla_finish_hours: slaFinish,
      webhook_type: webhookType,
      webhook_url: webhookUrl,
    };
    if (adminPwd) body.admin_password = adminPwd;

    try {
      await request('/api/admin/settings', {
        method: 'POST',
        token: adminToken,
        body,
      });
      toast('系统设置已保存生效！');
      await loadConfig();
    } catch (err) {
      toast(err.message);
    }
  };
}

// ----------------- 4. 场所报修码 -----------------
function renderQrView() {
  const options = appConfig.buildings.map((b) => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join('');
  return `
    <div class="card">
      <div class="card-title">
        <span style="display: flex; align-items: center; gap: 6px;">
          ${Icons.qrCode(18, 'text-cyan')}
          <span>场所二维码生成器</span>
        </span>
      </div>
      <div class="text-muted" style="margin-bottom: 12px;">张贴在教室、寝室或配电间门前，师生微信扫码自动识别地点并打开报修表单。</div>
      <div class="grid-form">
        <select id="qrBldgSelect">${options}</select>
        <input type="text" id="qrRoomInput" placeholder="例如：305教室" value="305教室">
      </div>
      <button class="btn btn-sm" id="btnMakeQr" style="margin-top: 10px; width: 140px;">生成报修码</button>
      <div style="text-align: center; margin-top: 20px;" id="qrCodeResultBox"></div>
    </div>
  `;
}

function bindQrEvents() {
  document.getElementById('btnMakeQr').onclick = () => {
    const bldg = document.getElementById('qrBldgSelect').value;
    const room = document.getElementById('qrRoomInput').value.trim();
    const url = `${window.location.origin}/?bldg=${encodeURIComponent(bldg)}&room=${encodeURIComponent(room)}`;

    const imgTag = generateQrImage(url, 6);
    document.getElementById('qrCodeResultBox').innerHTML = `
      <div style="display: inline-block; padding: 16px; background: #fff; color: #000; border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow);">
        ${imgTag}
        <div style="font-weight: 800; font-size: 15px; margin-top: 8px;">${escapeHtml(bldg)} · ${escapeHtml(room)}</div>
        <div style="font-size: 11.5px; color: #64748b;">微信扫码直接报修</div>
      </div>
    `;
  };
}

function logout() {
  adminToken = '';
  localStorage.removeItem('bx_admin_token');
  renderLoginView();
}

init();
