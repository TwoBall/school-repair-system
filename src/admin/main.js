/**
 * 总务处调度管理中心 - 前端主逻辑
 */
import '../common/style.css';
import { request, STATUS_MAP } from '../common/api.js';
import { escapeHtml, formatTime, formatShortTime, toast, openModal, closeModal, viewImage, exportToCsv } from '../common/utils.js';
import { generateQrImage } from '../common/qrcode.js';

let adminToken = localStorage.getItem('bx_admin_token') || '';
let currentTab = 'pool'; // 'pool' | 'dash' | 'manage' | 'qrcode'
let subManageTab = 'workers'; // 'workers' | 'buildings' | 'categories' | 'settings'

let allTickets = [];
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

function renderLoginView() {
  document.getElementById('app').innerHTML = `
    <header class="topbar">
      <div class="nav-wrap">
        <div class="brand">
          <span style="font-size: 20px;">🏢</span>
          <div class="title">学校总务报修 - 调度管理中心</div>
        </div>
        <div class="portal-tag">总务管理端</div>
      </div>
    </header>

    <main class="app-container" style="max-width: 440px; margin-top: 36px;">
      <div class="card">
        <div class="card-title">
          <span>🔐 总务处管理员登录</span>
        </div>
        <div class="form-group">
          <label>总务管理员口令 / 密码</label>
          <input type="password" id="adminKeyInput" placeholder="默认初始口令 admin888" autocomplete="current-password">
        </div>
        <button class="btn" id="btnAdminLogin" style="margin-top: 8px;">登 录 总 务 中 心</button>
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
          <span style="font-size: 20px;">🏢</span>
          <div class="title">${escapeHtml(appConfig.schoolName || '总务处')} · 调度管理中心</div>
        </div>
        <div class="user-info">
          <span>管理员已在线</span>
          <button class="btn btn-sm btn-danger" id="btnLogoutAdmin">退出</button>
        </div>
      </div>
    </header>

    <main class="app-container wide" id="adminMainContainer"></main>

    <nav class="tabbar">
      <button class="tabbar-item active" id="tabPoolBtn">
        <span class="icon">📑</span>
        <span>工单大池</span>
      </button>
      <button class="tabbar-item" id="tabDashBtn">
        <span class="icon">📊</span>
        <span>数据看板</span>
      </button>
      <button class="tabbar-item" id="tabManageBtn">
        <span class="icon">⚙️</span>
        <span>基础配置</span>
      </button>
      <button class="tabbar-item" id="tabQrcodeBtn">
        <span class="icon">📱</span>
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
    container.innerHTML = `<div class="card text-muted" style="text-align: center; padding: 40px;">正在汇总统计数据...</div>`;
    loadDashboard();
  } else if (tab === 'manage') {
    container.innerHTML = renderManageView();
    bindManageEvents();
  } else if (tab === 'qrcode') {
    container.innerHTML = renderQrView();
    bindQrEvents();
  }
}

// ----------------- 1. 工单调度大池 -----------------
function renderPoolView() {
  const bldgOptions = `<option value="all">全部楼栋</option>` + appConfig.buildings.map((b) => `<option value="${escapeHtml(b)}" ${filterState.building === b ? 'selected' : ''}>${escapeHtml(b)}</option>`).join('');
  const catOptions = `<option value="all">全部分类</option>` + appConfig.categories.map((c) => `<option value="${escapeHtml(c)}" ${filterState.category === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');

  return `
    <div class="card">
      <div class="card-title">
        <span>📑 工单调度管理大池</span>
        <button class="btn btn-sm btn-ghost" id="btnExportCsv">📥 导出 Excel/CSV 报表</button>
      </div>

      <div class="grid-form" style="margin-bottom: 10px;">
        <input type="text" id="poolSearchInput" placeholder="输入单号/房间/描述/报修人/师傅姓名..." value="${escapeHtml(filterState.search)}">
        <div style="display: flex; gap: 8px;">
          <select id="poolBldgSelect">${bldgOptions}</select>
          <select id="poolCatSelect">${catOptions}</select>
          <button class="btn btn-sm" id="btnFilterSearch" style="flex: none; width: 75px;">筛选</button>
        </div>
      </div>

      <div class="chips-group" id="poolStatusChips">
        <span class="chip ${filterState.status === 'all' && !filterState.timeoutOnly ? 'active' : ''}" data-st="all">全部</span>
        <span class="chip ${filterState.status === 'pending' ? 'active' : ''}" data-st="pending">待受理</span>
        <span class="chip ${filterState.status === 'assigned' ? 'active' : ''}" data-st="assigned">已派工</span>
        <span class="chip ${filterState.status === 'working' ? 'active' : ''}" data-st="working">维修中</span>
        <span class="chip ${filterState.status === 'done' ? 'active' : ''}" data-st="done">待验收</span>
        <span class="chip ${filterState.status === 'closed' ? 'active' : ''}" data-st="closed">已结单</span>
        <span class="chip danger ${filterState.timeoutOnly ? 'active' : ''}" data-st="timeout">⚠️ 超时预警工单</span>
      </div>
    </div>

    <div id="poolListContainer">
      <div class="card text-muted" style="text-align: center; padding: 40px;">正在加载工单大池...</div>
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
  container.innerHTML = `<div class="card text-muted" style="text-align: center; padding: 36px 12px;">加载中...</div>`;

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
      return;
    }

    container.innerHTML = list.map((t) => renderAdminTicketCard(t)).join('');
  } catch (err) {
    if (err.message && err.message.includes('未授权')) {
      logout();
      return;
    }
    container.innerHTML = `<div class="card text-muted" style="text-align: center; color: var(--danger);">加载失败: ${escapeHtml(err.message)}</div>`;
  }
}

function renderAdminTicketCard(t) {
  const st = STATUS_MAP[t.status] || { label: t.status, cls: 'b-pending' };
  const timeoutBadge = t.isTimeout ? `<span class="badge b-timeout">⚠️ ${escapeHtml(t.timeoutReason)}</span>` : '';
  const remindBadge = t.remindCount > 0 ? `<span class="badge b-remind">🔔 催单(${t.remindCount})</span>` : '';

  let actionsHtml = `<button class="btn btn-sm btn-ghost" onclick="window.openAdminDetail('${escapeHtml(t.id)}')">详情/留言</button> `;
  if (t.status === 'pending' || t.status === 'assigned') {
    actionsHtml += `<button class="btn btn-sm btn-ok" onclick="window.openAssignModal('${escapeHtml(t.id)}')">指派师傅</button> `;
  }
  if (t.status === 'pending') {
    actionsHtml += `<button class="btn btn-sm btn-danger" onclick="window.rejectTicket('${escapeHtml(t.id)}')">驳回</button> `;
  }
  actionsHtml += `<button class="btn btn-sm btn-ghost" onclick="window.printTicket('${escapeHtml(t.id)}')">🖨️ 打印派工单</button>`;

  return `
    <div class="ticket-card ${t.isTimeout ? 'is-timeout' : ''}">
      <div class="ticket-head">
        <span class="ticket-no">${escapeHtml(t.id)}</span>
        <div style="display: flex; gap: 4px;">
          ${remindBadge}
          ${timeoutBadge}
          <span class="badge ${st.cls}">${st.label}</span>
        </div>
      </div>
      <div class="ticket-title">${escapeHtml(t.building)} ${escapeHtml(t.room)}</div>
      <div class="ticket-meta">
        <span>类别：${escapeHtml(t.category)}</span> | 
        <span>紧急度：<strong style="${t.urgency === '紧急' ? 'color: var(--danger);' : ''}">${escapeHtml(t.urgency)}</strong></span> | 
        <span>报修人：${escapeHtml(t.reporter)} 📱 ${escapeHtml(t.phone)} (${escapeHtml(t.identity)})</span> | 
        <span>时间：${formatTime(t.createdAt)}</span>
        ${t.assignee ? ` | <strong style="color: var(--brand);">负责师傅：${escapeHtml(t.assignee)}</strong>` : ''}
      </div>
      <div class="ticket-desc">${escapeHtml(t.desc)}</div>
      <div class="ticket-actions">${actionsHtml}</div>
    </div>
  `;
}

window.openAssignModal = (id) => {
  const options = appConfig.workers.map((w) => `<option value="${escapeHtml(w.name)}">${escapeHtml(w.name)} (${escapeHtml(w.skill)} 📱${escapeHtml(w.phone)})</option>`).join('');

  openModal(`
    <div class="modal-header">
      <h3>指派维修师傅</h3>
      <button class="modal-close-btn" onclick="window.closeModal()">×</button>
    </div>
    <div class="form-group">
      <label>选择负责师傅</label>
      <select id="assignWorkerSelect">${options}</select>
    </div>
    <div class="form-group">
      <label>派工说明 / 批注</label>
      <textarea id="assignNoteInput" placeholder="例如：带上专用工具，请在上午尽快到场排查..."></textarea>
    </div>
    <button class="btn btn-ok" id="btnConfirmAssign">确认指派并发送通知</button>
  `);

  document.getElementById('btnConfirmAssign').onclick = async () => {
    const worker = document.getElementById('assignWorkerSelect').value;
    const note = document.getElementById('assignNoteInput').value.trim();
    try {
      await request(`/api/tickets/${id}/assign`, {
        method: 'POST',
        token: adminToken,
        body: { worker, note },
      });
      toast(`已成功派工给 ${worker}！`);
      closeModal();
      loadPoolTickets();
    } catch (err) {
      toast(err.message);
    }
  };
};

window.rejectTicket = async (id) => {
  const note = prompt('请输入驳回原因（将展示给报修人）：', '不在维修范围或重复报修');
  if (note === null) return;
  try {
    await request(`/api/tickets/${id}/reject`, {
      method: 'POST',
      token: adminToken,
      body: { note },
    });
    toast('已驳回该工单');
    loadPoolTickets();
  } catch (err) {
    toast(err.message);
  }
};

window.openAdminDetail = async (id) => {
  try {
    const t = await request(`/api/tickets/${id}`, { token: adminToken });
    const st = STATUS_MAP[t.status] || { label: t.status, cls: 'b-pending' };

    const photosHtml = t.photos && t.photos.length > 0
      ? `<div style="margin-top: 10px;"><strong>现场报修照片：</strong><div class="photos-grid">${t.photos.map((p) => `<div class="photo-item"><img src="${escapeHtml(p)}" onclick="window.viewImage('${escapeHtml(p)}')"></div>`).join('')}</div></div>`
      : '';

    const finishHtml = t.result
      ? `<div style="background: var(--ok-light); border-radius: 8px; padding: 10px 12px; margin-top: 12px; font-size: 13.5px;">
          <strong style="color: var(--ok);">维修结果：</strong>${escapeHtml(t.result)}
          ${t.finishPhotos && t.finishPhotos.length > 0 ? `<div class="photos-grid" style="margin-top: 6px;">${t.finishPhotos.map((p) => `<div class="photo-item"><img src="${escapeHtml(p)}" onclick="window.viewImage('${escapeHtml(p)}')"></div>`).join('')}</div>` : ''}
        </div>`
      : '';

    openModal(`
      <div class="modal-header">
        <h3>工单详细档案 ${escapeHtml(t.id)}</h3>
        <button class="modal-close-btn" onclick="window.closeModal()">×</button>
      </div>
      <div style="background: #f8fafc; border-radius: 9px; padding: 10px; font-size: 13.5px; line-height: 1.7;">
        <div><span class="badge ${st.cls}">${st.label}</span> <strong style="font-size: 16px; margin-left: 4px;">${escapeHtml(t.building)} ${escapeHtml(t.room)}</strong></div>
        <div><strong>故障分类：</strong>${escapeHtml(t.category)} | <strong>紧急度：</strong>${escapeHtml(t.urgency)}</div>
        <div><strong>报修人：</strong>${escapeHtml(t.reporter)} 📱 ${escapeHtml(t.phone)} (${escapeHtml(t.identity)})</div>
        <div><strong>负责师傅：</strong>${escapeHtml(t.assignee || '未指派')}</div>
        <div><strong>提交时间：</strong>${formatTime(t.createdAt)}</div>
        <div style="margin-top: 4px;"><strong>故障描述：</strong>${escapeHtml(t.desc)}</div>
        ${photosHtml}
      </div>
      ${finishHtml}
      <div style="background: #f8fafc; border-radius: 9px; padding: 10px; margin-top: 14px; border: 1px solid var(--border);">
        <div style="font-weight: 600; font-size: 13.5px; margin-bottom: 8px;">💬 现场各方沟通留言 (${(t.comments || []).length})</div>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          ${(t.comments || []).length === 0 ? `<div class="text-muted" style="font-size: 12px;">暂无留言</div>` : (t.comments || []).map((c) => `
            <div style="border-bottom: 1px dashed var(--border); padding-bottom: 4px;">
              <div style="display: flex; justify-content: space-between; font-size: 11px; color: var(--text-muted);">
                <span><strong>${escapeHtml(c.senderName)}</strong> (${escapeHtml(c.senderRole === 'admin' ? '总务处' : c.senderRole === 'worker' ? '维修师傅' : '报修人')})</span>
                <span>${formatShortTime(c.createdAt)}</span>
              </div>
              <div style="font-size: 13px; color: #1e293b; margin-top: 2px;">${escapeHtml(c.content)}</div>
            </div>
          `).join('')}
        </div>
        <div style="display: flex; gap: 6px; margin-top: 10px;">
          <input type="text" id="dlgCommentInput" placeholder="输入总务处指导意见...">
          <button class="btn btn-sm" id="dlgSendCommentBtn" style="flex: none; width: 65px;">发送</button>
        </div>
      </div>
    `);

    document.getElementById('dlgSendCommentBtn').onclick = async () => {
      const content = document.getElementById('dlgCommentInput').value.trim();
      if (!content) return;
      try {
        await request(`/api/tickets/${t.id}/comments`, {
          method: 'POST',
          token: adminToken,
          body: {
            senderRole: 'admin',
            senderName: '总务处管理员',
            content,
          },
        });
        window.openAdminDetail(t.id);
      } catch (e) {
        toast(e.message);
      }
    };
  } catch (err) {
    toast(err.message);
  }
};

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
        <td colspan="3" style="min-height: 60px;">${escapeHtml(t.desc)}</td>
      </tr>
      <tr>
        <td style="background: #f2f2f2; font-weight: bold;">维修记录及耗材说明</td>
        <td colspan="3" style="min-height: 80px;">${escapeHtml(t.result || '现场排查中...')}</td>
      </tr>
    </table>
    <div style="display: flex; justify-content: space-between; margin-top: 36px; padding: 0 20px; font-size: 14px;">
      <div>报修人验收签名：________________</div>
      <div>维修师傅签名：________________</div>
      <div>总务处审核盖章：________________</div>
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
  const headers = ['工单编号', '报修时间', '楼栋', '房间', '类别', '紧急度', '报修人', '电话', '身份', '状态', '师傅', '描述', '结果', '超时情况', '评分', '评价内容'];
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
    t.isTimeout ? t.timeoutReason : '正常',
    t.rating?.score || '',
    (t.rating?.comment || '').replace(/[\r\n]+/g, ' '),
  ]);
  exportToCsv(`总务报修导出_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
}

// ----------------- 2. 数据统计大屏 -----------------
async function loadDashboard() {
  const container = document.getElementById('adminMainContainer');
  try {
    const st = await request('/api/stats/dashboard', { token: adminToken });
    container.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi-card"><div class="val" style="color: var(--brand);">${st.total}</div><div class="lbl">累计报修总数</div></div>
        <div class="kpi-card"><div class="val" style="color: var(--warn);">${st.pending + st.assigned + st.working}</div><div class="lbl">在办工单</div></div>
        <div class="kpi-card"><div class="val" style="color: var(--ok);">${st.finishRate}%</div><div class="lbl">综合办结率</div></div>
        <div class="kpi-card"><div class="val" style="color: #eab308;">${st.avgScore}⭐</div><div class="lbl">综合好评率</div></div>
        <div class="kpi-card" id="cardKpiTimeout" style="cursor: pointer;"><div class="val" style="color: var(--danger);">${st.timeouts}</div><div class="lbl">⚠️ 超时工单 (点击过滤)</div></div>
      </div>

      <div class="card">
        <div class="card-title"><span>📊 故障分类报修分布排行</span></div>
        <div style="display: flex; flex-direction: column; gap: 8px;">${renderBarList(st.catMap, st.total)}</div>
      </div>

      <div class="card">
        <div class="card-title"><span>🏢 校区楼栋报修频次排行</span></div>
        <div style="display: flex; flex-direction: column; gap: 8px;">${renderBarList(st.bldgMap, st.total)}</div>
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
      <div style="display: flex; align-items: center; gap: 10px; font-size: 13px;">
        <div style="width: 85px; flex: none; text-align: right; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(k)}</div>
        <div style="flex: 1; height: 14px; background: #eef2f8; border-radius: 7px; overflow: hidden;">
          <div style="width: ${pct}%; height: 100%; background: linear-gradient(90deg, #2563eb, #38bdf8); border-radius: 7px;"></div>
        </div>
        <div style="width: 36px; flex: none; text-align: right; font-weight: 700;">${v}</div>
      </div>
    `;
  }).join('');
}

// ----------------- 3. 基础配置中心 -----------------
function renderManageView() {
  return `
    <div class="card">
      <div class="card-title"><span>⚙️ 后勤基础数据与系统设置</span></div>
      <div class="chips-group" id="manageSubTabChips">
        <span class="chip ${subManageTab === 'workers' ? 'active' : ''}" data-sub="workers">👨‍🔧 维修师傅管理</span>
        <span class="chip ${subManageTab === 'buildings' ? 'active' : ''}" data-sub="buildings">🏢 校区楼栋管理</span>
        <span class="chip ${subManageTab === 'categories' ? 'active' : ''}" data-sub="categories">🏷️ 故障分类管理</span>
        <span class="chip ${subManageTab === 'settings' ? 'active' : ''}" data-sub="settings">🔔 预警与机器人通知</span>
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
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;" border="1" cellpadding="8" bordercolor="#e2e8f0">
        <thead style="background: #f8fafc;">
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
    <button class="btn btn-ok" id="btnConfirmAddWorker">确认创建</button>
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
    <table style="width: 100%; border-collapse: collapse; font-size: 13px;" border="1" cellpadding="8" bordercolor="#e2e8f0">
      <thead style="background: #f8fafc;"><tr><th>楼栋名称</th><th>状态</th><th>操作</th></tr></thead>
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
  }).catch((e) => toast(e.message));
}

async function loadCatsTable() {
  const box = document.getElementById('catListWrapper');
  const list = await request('/api/admin/categories', { token: adminToken });
  box.innerHTML = `
    <table style="width: 100%; border-collapse: collapse; font-size: 13px;" border="1" cellpadding="8" bordercolor="#e2e8f0">
      <thead style="background: #f8fafc;"><tr><th>分类名称</th><th>状态</th><th>操作</th></tr></thead>
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
  const name = prompt('请输入新分类名称（例如：弱电监控设备）：');
  if (!name) return;
  request('/api/admin/categories', { method: 'POST', token: adminToken, body: { name: name.trim() } }).then(() => {
    toast('分类添加成功');
    loadCatsTable();
    loadConfig();
  }).catch((e) => toast(e.message));
}

async function loadSettingsForm() {
  const box = document.getElementById('manageSubContainer');
  const s = await request('/api/admin/settings', { token: adminToken });
  box.innerHTML = `
    <div class="card">
      <div class="card-title"><span>🔔 SLA 预警、工作群通知与密码设置</span></div>
      <div class="form-group">
        <label>系统单位抬头名称</label>
        <input type="text" id="s_school_name" value="${escapeHtml(s.school_name || '')}">
      </div>
      <div class="grid-form">
        <div class="form-group">
          <label>待受理超时 (小时)</label>
          <input type="number" id="s_sla_pending" value="${escapeHtml(s.sla_pending_hours || 4)}">
        </div>
        <div class="form-group">
          <label>派工未接单超时 (小时)</label>
          <input type="number" id="s_sla_accept" value="${escapeHtml(s.sla_accept_hours || 8)}">
        </div>
        <div class="form-group">
          <label>接单未完工超时 (小时)</label>
          <input type="number" id="s_sla_finish" value="${escapeHtml(s.sla_finish_hours || 24)}">
        </div>
      </div>
      <hr style="border: none; border-top: 1px dashed var(--border); margin: 16px 0;">
      <div class="form-group">
        <label>机器人通知渠道 (Webhook)</label>
        <select id="s_webhook_type">
          <option value="none" ${s.webhook_type === 'none' ? 'selected' : ''}>关闭推送</option>
          <option value="wecom" ${s.webhook_type === 'wecom' ? 'selected' : ''}>企业微信群机器人</option>
          <option value="dingtalk" ${s.webhook_type === 'dingtalk' ? 'selected' : ''}>钉钉群机器人</option>
          <option value="feishu" ${s.webhook_type === 'feishu' ? 'selected' : ''}>飞书自定义机器人</option>
        </select>
      </div>
      <div class="form-group">
        <label>Webhook 推送地址 (URL)</label>
        <input type="text" id="s_webhook_url" placeholder="https://qyapi.weixin.qq.com/... 或 oapi.dingtalk.com/..." value="${escapeHtml(s.webhook_url || '')}">
      </div>
      <div class="form-group">
        <label>加签安全密钥 (钉钉可选)</label>
        <input type="text" id="s_webhook_secret" placeholder="SEC..." value="${escapeHtml(s.webhook_secret || '')}">
      </div>
      <div style="margin-bottom: 16px;">
        <button class="btn btn-sm btn-ghost" id="btnTestWebhook">🔔 发送测试卡片到群</button>
      </div>
      <hr style="border: none; border-top: 1px dashed var(--border); margin: 16px 0;">
      <div class="form-group">
        <label>修改总务管理员登录口令 (留空不改)</label>
        <input type="password" id="s_admin_pwd" placeholder="输入新的总务管理密码">
      </div>
      <button class="btn btn-ok" id="btnSaveSettings">保存所有设置</button>
    </div>
  `;

  document.getElementById('btnTestWebhook').onclick = async () => {
    const webhook_type = document.getElementById('s_webhook_type').value;
    const webhook_url = document.getElementById('s_webhook_url').value.trim();
    const webhook_secret = document.getElementById('s_webhook_secret').value.trim();
    if (!webhook_url) { toast('请先输入 Webhook 推送地址'); return; }
    toast('正在发送测试消息...');
    try {
      await request('/api/admin/settings/test-webhook', {
        method: 'POST',
        token: adminToken,
        body: { webhook_type, webhook_url, webhook_secret },
      });
      toast('🎉 测试卡片已成功推送到工作群！');
    } catch (err) {
      toast(err.message);
    }
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

    try {
      await request('/api/admin/settings', {
        method: 'POST',
        token: adminToken,
        body: payload,
      });
      toast('系统配置已更新！');
      loadConfig();
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
      <div class="card-title"><span>📱 场所二维码生成器</span></div>
      <div class="text-muted" style="margin-bottom: 12px;">张贴在教室、寝室或实验室门前，师生微信扫码自动识别地点并打开报修表单。</div>
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
      <div style="display: inline-block; padding: 14px; background: #fff; border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow);">
        ${imgTag}
        <div style="font-weight: 700; margin-top: 8px;">${escapeHtml(bldg)} · ${escapeHtml(room)}</div>
        <div class="text-muted" style="font-size: 11px;">扫码直接报修</div>
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
