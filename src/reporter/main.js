/**
 * 师生在线报修专区 - 前端主逻辑
 */
import '../common/style.css';
import { request, uploadImage, fetchConfig, STATUS_MAP } from '../common/api.js';
import { escapeHtml, formatTime, formatShortTime, toast, openModal, closeModal, viewImage } from '../common/utils.js';

let appConfig = {
  schoolName: '学校总务报修服务中心',
  buildings: ['教学楼A栋', '教学楼B栋', '教学楼C栋', '实验楼', '图书馆', '行政楼', '食堂', '体育馆', '学生公寓1栋', '学生公寓2栋'],
  categories: ['水电照明', '门窗家具', '空调风扇', '给排水/卫浴', '多媒体设备', '墙面地面', '电梯设施', '其他'],
};

let currentTab = 'form'; // 'form' | 'mine'
let myPhone = localStorage.getItem('bx_reporter_phone') || '';
let uploadedPhotos = [];
let myTickets = [];

// 初始化
async function init() {
  renderLayout();
  try {
    const cfg = await fetchConfig();
    appConfig = { ...appConfig, ...cfg };
    document.getElementById('portalSchoolName').textContent = appConfig.schoolName || '学校总务报修系统';
  } catch (e) {
    console.warn('加载系统配置失败，使用默认配置:', e);
  }

  // 读取 URL 参数以支持二维码带入地点
  const urlParams = new URLSearchParams(window.location.search);
  const qBldg = urlParams.get('bldg');
  const qRoom = urlParams.get('room');

  switchTab(currentTab);

  if (qBldg && document.getElementById('f_bldg')) document.getElementById('f_bldg').value = qBldg;
  if (qRoom && document.getElementById('f_room')) document.getElementById('f_room').value = qRoom;
}

function renderLayout() {
  document.getElementById('app').innerHTML = `
    <header class="topbar">
      <div class="nav-wrap">
        <div class="brand">
          <span style="font-size: 20px;">🏫</span>
          <div>
            <div class="title" id="portalSchoolName">学校总务报修系统</div>
          </div>
        </div>
        <div class="portal-tag">师生报修通道</div>
      </div>
    </header>

    <main class="app-container" id="mainContainer"></main>

    <nav class="tabbar">
      <button class="tabbar-item active" id="tabFormBtn">
        <span class="icon">✏️</span>
        <span>在线报修</span>
      </button>
      <button class="tabbar-item" id="tabMineBtn">
        <span class="icon">📋</span>
        <span>我的报修</span>
      </button>
    </nav>
  `;

  document.getElementById('tabFormBtn').onclick = () => switchTab('form');
  document.getElementById('tabMineBtn').onclick = () => switchTab('mine');
}

function switchTab(tab) {
  currentTab = tab;
  document.getElementById('tabFormBtn').classList.toggle('active', tab === 'form');
  document.getElementById('tabMineBtn').classList.toggle('active', tab === 'mine');

  const container = document.getElementById('mainContainer');
  if (tab === 'form') {
    container.innerHTML = renderFormView();
    bindFormEvents();
  } else {
    container.innerHTML = renderMineView();
    bindMineEvents();
    if (myPhone) {
      loadMyTickets();
    }
  }
}

// ----------------- 报修表单页面 -----------------
function renderFormView() {
  const bldgOptions = appConfig.buildings.map((b) => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join('');
  const catChips = appConfig.categories.map((c, i) => `<span class="chip ${i === 0 ? 'active' : ''}" data-val="${escapeHtml(c)}">${escapeHtml(c)}</span>`).join('');

  return `
    <div class="card">
      <div class="card-title">
        <span>📝 填写报修单</span>
        <span class="text-muted">免注册 · 实时进度可查</span>
      </div>

      <div class="grid-form">
        <div class="form-group">
          <label><span class="req">*</span>报修楼栋</label>
          <select id="f_bldg">${bldgOptions}</select>
        </div>
        <div class="form-group">
          <label><span class="req">*</span>楼层 / 房间号</label>
          <input type="text" id="f_room" placeholder="例如：305教室、412宿舍" autocomplete="off">
        </div>
      </div>

      <div class="form-group">
        <label><span class="req">*</span>故障类别</label>
        <div class="chips-group" id="f_cat_chips">${catChips}</div>
      </div>

      <div class="form-group">
        <label><span class="req">*</span>紧急程度</label>
        <div class="chips-group" id="f_urg_chips">
          <span class="chip active" data-val="普通">普通</span>
          <span class="chip warn" data-val="较急">较急</span>
          <span class="chip danger" data-val="紧急">紧急 (现场严重)</span>
        </div>
      </div>

      <div class="form-group">
        <label><span class="req">*</span>故障现象描述</label>
        <textarea id="f_desc" placeholder="请详细描述损坏情况、受损部位或具体现场问题..."></textarea>
      </div>

      <div class="form-group">
        <label>现场照片 (最多5张)</label>
        <div class="photos-grid" id="photosGrid">
          <label class="photo-upload-btn" id="uploadBtn">
            <span style="font-size: 24px; line-height: 1;">📷</span>
            <span>添加照片</span>
            <input type="file" id="photoFileInput" accept="image/*" style="display: none;">
          </label>
        </div>
      </div>

      <div class="grid-form">
        <div class="form-group">
          <label><span class="req">*</span>联系人姓名</label>
          <input type="text" id="f_reporter" placeholder="您的姓名">
        </div>
        <div class="form-group">
          <label><span class="req">*</span>联系手机号 (查单凭证)</label>
          <input type="tel" id="f_phone" maxlength="11" placeholder="11位手机号" value="${escapeHtml(myPhone)}">
        </div>
      </div>

      <div class="form-group">
        <label>您的身份</label>
        <div class="chips-group" id="f_who_chips">
          <span class="chip active" data-val="教职工">教职工</span>
          <span class="chip" data-val="职工">后勤职工</span>
          <span class="chip" data-val="学生">学生</span>
          <span class="chip" data-val="访客">访客/其他</span>
        </div>
      </div>

      <button class="btn" id="btnSubmitTicket" style="margin-top: 10px;">立即提交报修申请</button>
    </div>
  `;
}

function bindFormEvents() {
  // 单选 Chips 绑定
  ['f_cat_chips', 'f_urg_chips', 'f_who_chips'].forEach((boxId) => {
    const box = document.getElementById(boxId);
    if (box) {
      box.onclick = (e) => {
        const chip = e.target.closest('.chip');
        if (!chip) return;
        box.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
      };
    }
  });

  // 图片上传事件
  const fileInput = document.getElementById('photoFileInput');
  if (fileInput) {
    fileInput.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      toast('正在上传图片...');
      try {
        const res = await uploadImage(file);
        uploadedPhotos.push(res.url);
        renderPhotoGrid();
        toast('图片上传成功');
      } catch (err) {
        toast(`上传失败: ${err.message}`);
      }
    };
  }

  // 提交报修单
  const btnSubmit = document.getElementById('btnSubmitTicket');
  if (btnSubmit) {
    btnSubmit.onclick = async () => {
      const bldg = document.getElementById('f_bldg').value;
      const room = document.getElementById('f_room').value.trim();
      const desc = document.getElementById('f_desc').value.trim();
      const reporter = document.getElementById('f_reporter').value.trim();
      const phone = document.getElementById('f_phone').value.trim();
      const category = (document.querySelector('#f_cat_chips .chip.active') || {}).dataset?.val || '水电照明';
      const urgency = (document.querySelector('#f_urg_chips .chip.active') || {}).dataset?.val || '普通';
      const identity = (document.querySelector('#f_who_chips .chip.active') || {}).dataset?.val || '教职工';

      if (!room) { toast('请填写楼层/房间号'); return; }
      if (!desc) { toast('请详细填写故障描述'); return; }
      if (!reporter) { toast('请填写联系人姓名'); return; }
      if (!/^1\d{10}$/.test(phone)) { toast('请填写正确的11位手机号码'); return; }

      btnSubmit.disabled = true;
      btnSubmit.textContent = '正在提交...';

      try {
        const created = await request('/api/tickets', {
          method: 'POST',
          body: {
            building: bldg,
            room,
            category,
            urgency,
            desc,
            reporter,
            phone,
            identity,
            photos: uploadedPhotos,
          },
        });

        myPhone = phone;
        localStorage.setItem('bx_reporter_phone', phone);
        uploadedPhotos = [];

        toast(`🎉 报修提交成功！工单号：${created.id}`, () => {
          switchTab('mine');
        });
      } catch (err) {
        toast(err.message || '提交失败');
      } finally {
        btnSubmit.disabled = false;
        btnSubmit.textContent = '立即提交报修申请';
      }
    };
  }
}

function renderPhotoGrid() {
  const grid = document.getElementById('photosGrid');
  if (!grid) return;
  const items = uploadedPhotos.map((url, idx) => `
    <div class="photo-item">
      <img src="${escapeHtml(url)}" onclick="window.viewImage('${escapeHtml(url)}')">
      <span class="btn-remove" onclick="window.removePhoto(${idx})">×</span>
    </div>
  `).join('');

  const btn = uploadedPhotos.length < 5
    ? `<label class="photo-upload-btn" id="uploadBtn">
        <span style="font-size: 24px; line-height: 1;">📷</span>
        <span>添加照片</span>
        <input type="file" id="photoFileInput" accept="image/*" style="display: none;">
      </label>`
    : '';

  grid.innerHTML = items + btn;

  const fileInput = document.getElementById('photoFileInput');
  if (fileInput) {
    fileInput.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      toast('正在上传图片...');
      try {
        const res = await uploadImage(file);
        uploadedPhotos.push(res.url);
        renderPhotoGrid();
        toast('图片上传成功');
      } catch (err) {
        toast(`上传失败: ${err.message}`);
      }
    };
  }
}

window.removePhoto = (idx) => {
  uploadedPhotos.splice(idx, 1);
  renderPhotoGrid();
};

// ----------------- 我的报修查询页面 -----------------
function renderMineView() {
  return `
    <div class="card">
      <div class="card-title"><span>🔍 我的报修记录查询</span></div>
      <div style="display: flex; gap: 8px;">
        <input type="tel" id="inputQueryPhone" maxlength="11" placeholder="输入报修填写的11位手机号" value="${escapeHtml(myPhone)}">
        <button class="btn btn-sm" id="btnQuery" style="flex: none; width: 85px;">查 询</button>
      </div>
    </div>
    <div id="ticketsListContainer">
      <div class="card text-muted" style="text-align: center; padding: 36px 12px;">请输入手机号查询历史报修进度</div>
    </div>
  `;
}

function bindMineEvents() {
  const btnQuery = document.getElementById('btnQuery');
  if (btnQuery) {
    btnQuery.onclick = () => {
      const val = document.getElementById('inputQueryPhone').value.trim();
      if (!/^1\d{10}$/.test(val)) {
        toast('请填写正确的11位手机号');
        return;
      }
      myPhone = val;
      localStorage.setItem('bx_reporter_phone', val);
      loadMyTickets();
    };
  }
}

async function loadMyTickets() {
  const container = document.getElementById('ticketsListContainer');
  if (!container) return;
  container.innerHTML = `<div class="card text-muted" style="text-align: center; padding: 36px 12px;">正在加载报修记录...</div>`;

  try {
    const list = await request(`/api/tickets?phone=${encodeURIComponent(myPhone)}`);
    myTickets = list;
    if (!list || list.length === 0) {
      container.innerHTML = `<div class="card text-muted" style="text-align: center; padding: 36px 12px;">未查询到与手机号 ${escapeHtml(myPhone)} 关联的报修单</div>`;
      return;
    }

    container.innerHTML = list.map((t) => renderTicketCard(t)).join('');
  } catch (err) {
    container.innerHTML = `<div class="card text-muted" style="text-align: center; padding: 36px 12px; color: var(--danger);">查询失败: ${escapeHtml(err.message)}</div>`;
  }
}

function renderTicketCard(t) {
  const st = STATUS_MAP[t.status] || { label: t.status, cls: 'b-pending' };
  const timeoutBadge = t.isTimeout ? `<span class="badge b-timeout">⚠️ ${escapeHtml(t.timeoutReason)}</span>` : '';
  const remindBadge = t.remindCount > 0 ? `<span class="badge b-remind">🔔 催单(${t.remindCount})</span>` : '';

  const photosHtml = t.photos && t.photos.length > 0
    ? `<div class="photos-grid" style="margin-top: 8px;">${t.photos.map((p) => `<div class="photo-item" style="width: 58px; height: 58px;"><img src="${escapeHtml(p)}" onclick="window.viewImage('${escapeHtml(p)}')"></div>`).join('')}</div>`
    : '';

  let actionsHtml = `<button class="btn btn-sm btn-ghost" onclick="window.openDetail('${escapeHtml(t.id)}')">查看详情</button> `;
  if (t.status === 'pending' || t.status === 'assigned' || t.status === 'working') {
    actionsHtml += `<button class="btn btn-sm btn-warn" onclick="window.remindTicket('${escapeHtml(t.id)}')">加急催单</button> `;
  }
  if (t.status === 'done') {
    actionsHtml += `<button class="btn btn-sm btn-ok" onclick="window.openRate('${escapeHtml(t.id)}')">验收评价</button> `;
  }

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
        <span>紧急度：${escapeHtml(t.urgency)}</span> | 
        <span>提交时间：${formatShortTime(t.createdAt)}</span>
        ${t.assignee ? ` | <strong style="color: var(--brand);">师傅：${escapeHtml(t.assignee)}</strong>` : ''}
      </div>
      <div class="ticket-desc">${escapeHtml(t.desc)}</div>
      ${photosHtml}
      <div class="ticket-actions">${actionsHtml}</div>
    </div>
  `;
}

// ----------------- 工单详情弹窗 -----------------
window.openDetail = async (id) => {
  try {
    const t = await request(`/api/tickets/${id}`);
    const st = STATUS_MAP[t.status] || { label: t.status, cls: 'b-pending' };

    const timeoutAlert = t.isTimeout
      ? `<div style="background: var(--danger-light); color: var(--danger); padding: 8px 12px; border-radius: 8px; font-weight: 600; margin-bottom: 12px; font-size: 13px;">⏱️ SLA 超时预警：【${escapeHtml(t.timeoutReason)}】已触发加快督办！</div>`
      : '';

    const photosHtml = t.photos && t.photos.length > 0
      ? `<div style="margin-top: 10px;"><strong>现场照片：</strong><div class="photos-grid">${t.photos.map((p) => `<div class="photo-item"><img src="${escapeHtml(p)}" onclick="window.viewImage('${escapeHtml(p)}')"></div>`).join('')}</div></div>`
      : '';

    const finishHtml = t.result
      ? `<div style="background: var(--ok-light); border-radius: 8px; padding: 10px 12px; margin-top: 12px; font-size: 13.5px;">
          <strong style="color: var(--ok);">维修结果：</strong>${escapeHtml(t.result)}
          ${t.finishPhotos && t.finishPhotos.length > 0 ? `<div class="photos-grid" style="margin-top: 6px;">${t.finishPhotos.map((p) => `<div class="photo-item"><img src="${escapeHtml(p)}" onclick="window.viewImage('${escapeHtml(p)}')"></div>`).join('')}</div>` : ''}
        </div>`
      : '';

    const ratingHtml = t.rating
      ? `<div style="background: var(--warn-light); border-radius: 8px; padding: 10px 12px; margin-top: 12px; font-size: 13.5px;">
          <strong style="color: #b45309;">验收评分：</strong>${'⭐'.repeat(t.rating.score || 5)} (${t.rating.score}星)
          <div style="margin-top: 3px; color: #475569;">评价反馈：${escapeHtml(t.rating.comment || '满意')}</div>
        </div>`
      : '';

    const timelineHtml = `
      <div style="margin-top: 14px; font-size: 13px;">
        <strong>工单跟踪动态：</strong>
        <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 6px; border-left: 2px solid var(--border); padding-left: 10px; margin-left: 4px;">
          ${(t.timeline || []).map((tl) => `
            <div>
              <div style="font-weight: 600; color: #334155;">${escapeHtml(tl.action)} <span style="font-weight: normal; font-size: 11.5px; color: var(--text-muted);">(${escapeHtml(tl.by)} · ${formatShortTime(tl.t)})</span></div>
              ${tl.note ? `<div style="color: var(--text-muted); font-size: 12px;">${escapeHtml(tl.note)}</div>` : ''}
            </div>
          `).join('')}
        </div>
      </div>
    `;

    const commentsHtml = `
      <div style="background: #f8fafc; border-radius: 9px; padding: 10px; margin-top: 14px; border: 1px solid var(--border);">
        <div style="font-weight: 600; font-size: 13.5px; margin-bottom: 8px;">💬 现场留言与沟通 (${(t.comments || []).length})</div>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          ${(t.comments || []).length === 0 ? `<div class="text-muted" style="font-size: 12px;">暂无留言，您可输入文字与师傅/总务处沟通</div>` : (t.comments || []).map((c) => `
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
          <input type="text" id="dlgCommentInput" placeholder="留言沟通现场情况...">
          <button class="btn btn-sm" id="dlgSendCommentBtn" style="flex: none; width: 65px;">发送</button>
        </div>
      </div>
    `;

    openModal(`
      <div class="modal-header">
        <h3>工单详情 ${escapeHtml(t.id)}</h3>
        <button class="modal-close-btn" onclick="window.closeModal()">×</button>
      </div>
      ${timeoutAlert}
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
        <div><span class="badge ${st.cls}">${st.label}</span> <strong style="font-size: 16px; margin-left: 4px;">${escapeHtml(t.building)} ${escapeHtml(t.room)}</strong></div>
      </div>
      <div style="background: #f8fafc; border-radius: 9px; padding: 10px; font-size: 13.5px; line-height: 1.7;">
        <div><strong>报修类别：</strong>${escapeHtml(t.category)} | <strong>紧急程度：</strong>${escapeHtml(t.urgency)}</div>
        <div><strong>报修人：</strong>${escapeHtml(t.reporter)} (${escapeHtml(t.identity)}) 📱 ${escapeHtml(t.phone)}</div>
        <div><strong>报修时间：</strong>${formatTime(t.createdAt)}</div>
        ${t.assignee ? `<div><strong>维修师傅：</strong>${escapeHtml(t.assignee)}</div>` : ''}
        <div style="margin-top: 4px;"><strong>故障描述：</strong>${escapeHtml(t.desc)}</div>
        ${photosHtml}
      </div>
      ${finishHtml}
      ${ratingHtml}
      ${timelineHtml}
      ${commentsHtml}
    `);

    document.getElementById('dlgSendCommentBtn').onclick = async () => {
      const content = document.getElementById('dlgCommentInput').value.trim();
      if (!content) return;
      try {
        await request(`/api/tickets/${t.id}/comments`, {
          method: 'POST',
          body: {
            senderRole: 'reporter',
            senderName: t.reporter || '报修人',
            content,
          },
        });
        window.openDetail(t.id);
      } catch (e) {
        toast(e.message);
      }
    };
  } catch (err) {
    toast(`加载详情失败: ${err.message}`);
  }
};

window.remindTicket = async (id) => {
  const note = prompt('请输入催单原因（例如：影响现场自习、急需使用等）：', '急需使用，请尽快处理！');
  if (note === null) return;
  try {
    await request(`/api/tickets/${id}/remind`, {
      method: 'POST',
      body: { note },
    });
    toast('🔔 加急催单已通知总务处及师傅！');
    loadMyTickets();
  } catch (err) {
    toast(err.message);
  }
};

window.openRate = (id) => {
  let curScore = 5;
  openModal(`
    <div class="modal-header">
      <h3>报修完工验收评价</h3>
      <button class="modal-close-btn" onclick="window.closeModal()">×</button>
    </div>
    <div class="form-group">
      <label>服务评分 (1~5星)</label>
      <div class="chips-group" id="rateScoreGroup">
        <span class="chip active" data-s="5">⭐⭐⭐⭐⭐ 非常满意</span>
        <span class="chip" data-s="4">⭐⭐⭐⭐ 满意</span>
        <span class="chip" data-s="3">⭐⭐⭐ 一般</span>
        <span class="chip" data-s="2">⭐⭐ 不太满意</span>
        <span class="chip" data-s="1">⭐ 很差</span>
      </div>
    </div>
    <div class="form-group">
      <label>评价与建议反馈</label>
      <textarea id="rateCommentText" placeholder="师傅处理及时，技术好，现场收拾得很干净..."></textarea>
    </div>
    <button class="btn btn-ok" id="btnRateSubmit">提交评价并结单</button>
  `);

  document.getElementById('rateScoreGroup').onclick = (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    document.querySelectorAll('#rateScoreGroup .chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    curScore = parseInt(chip.dataset.s, 10) || 5;
  };

  document.getElementById('btnRateSubmit').onclick = async () => {
    const comment = document.getElementById('rateCommentText').value.trim();
    try {
      await request(`/api/tickets/${id}/rate`, {
        method: 'POST',
        body: { score: curScore, comment },
      });
      toast('🎉 感谢您的评价，工单已结单！');
      closeModal();
      loadMyTickets();
    } catch (err) {
      toast(err.message);
    }
  };
};

init();
