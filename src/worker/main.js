/**
 * 维修师傅工作台 - 前端主逻辑
 * 升级：科技指挥中心质感 + 深浅色切换 + 拇指热区大操作 + 一键拨号呼叫胶囊 + 顺丰级时间轴
 */
import '../common/style.css';
import { request, uploadImage, STATUS_MAP } from '../common/api.js';
import { escapeHtml, formatTime, formatShortTime, toast, openModal, closeModal, viewImage, initTheme } from '../common/utils.js';
import { renderStepperTimeline } from '../reporter/main.js';

let workerToken = localStorage.getItem('bx_worker_token') || '';
let workerUser = JSON.parse(localStorage.getItem('bx_worker_user') || 'null');
let currentTab = 'tasks'; // 'tasks' | 'history'
let workerTickets = [];

async function init() {
  initTheme();
  if (!workerToken || !workerUser) {
    renderLoginView();
  } else {
    renderWorkerView();
  }
}

function renderLoginView() {
  document.getElementById('app').innerHTML = `
    <header class="topbar">
      <div class="nav-wrap">
        <div class="brand">
          <span style="font-size: 22px;">🔧</span>
          <div class="title">学校总务报修 - 维修师傅工作台</div>
        </div>
        <div class="topbar-actions">
          <div class="portal-tag">师傅工作台</div>
          <button class="theme-toggle-btn" onclick="window.toggleTheme()" title="切换深浅主题">☀️</button>
        </div>
      </div>
    </header>

    <main class="app-container" style="max-width: 440px; margin-top: 32px;">
      <div class="card">
        <div class="card-title">
          <span>👷 师傅登录</span>
          <span class="text-muted">凭工号/手机号登录</span>
        </div>
        <div class="form-group">
          <label>师傅工号 / 预设手机号</label>
          <input type="text" id="w_login_user" placeholder="例如：13800000001" autocomplete="username">
        </div>
        <div class="form-group">
          <label>登录密码</label>
          <input type="password" id="w_login_pwd" placeholder="初始密码 worker888" autocomplete="current-password">
        </div>
        <button class="btn btn-ok" id="btnWorkerLogin" style="margin-top: 10px;">登 录 工 作 台</button>
        <div class="text-muted" style="text-align: center; margin-top: 14px; font-size: 12.5px;">
          初始账号为预设手机号，密码可登录后自主修改
        </div>
      </div>
    </main>
  `;

  document.getElementById('btnWorkerLogin').onclick = async () => {
    const username = document.getElementById('w_login_user').value.trim();
    const password = document.getElementById('w_login_pwd').value.trim();
    if (!username || !password) {
      toast('请填写工号及密码');
      return;
    }
    try {
      const res = await request('/api/auth/login', {
        method: 'POST',
        body: { role: 'worker', username, password },
      });
      workerToken = res.token;
      workerUser = res;
      localStorage.setItem('bx_worker_token', res.token);
      localStorage.setItem('bx_worker_user', JSON.stringify(res));
      toast(`欢迎回来，${res.name}师傅！`);
      renderWorkerView();
    } catch (err) {
      toast(err.message || '登录失败');
    }
  };
}

function renderWorkerView() {
  document.getElementById('app').innerHTML = `
    <header class="topbar">
      <div class="nav-wrap">
        <div class="brand">
          <span style="font-size: 22px;">👷</span>
          <div>
            <div class="title">${escapeHtml(workerUser.name)}师傅的工作台</div>
          </div>
        </div>
        <div class="topbar-actions">
          <button class="theme-toggle-btn" onclick="window.toggleTheme()" title="切换深浅主题">☀️</button>
          <button class="btn btn-sm btn-ghost" id="btnChangePwd">改密</button>
          <button class="btn btn-sm btn-danger" id="btnLogoutWorker">退出</button>
        </div>
      </div>
    </header>

    <main class="app-container" id="workerMainContainer"></main>

    <nav class="tabbar">
      <button class="tabbar-item active" id="tabTasksBtn">
        <span class="icon">🔧</span>
        <span>待办工单</span>
      </button>
      <button class="tabbar-item" id="tabHistoryBtn">
        <span class="icon">📜</span>
        <span>完工记录</span>
      </button>
    </nav>
  `;

  document.getElementById('tabTasksBtn').onclick = () => switchTab('tasks');
  document.getElementById('tabHistoryBtn').onclick = () => switchTab('history');
  document.getElementById('btnLogoutWorker').onclick = logout;
  document.getElementById('btnChangePwd').onclick = openChangePwdModal;

  switchTab('tasks');
}

function switchTab(tab) {
  currentTab = tab;
  document.getElementById('tabTasksBtn').classList.toggle('active', tab === 'tasks');
  document.getElementById('tabHistoryBtn').classList.toggle('active', tab === 'history');
  loadWorkerTickets();
}

async function loadWorkerTickets() {
  const container = document.getElementById('workerMainContainer');
  if (!container) return;
  container.innerHTML = `<div class="card text-muted" style="text-align: center; padding: 36px 12px;">正在加载您的工单...</div>`;

  try {
    const list = await request(`/api/tickets?assignee=${encodeURIComponent(workerUser.name)}`, {
      token: workerToken,
    });
    workerTickets = list;

    if (currentTab === 'tasks') {
      const activeList = list.filter((t) => t.status === 'assigned' || t.status === 'working');
      if (activeList.length === 0) {
        container.innerHTML = `<div class="card text-muted" style="text-align: center; padding: 48px 12px; font-size: 15px;">🎉 当前暂无待处理任务，休息一下吧！</div>`;
        return;
      }
      container.innerHTML = activeList.map((t) => renderTicketCard(t)).join('');
    } else {
      const historyList = list.filter((t) => t.status === 'done' || t.status === 'closed');
      if (historyList.length === 0) {
        container.innerHTML = `<div class="card text-muted" style="text-align: center; padding: 48px 12px;">暂无完工记录</div>`;
        return;
      }
      container.innerHTML = `
        <div class="card" style="padding: 12px 16px; font-weight: 700; color: var(--cyan); display: flex; justify-content: space-between; align-items: center;">
          <span>📋 累计服务档案</span>
          <span style="font-size: 13px;">已完工 ${historyList.length} 单</span>
        </div>
        ${historyList.map((t) => renderTicketCard(t)).join('')}
      `;
    }
  } catch (err) {
    if (err.message && err.message.includes('未授权')) {
      logout();
      return;
    }
    container.innerHTML = `<div class="card text-muted" style="text-align: center; padding: 36px 12px; color: var(--danger);">加载失败: ${escapeHtml(err.message)}</div>`;
  }
}

function renderTicketCard(t) {
  const st = STATUS_MAP[t.status] || { label: t.status, cls: 'b-pending' };
  const timeoutBadge = t.isTimeout ? `<span class="badge b-timeout">⚠️ ${escapeHtml(t.timeoutReason)}</span>` : '';
  const remindBadge = t.remindCount > 0 ? `<span class="badge b-remind">🔔 催单(${t.remindCount})</span>` : '';

  // 拇指热区快捷大操作按钮
  let primaryActionBtn = '';
  if (t.status === 'assigned') {
    primaryActionBtn = `<button class="btn btn-ok" style="flex: 1;" onclick="window.workerAccept('${escapeHtml(t.id)}')">⚡ 立即接单前往现场</button>`;
  } else if (t.status === 'working') {
    primaryActionBtn = `<button class="btn btn-ok" style="flex: 1;" onclick="window.openFinishModal('${escapeHtml(t.id)}')">📷 拍照完工并提交</button>`;
  }

  const actionsHtml = `
    <button class="btn btn-sm btn-ghost" onclick="window.openWorkerDetail('${escapeHtml(t.id)}')">详情与留言</button>
    ${primaryActionBtn}
  `;

  return `
    <div class="ticket-card ${t.isTimeout ? 'is-timeout' : ''}">
      <div class="ticket-head">
        <span class="ticket-no">#${escapeHtml(t.id)}</span>
        <div style="display: flex; gap: 4px; align-items: center;">
          ${remindBadge}
          ${timeoutBadge}
          <span class="badge ${st.cls}">${st.label}</span>
        </div>
      </div>

      <!-- 醒目地点标签 -->
      <div class="worker-location-tag">
        <span>📍</span>
        <span>${escapeHtml(t.building)} · ${escapeHtml(t.room)}</span>
      </div>

      <!-- 报修人一键呼叫胶囊 (UX 升级) -->
      <div style="margin: 8px 0 10px;">
        <a class="worker-call-btn" href="tel:${escapeHtml(t.phone)}">
          <span>📞 一键呼叫报修人：</span>
          <span>${escapeHtml(t.reporter)} (${escapeHtml(t.phone)})</span>
        </a>
      </div>

      <div class="ticket-meta">
        <span>类别：${escapeHtml(t.category)}</span> | 
        <span>紧急度：<strong style="${t.urgency === '紧急' ? 'color: var(--danger);' : ''}">${escapeHtml(t.urgency)}</strong></span> | 
        <span>派单时间：${formatShortTime(t.createdAt)}</span>
      </div>

      <div class="ticket-desc">${escapeHtml(t.desc)}</div>

      <div class="worker-quick-fab">${actionsHtml}</div>
    </div>
  `;
}

window.workerAccept = async (id) => {
  try {
    await request(`/api/tickets/${id}/accept`, {
      method: 'POST',
      token: workerToken,
    });
    toast('⚡ 接单成功，请尽快到场排查处理！');
    loadWorkerTickets();
  } catch (err) {
    toast(err.message);
  }
};

window.openFinishModal = (id) => {
  let finishPhotos = [];
  openModal(`
    <div class="modal-header">
      <h3>提交完工记录</h3>
      <button class="modal-close-btn" onclick="window.closeModal()">×</button>
    </div>
    <div class="form-group">
      <label><span class="req">*</span>维修处理结果说明</label>
      <textarea id="finishResultInput" placeholder="例如：已更换日光灯管及启辉器，现场通电测试正常..."></textarea>
    </div>
    <div class="form-group">
      <label>完工现场照片 (最多3张)</label>
      <div class="photos-grid" id="finishPhotosBox">
        <label class="photo-upload-btn" id="finishUploadBtn">
          <span style="font-size: 24px; line-height: 1;">📷</span>
          <span>拍照/上传</span>
          <input type="file" id="finishFileInput" accept="image/*" style="display: none;">
        </label>
      </div>
    </div>
    <button class="btn btn-ok" id="btnSubmitFinish">⚡ 提交完工并通知验收</button>
  `);

  function renderFinishPhotos() {
    const box = document.getElementById('finishPhotosBox');
    if (!box) return;
    box.innerHTML = finishPhotos.map((url, idx) => `
      <div class="photo-item">
        <img src="${escapeHtml(url)}" onclick="window.viewImage('${escapeHtml(url)}')">
        <span class="btn-remove" onclick="window.removeFinishPhoto(${idx})">×</span>
      </div>
    `).join('') + (finishPhotos.length < 3 ? `
      <label class="photo-upload-btn" id="finishUploadBtn">
        <span style="font-size: 24px; line-height: 1;">📷</span>
        <span>拍照/上传</span>
        <input type="file" id="finishFileInput" accept="image/*" style="display: none;">
      </label>
    ` : '');

    const fi = document.getElementById('finishFileInput');
    if (fi) {
      fi.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        toast('正在上传图片...');
        try {
          const res = await uploadImage(file);
          finishPhotos.push(res.url);
          renderFinishPhotos();
          toast('图片上传成功');
        } catch (err) {
          toast(err.message);
        }
      };
    }
  }

  window.removeFinishPhoto = (idx) => {
    finishPhotos.splice(idx, 1);
    renderFinishPhotos();
  };

  renderFinishPhotos();

  document.getElementById('btnSubmitFinish').onclick = async () => {
    const result = document.getElementById('finishResultInput').value.trim();
    if (!result) {
      toast('请填写维修处理结果说明');
      return;
    }
    try {
      await request(`/api/tickets/${id}/finish`, {
        method: 'POST',
        token: workerToken,
        body: { result, photos: finishPhotos },
      });
      toast('🎉 完工提交成功，已通知报修人验收！');
      closeModal();
      loadWorkerTickets();
    } catch (err) {
      toast(err.message);
    }
  };
};

window.openWorkerDetail = async (id) => {
  try {
    const t = await request(`/api/tickets/${id}`, { token: workerToken });
    const st = STATUS_MAP[t.status] || { label: t.status, cls: 'b-pending' };

    const photosHtml = t.photos && t.photos.length > 0
      ? `<div style="margin-top: 10px;"><strong>报修现场破损照片：</strong><div class="photos-grid">${t.photos.map((p) => `<div class="photo-item"><img src="${escapeHtml(p)}" onclick="window.viewImage('${escapeHtml(p)}')"></div>`).join('')}</div></div>`
      : '';

    const stepperHtml = renderStepperTimeline(t);

    openModal(`
      <div class="modal-header">
        <h3>工单详情 #${escapeHtml(t.id)}</h3>
        <button class="modal-close-btn" onclick="window.closeModal()">×</button>
      </div>
      <div style="background: var(--card-alt); border: 1px solid var(--border); border-radius: 9px; padding: 12px; font-size: 13.5px; line-height: 1.8;">
        <div><span class="badge ${st.cls}">${st.label}</span> <strong style="font-size: 16.5px; margin-left: 6px;">${escapeHtml(t.building)} ${escapeHtml(t.room)}</strong></div>
        <div><strong>故障分类：</strong>${escapeHtml(t.category)} | <strong>紧急程度：</strong>${escapeHtml(t.urgency)}</div>
        <div style="margin: 6px 0;">
          <a class="worker-call-btn" href="tel:${escapeHtml(t.phone)}">📞 一键呼叫报修人：${escapeHtml(t.reporter)} (${escapeHtml(t.phone)})</a>
        </div>
        <div><strong>提交时间：</strong>${formatTime(t.createdAt)}</div>
        <div style="margin-top: 6px; border-top: 1px dashed var(--border); padding-top: 6px;">
          <strong>故障描述：</strong>${escapeHtml(t.desc)}
        </div>
        ${photosHtml}
      </div>

      ${stepperHtml}

      <div style="background: var(--card-alt); border-radius: 9px; padding: 12px; margin-top: 14px; border: 1px solid var(--border);">
        <div style="font-weight: 700; font-size: 13.5px; margin-bottom: 8px; color: var(--text);">💬 现场三方留言沟通板 (${(t.comments || []).length})</div>
        <div style="display: flex; flex-direction: column; gap: 8px; max-height: 180px; overflow-y: auto;">
          ${(t.comments || []).length === 0 ? `<div class="text-muted" style="font-size: 12px;">暂无留言</div>` : (t.comments || []).map((c) => `
            <div style="border-bottom: 1px dashed var(--border); padding-bottom: 4px;">
              <div style="display: flex; justify-content: space-between; font-size: 11px; color: var(--text-muted);">
                <span><strong>${escapeHtml(c.senderName)}</strong> (${escapeHtml(c.senderRole === 'worker' ? '我' : c.senderRole === 'admin' ? '总务处' : '报修人')})</span>
                <span>${formatShortTime(c.createdAt)}</span>
              </div>
              <div style="font-size: 13px; color: var(--text); margin-top: 2px;">${escapeHtml(c.content)}</div>
            </div>
          `).join('')}
        </div>
        <div style="display: flex; gap: 6px; margin-top: 10px;">
          <input type="text" id="dlgCommentInput" placeholder="留言告知预计到场时间或备件情况...">
          <button class="btn btn-sm" id="dlgSendCommentBtn" style="flex: none; width: 70px;">发送</button>
        </div>
      </div>
    `);

    document.getElementById('dlgSendCommentBtn').onclick = async () => {
      const content = document.getElementById('dlgCommentInput').value.trim();
      if (!content) return;
      try {
        await request(`/api/tickets/${t.id}/comments`, {
          method: 'POST',
          token: workerToken,
          body: {
            senderRole: 'worker',
            senderName: workerUser.name,
            content,
          },
        });
        window.openWorkerDetail(t.id);
      } catch (e) {
        toast(e.message);
      }
    };
  } catch (err) {
    toast(err.message);
  }
};

function openChangePwdModal() {
  openModal(`
    <div class="modal-header">
      <h3>修改我的登录密码</h3>
      <button class="modal-close-btn" onclick="window.closeModal()">×</button>
    </div>
    <div class="form-group">
      <label>原密码</label>
      <input type="password" id="inputOldPwd" placeholder="输入原密码">
    </div>
    <div class="form-group">
      <label>新密码 (不少于6位)</label>
      <input type="password" id="inputNewPwd" placeholder="输入新密码">
    </div>
    <button class="btn btn-ok" id="btnConfirmChangePwd">确认修改</button>
  `);

  document.getElementById('btnConfirmChangePwd').onclick = async () => {
    const oldPassword = document.getElementById('inputOldPwd').value.trim();
    const newPassword = document.getElementById('inputNewPwd').value.trim();
    if (!oldPassword || !newPassword || newPassword.length < 6) {
      toast('新密码长度不能少于6位');
      return;
    }
    try {
      await request('/api/auth/change-password', {
        method: 'POST',
        token: workerToken,
        body: { oldPassword, newPassword },
      });
      toast('密码修改成功，请牢记！');
      closeModal();
    } catch (err) {
      toast(err.message);
    }
  };
}

function logout() {
  workerToken = '';
  workerUser = null;
  localStorage.removeItem('bx_worker_token');
  localStorage.removeItem('bx_worker_user');
  renderLoginView();
}

init();
