/**
 * 维修师傅工作台 - 前端主逻辑
 * UI 层：design system (style.css) + 内联 SVG 图标 (icons.js)
 */
import '../common/style.css';
import { request, STATUS_MAP } from '../common/api.js';
import { escapeHtml, formatTime, formatShortTime, toast, openModal, closeModal, viewImage, uploadPhoto, runAction, uploadingTile, updateUploadTile, delegateActions, createPoller, relTimeFrom } from '../common/utils.js';
import { icon, categoryIcon, themeToggleBtn, bindThemeToggle } from '../common/icons.js';

let workerToken = localStorage.getItem('bx_worker_token') || '';
let workerUser = JSON.parse(localStorage.getItem('bx_worker_user') || 'null');
let currentTab = 'tasks'; // 'tasks' | 'history'
let workerTickets = [];
// #11 轮询自动刷新：已见过的工单 id（用于识别新派单）
const seenTaskIds = new Set();
let taskPoller = null;
let taskLabelTimer = null;
let lastTaskRefresh = 0;

async function init() {
  if (!workerToken || !workerUser) {
    renderLoginView();
  } else {
    renderWorkerView();
  }
}

// ----------------- 登录 -----------------
function renderLoginView() {
  document.getElementById('app').innerHTML = `
    <header class="topbar">
      <div class="nav-wrap">
        <div class="brand">
          <span class="logo-mark">${icon('wrench', 19)}</span>
          <div class="titles">
            <div class="title">维修师傅工作台</div>
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
          <div class="card-title">${icon('lock', 16)}师傅登录</div>
          <span class="card-sub">凭工号 / 手机号</span>
        </div>
        <div class="field">
          <label class="label" for="w_login_user">师傅工号 / 手机号</label>
          <input class="control" type="text" id="w_login_user" placeholder="例如：13800000001" autocomplete="username">
        </div>
        <div class="field">
          <label class="label" for="w_login_pwd">登录密码</label>
          <input class="control" type="password" id="w_login_pwd" placeholder="请输入登录密码" autocomplete="current-password">
        </div>
        <button class="btn btn-primary btn-block btn-lg mt-12" id="btnWorkerLogin" type="button">${icon('logout', 17)}进入工作台</button>
        <div class="hint center mt-12">${icon('info', 13)}初始账号为总务处预设手机号，登录后请尽快修改密码</div>
      </div>
    </main>
  `;

  bindThemeToggle();

  const submit = async () => {
    const username = document.getElementById('w_login_user').value.trim();
    const password = document.getElementById('w_login_pwd').value.trim();
    if (!username || !password) {
      toast('请填写工号及密码');
      return;
    }
    const btn = document.getElementById('btnWorkerLogin');
    await runAction(btn, '正在登录…', async () => {
      const res = await request('/api/auth/login', { method: 'POST', body: { role: 'worker', username, password } });
      workerToken = res.token;
      workerUser = res;
      localStorage.setItem('bx_worker_token', res.token);
      localStorage.setItem('bx_worker_user', JSON.stringify(res));
      toast(`欢迎回来，${res.name}师傅`);
      renderWorkerView();
    });
  };

  document.getElementById('btnWorkerLogin').onclick = submit;
  document.getElementById('w_login_pwd').onkeydown = (e) => { if (e.key === 'Enter') submit(); };
}

// ----------------- 工作台骨架 -----------------
function renderWorkerView() {
  const initial = escapeHtml((workerUser.name || '师傅').slice(0, 1));
  document.getElementById('app').innerHTML = `
    <header class="topbar">
      <div class="nav-wrap">
        <div class="brand">
          <span class="logo-mark">${icon('wrench', 19)}</span>
          <div class="titles">
            <div class="title">${escapeHtml(workerUser.name)}师傅</div>
            <div class="subtitle">维修师傅工作台</div>
          </div>
        </div>
        <div class="topbar-actions">
          <span class="user-chip hide-sm"><span class="avatar">${initial}</span><span class="name">${escapeHtml(workerUser.name)}</span></span>
          <button class="icon-btn" id="btnChangePwd" type="button" aria-label="修改密码" title="修改密码">${icon('lock', 18)}</button>
          <button class="icon-btn" id="btnLogoutWorker" type="button" aria-label="退出登录" title="退出登录">${icon('logout', 18)}</button>
          ${themeToggleBtn()}
        </div>
      </div>
    </header>

    <main class="app-container" id="workerMainContainer"></main>

    <nav class="tabbar" aria-label="工作台导航">
      <button class="tabbar-item active" id="tabTasksBtn" type="button">
        ${icon('wrench', 21)}
        <span>待办任务</span>
      </button>
      <button class="tabbar-item" id="tabHistoryBtn" type="button">
        ${icon('history', 21)}
        <span>完工记录</span>
      </button>
    </nav>
  `;

  document.getElementById('tabTasksBtn').onclick = () => switchTab('tasks');
  document.getElementById('tabHistoryBtn').onclick = () => switchTab('history');
  document.getElementById('btnLogoutWorker').onclick = logout;
  document.getElementById('btnChangePwd').onclick = openChangePwdModal;
  bindThemeToggle();

  switchTab('tasks');
}

function switchTab(tab) {
  currentTab = tab;
  const a = document.getElementById('tabTasksBtn');
  const b = document.getElementById('tabHistoryBtn');
  // 只要有任务页存在就开启轮询（poller 内部按当前标签页过滤）
  if (document.getElementById('workerMainContainer')) startTaskPoller();

  if (a) a.classList.toggle('active', tab === 'tasks');
  if (b) b.classList.toggle('active', tab === 'history');
  loadWorkerTickets();
}

/** 记录本次工单 id，返回首见的 id 集合 */
function diffNewTaskIds(list) {
  const fresh = new Set(list.filter((t) => !seenTaskIds.has(t.id)).map((t) => t.id));
  list.forEach((t) => seenTaskIds.add(t.id));
  if (seenTaskIds.size > 800) {
    seenTaskIds.clear();
    list.forEach((t) => seenTaskIds.add(t.id));
  }
  return fresh;
}

function taskPollBarHtml(count) {
  return `
    <div class="row between mb-8 subtle fs-13">
      <span>待处理 ${count} 单</span>
      <span class="poll-bar">
        <span class="poll-dot" aria-hidden="true"></span>
        <span id="taskPollLabel">${relTimeFrom(lastTaskRefresh)}</span>
        <button class="poll-refresh" type="button" id="btnTaskRefresh">${icon('refresh', 12)}刷新</button>
      </span>
    </div>`;
}

function updateTaskPollLabel() {
  const el = document.getElementById('taskPollLabel');
  if (el) el.textContent = relTimeFrom(lastTaskRefresh);
}

function bindTaskPollButton() {
  const btn = document.getElementById('btnTaskRefresh');
  if (btn) btn.onclick = () => loadWorkerTickets({ silent: true });
}

/** 启动任务列表轮询（仅在"待办任务"页生效） */
function startTaskPoller() {
  if (taskPoller) return;
  taskPoller = createPoller(async () => {
    if (currentTab !== 'tasks') return false;
    if (document.querySelector('.modal-overlay')) return false;
    if (!document.getElementById('workerMainContainer')) return false;
    await loadWorkerTickets({ silent: true });
    return true;
  }, 30000, () => updateTaskPollLabel());

  if (!taskLabelTimer) taskLabelTimer = setInterval(updateTaskPollLabel, 30000);
}

async function loadWorkerTickets({ silent = false } = {}) {
  const container = document.getElementById('workerMainContainer');
  if (!container) return;
  if (!silent) container.innerHTML = skeletonList(2);

  try {
    const list = await request(`/api/tickets?assignee=${encodeURIComponent(workerUser.name)}`, { token: workerToken });
    workerTickets = list;

    const newIds = diffNewTaskIds(list);
    if (silent && newIds.size > 0) toast(`有 ${newIds.size} 条新派单，请及时处理`);
    lastTaskRefresh = Date.now();
    const markNew = silent ? newIds : new Set();

    if (currentTab === 'tasks') {
      const activeList = list.filter((t) => t.status === 'assigned' || t.status === 'working');
      updateTaskBadge(activeList.length);
      if (activeList.length === 0) {
        container.innerHTML = emptyBlock('checkCircle', '当前没有待办任务', '新的派单会实时出现在这里');
        bindTaskPollButton();
        return;
      }
      container.innerHTML = taskPollBarHtml(activeList.length) +
        activeList.map((t) => renderTicketCard(t, markNew.has(t.id))).join('');
      bindTaskPollButton();
    } else {
      const historyList = list.filter((t) => t.status === 'done' || t.status === 'closed');
      if (historyList.length === 0) {
        container.innerHTML = emptyBlock('inbox', '暂无完工记录', '完成并提交后，工单会归档到这里');
        return;
      }
      const rated = historyList.filter((t) => t.rating).length;
      const avg = rated ? (historyList.reduce((s, t) => s + (t.rating?.score || 0), 0) / rated).toFixed(1) : '--';
      container.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi-card"><div class="kpi-body"><div class="val">${historyList.length}</div><div class="lbl">累计完工</div></div><span class="kpi-icon i-ok">${icon('checkCircle', 20)}</span></div>
          <div class="kpi-card"><div class="kpi-body"><div class="val">${avg}</div><div class="lbl">平均评分</div></div><span class="kpi-icon i-warn">${icon('star', 20)}</span></div>
        </div>
        ${historyList.map((t) => renderTicketCard(t, false)).join('')}`;
    }
  } catch (err) {
    if (err.message && err.message.includes('未授权')) {
      logout();
      return;
    }
    if (silent) return; // 轮询失败保持原列表，不打断当前操作
    renderErrorWithRetry(container, err.message, () => loadWorkerTickets());
  }
}

function updateTaskBadge(count) {
  const btn = document.getElementById('tabTasksBtn');
  if (!btn) return;
  const old = btn.querySelector('.dot');
  if (old) old.remove();
  if (count > 0) {
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.textContent = count > 99 ? '99+' : String(count);
    btn.appendChild(dot);
  }
}

function skeletonList(n) {
  return Array.from({ length: n }, () => '<div class="skeleton sk-row"></div>').join('');
}

function emptyBlock(iconName, title, desc) {
  return `<div class="card"><div class="empty">
    <div class="empty-icon">${icon(iconName, 22)}</div>
    <div class="empty-title">${escapeHtml(title)}</div>
    <div class="empty-desc">${escapeHtml(desc)}</div>
  </div></div>`;
}

function errorBlock(msg) {
  return `<div class="card"><div class="empty">
    <div class="empty-icon">${icon('alert', 22)}</div>
    <div class="empty-title">加载失败</div>
    <div class="empty-desc">${escapeHtml(msg)}</div>
    <button class="btn btn-primary mt-16" type="button" id="btnBlockRetry">${icon('refresh', 14)}重新加载</button>
  </div></div>`;
}

/** 渲染错误空态并绑定重试按钮 */
function renderErrorWithRetry(container, msg, retry) {
  if (!container) return;
  container.innerHTML = errorBlock(msg);
  const btn = document.getElementById('btnBlockRetry');
  if (btn) btn.onclick = retry;
}

function renderTicketCard(t, isNew = false) {
  const st = STATUS_MAP[t.status] || { label: t.status, cls: 'b-pending' };
  const timeoutBadge = t.isTimeout ? `<span class="badge b-timeout">${icon('alert', 12)}超时</span>` : '';
  const remindBadge = t.remindCount > 0 ? `<span class="badge b-remind">${icon('bell', 12)}催单 ${t.remindCount}</span>` : '';
  // 多房间同批提交：提示师傅这是一批里的第几条，方便一次跑完同层同批的房间
  const batchBadge = t.batchToken && (t.batchSize || 1) > 1
    ? `<span class="batch-badge" title="与同批次的其它房间一起提交">${icon('layers', 11)}同批 ${t.batchSize} 间</span>`
    : '';

  let actionsHtml = `<button class="btn btn-sm btn-outline" type="button" data-act="w-detail" data-id="${escapeHtml(t.id)}">${icon('eye', 14)}详情</button>`;
  if (t.status === 'assigned') {
    actionsHtml += `<button class="btn btn-sm btn-primary" type="button" data-act="w-accept" data-id="${escapeHtml(t.id)}">${icon('check', 14)}接单到场</button>`;
  }
  if (t.status === 'working') {
    actionsHtml += `<button class="btn btn-sm btn-ok" type="button" data-act="w-finish" data-id="${escapeHtml(t.id)}">${icon('hammer', 14)}完工提交</button>`;
  }
  actionsHtml += `<a class="btn btn-sm btn-soft" href="tel:${escapeHtml(t.phone)}">${icon('phone', 14)}呼叫报修人</a>`;

  const photosHtml = t.photos && t.photos.length > 0
    ? `<div class="photos-grid">${t.photos.map((p, i) => `<div class="photo-item sm"><img src="${escapeHtml(p)}" alt="现场照片 ${i + 1}" data-act="view-photo" data-src="${escapeHtml(p)}" role="button" tabindex="0"></div>`).join('')}</div>`
    : '';

  return `
    <article class="ticket-card ${t.isTimeout ? 'is-timeout' : ''}${isNew ? ' is-new' : ''}">
      <div class="ticket-head">
        <span class="ticket-no">${escapeHtml(t.id)}</span>
        <div class="badge-row">${batchBadge}${remindBadge}${timeoutBadge}<span class="badge ${st.cls}">${st.label}</span></div>
      </div>
      <h3 class="ticket-title">${icon('mapPin', 15)}${escapeHtml(t.building)} ${escapeHtml(t.room)}</h3>
      ${t.batchToken && (t.batchSize || 1) > 1 ? `<div class="room-hint room-hint-batch">${icon('info', 12)}本条属同批报修，同批共 ${t.batchSize} 间，需逐间完工</div>` : ''}
      <div class="ticket-meta">
        <span class="meta-item">${categoryIcon(t.category, 13)}${escapeHtml(t.category)}</span>
        <span class="meta-item ${t.urgency === '紧急' ? 'urgent strong' : ''}">${icon('alert', 13)}${escapeHtml(t.urgency)}</span>
        <span class="meta-item">${icon('clock', 13)}${formatShortTime(t.createdAt)}</span>
      </div>
      <p class="ticket-desc">${escapeHtml(t.desc)}</p>
      ${photosHtml}
      <div class="row start gap-6 mt-10 fs-13">
        ${icon('user', 14)}<span>${escapeHtml(t.reporter)}</span>
        <a class="mono" href="tel:${escapeHtml(t.phone)}">${escapeHtml(t.phone)}</a>
      </div>
      <div class="ticket-actions">${actionsHtml}</div>
    </article>
  `;
}

const workerAccept = async (id) => {
  try {
    await request(`/api/tickets/${id}/accept`, { method: 'POST', token: workerToken });
    toast('接单成功，请尽快到场处理');
    loadWorkerTickets();
  } catch (err) {
    toast(err.message);
  }
};

// ----------------- 完工提交 -----------------
let finishPhotos = [];

function renderFinishPhotos(extraHtml = '') {
  const box = document.getElementById('finishPhotosBox');
  if (!box) return;
  const uploadBtn = (finishPhotos.length < 3)
    ? `<label class="photo-upload-btn" id="finishUploadBtn">
        ${icon('camera', 22)}
        <span>拍照上传</span>
        <input type="file" id="finishFileInput" accept="image/*" capture="environment" aria-label="拍摄完工照片" class="d-none">
      </label>` : '';

  box.innerHTML = finishPhotos.map((url, idx) => `
      <div class="photo-item">
        <img src="${escapeHtml(url)}" alt="完工照片 ${idx + 1}" data-act="view-photo" data-src="${escapeHtml(url)}" role="button" tabindex="0">
        <span class="btn-remove" data-act="remove-finish-photo" data-idx="${idx}" role="button" tabindex="0" aria-label="删除照片">${icon('close', 12)}</span>
      </div>`).join('') + extraHtml + uploadBtn;

  const fi = document.getElementById('finishFileInput');
  if (!fi) return;
  fi.onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (finishPhotos.length >= 3) {
      toast('完工照片最多 3 张');
      return;
    }
    const tileId = 'wpTile_' + Date.now();
    renderFinishPhotos(uploadingTile(tileId, '压缩上传中'));
    try {
      const res = await uploadPhoto(file, {
        maxEdge: 1600,
        quality: 0.82,
        onProgress: (p) => updateUploadTile(tileId, p),
      });
      finishPhotos.push(res.url);
      toast('完工照片上传成功');
    } catch (err) {
      toast(`上传失败：${err.message}`);
    } finally {
      renderFinishPhotos();
    }
  };
}

const removeFinishPhoto = (idx) => {
  finishPhotos.splice(idx, 1);
  renderFinishPhotos();
};

const openFinishModal = (id) => {
  finishPhotos = [];
  openModal(`
    <div class="modal-header">
      <h3>${icon('hammer', 18)}提交完工记录</h3>
      <button class="modal-close-btn" type="button" data-act="modal-close" aria-label="关闭">${icon('close', 16)}</button>
    </div>
    <div class="modal-body">
      <div class="field">
        <label class="label" for="finishResultInput"><span class="req">*</span>维修处理结果说明</label>
        <textarea class="control" id="finishResultInput" placeholder="例如：已更换日光灯管及启辉器，现场通电测试正常"></textarea>
      </div>
      <div class="grid-form">
        <div class="field">
          <label class="label" for="finishMaterialInput">维修耗材 / 配件<span class="opt">选填</span></label>
          <textarea class="control" id="finishMaterialInput" rows="2" placeholder="例如：4分水管接头 2 个、生料带 1 卷"></textarea>
        </div>
        <div class="field">
          <label class="label" for="finishMaterialSourceInput">配件购方 / 耗材来源<span class="opt">选填</span></label>
          <input class="control" type="text" id="finishMaterialSourceInput" placeholder="例如：物业部备用 / 学校采购 / 供应商保修" autocomplete="off">
        </div>
      </div>
      <div class="field">
        <span class="label">完工现场照片<span class="opt">最多 3 张</span></span>
        <div class="photos-grid" id="finishPhotosBox"></div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" type="button" data-act="modal-close">取消</button>
      <button class="btn btn-ok" id="btnSubmitFinish" type="button">${icon('check', 16)}提交并通知验收</button>
    </div>
  `);

  renderFinishPhotos();

  document.getElementById('btnSubmitFinish').onclick = async () => {
    const result = document.getElementById('finishResultInput').value.trim();
    const input = document.getElementById('finishResultInput');
    if (!result) {
      input.classList.add('invalid');
      toast('请填写维修处理结果说明');
      return;
    }
    input.classList.remove('invalid');
    const material = document.getElementById('finishMaterialInput').value.trim();
    const materialSource = document.getElementById('finishMaterialSourceInput').value.trim();
    const btn = document.getElementById('btnSubmitFinish');
    await runAction(btn, '正在提交…', async () => {
      await request(`/api/tickets/${id}/finish`, {
        method: 'POST',
        token: workerToken,
        body: { result, material, materialSource, photos: finishPhotos },
      });
      toast('完工提交成功，已通知报修人验收');
      closeModal();
      loadWorkerTickets();
    });
  };
};

// ----------------- 工单详情 -----------------
const openWorkerDetail = async (id) => {
  try {
    const t = await request(`/api/tickets/${id}`, { token: workerToken });
    const st = STATUS_MAP[t.status] || { label: t.status, cls: 'b-pending' };

    const timeoutAlert = t.isTimeout
      ? `<div class="alert alert-danger mb-12">${icon('alert', 16)}<div><strong>超时预警</strong>：${escapeHtml(t.timeoutReason)}，请尽快处理。</div></div>`
      : '';

    const photosHtml = t.photos && t.photos.length > 0
      ? `<div class="mt-12">
          <div class="label">现场报修照片</div>
          <div class="photos-grid">${t.photos.map((p, i) => `<div class="photo-item"><img src="${escapeHtml(p)}" alt="现场照片 ${i + 1}" data-act="view-photo" data-src="${escapeHtml(p)}" role="button" tabindex="0"></div>`).join('')}</div>
        </div>`
      : '';

    const roleLabel = (r) => (r === 'worker' ? '我' : r === 'admin' ? '总务处' : '报修人');
    const commentsHtml = `
      <div class="thread mt-12">
        <div class="thread-head">${icon('message', 16)}现场留言 <span class="badge b-plain">${(t.comments || []).length}</span></div>
        <div class="thread-list">
          ${(t.comments || []).length === 0
            ? `<div class="subtle fs-13">暂无留言，可留言告知预计到场时间</div>`
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
          <input class="control" type="text" id="dlgCommentInput" aria-label="留言内容" placeholder="留言告知预计到场时间等...">
          <button class="btn btn-primary shrink-0" id="dlgSendCommentBtn" type="button">${icon('send', 16)}</button>
        </div>
      </div>`;

    openModal(`
      <div class="modal-header">
        <h3>${icon('receipt', 18)}工单详情<span class="subtle fs-13 mono">${escapeHtml(t.id)}</span></h3>
        <button class="modal-close-btn" type="button" data-act="modal-close" aria-label="关闭">${icon('close', 16)}</button>
      </div>
      <div class="modal-body">
        ${timeoutAlert}
        <div class="row gap-8 wrap mb-12">
          <span class="badge ${st.cls}">${st.label}</span>
          <strong class="fs-16">${escapeHtml(t.building)} ${escapeHtml(t.room)}</strong>
          ${t.batchToken && (t.batchSize || 1) > 1 ? `<span class="batch-badge">${icon('layers', 11)}同批 ${t.batchSize} 间</span>` : ''}
        </div>
        <div class="alert alert-info mb-12">
          ${icon('phone', 16)}
          <div>
            报修人 ${escapeHtml(t.reporter)} ｜
            <a class="mono strong" href="tel:${escapeHtml(t.phone)}">${escapeHtml(t.phone)}</a>
            <span class="fs-13">（点击可直接呼叫）</span>
          </div>
        </div>
        <div class="soft-block">
          <div class="info-list">
            <div class="info-row"><span class="k">故障分类</span><span class="v">${categoryIcon(t.category, 14)}${escapeHtml(t.category)}</span></div>
            <div class="info-row"><span class="k">紧急程度</span><span class="v ${t.urgency === '紧急' ? 'strong' : ''}">${escapeHtml(t.urgency)}</span></div>
            <div class="info-row"><span class="k">提交时间</span><span class="v">${formatTime(t.createdAt)}</span></div>
            <div class="info-row"><span class="k">故障描述</span><span class="v">${escapeHtml(t.desc)}</span></div>
          </div>
          ${photosHtml}
        </div>
        ${t.result
          ? `<div class="alert alert-ok mt-12 col gap-4 start">
              ${icon('checkCircle', 16)}
              <div>
                <strong>我的完工记录</strong>
                <div class="mt-4">${escapeHtml(t.result)}</div>
                ${(t.material || t.materialSource) ? `<div class="mt-4">${icon('receipt', 13)} <strong>耗材/配件</strong>：${escapeHtml(t.material || '未填写')} ｜ <strong>配件购方</strong>：${escapeHtml(t.materialSource || '未填写')}</div>` : ''}
                ${t.finishPhotos && t.finishPhotos.length > 0 ? `<div class="photos-grid">${t.finishPhotos.map((p, i) => `<div class="photo-item"><img src="${escapeHtml(p)}" alt="完工照片 ${i + 1}" data-act="view-photo" data-src="${escapeHtml(p)}" role="button" tabindex="0"></div>`).join('')}</div>` : ''}
              </div>
            </div>`
          : ''}
        ${commentsHtml}
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" type="button" data-act="modal-close">关闭</button>
        ${t.status === 'assigned' ? `<button class="btn btn-primary" type="button" data-act="detail-accept" data-id="${escapeHtml(t.id)}">${icon('check', 16)}接单到场</button>` : ''}
        ${t.status === 'working' ? `<button class="btn btn-ok" type="button" data-act="detail-finish" data-id="${escapeHtml(t.id)}">${icon('hammer', 16)}完工提交</button>` : ''}
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
          token: workerToken,
          body: { senderRole: 'worker', senderName: workerUser.name, content },
        });
        openWorkerDetail(t.id);
      };
      await runAction(btn, '发送中…', run);
    };
    btn.onclick = send;
    input.onkeydown = (e) => { if (e.key === 'Enter') send(); };
  } catch (err) {
    toast(err.message);
  }
};

// ----------------- 修改密码 -----------------
function openChangePwdModal() {
  openModal(`
    <div class="modal-header">
      <h3>${icon('lock', 18)}修改登录密码</h3>
      <button class="modal-close-btn" type="button" data-act="modal-close" aria-label="关闭">${icon('close', 16)}</button>
    </div>
    <div class="modal-body">
      <div class="field">
        <label class="label" for="inputOldPwd">原密码</label>
        <input class="control" type="password" id="inputOldPwd" placeholder="输入原密码" autocomplete="current-password">
      </div>
      <div class="field">
        <label class="label" for="inputNewPwd">新密码<span class="opt">不少于 6 位</span></label>
        <input class="control" type="password" id="inputNewPwd" placeholder="输入新密码" autocomplete="new-password">
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" type="button" data-act="modal-close">取消</button>
      <button class="btn btn-primary" id="btnConfirmChangePwd" type="button">${icon('check', 16)}确认修改</button>
    </div>
  `);

  document.getElementById('btnConfirmChangePwd').onclick = async () => {
    const oldPassword = document.getElementById('inputOldPwd').value.trim();
    const newPassword = document.getElementById('inputNewPwd').value.trim();
    if (!oldPassword || !newPassword || newPassword.length < 6) {
      toast('新密码长度不能少于 6 位');
      return;
    }
    const btn = document.getElementById('btnConfirmChangePwd');
    await runAction(btn, '正在修改…', async () => {
      await request('/api/auth/change-password', {
        method: 'POST',
        token: workerToken,
        body: { oldPassword, newPassword },
      });
      toast('密码修改成功，请牢记');
      closeModal();
    });
  };
}

function logout() {
  workerToken = '';
  workerUser = null;
  localStorage.removeItem('bx_worker_token');
  localStorage.removeItem('bx_worker_user');
  if (taskPoller) { taskPoller.destroy(); taskPoller = null; }
  if (taskLabelTimer) { clearInterval(taskLabelTimer); taskLabelTimer = null; }
  seenTaskIds.clear();
  lastTaskRefresh = 0;
  renderLoginView();
}

// ----------------- 事件委托（替代 onclick="window.xxx()"） -----------------
delegateActions({
  'w-detail': ({ id }) => openWorkerDetail(id),
  'w-accept': ({ id }) => workerAccept(id),
  'w-finish': ({ id }) => openFinishModal(id),
  'detail-accept': ({ id }) => workerAccept(id),
  'detail-finish': ({ id }) => openFinishModal(id),
  'view-photo': ({ src }) => viewImage(src),
  'remove-finish-photo': ({ idx }) => removeFinishPhoto(Number(idx)),
  'modal-close': () => closeModal(),
});

init();
