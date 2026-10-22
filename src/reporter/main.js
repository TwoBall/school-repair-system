/**
 * 师生在线报修专区 - 前端主逻辑
 * 升级：纯矢量 SVG 现代图标 + 渐变波浪骨架屏 + 科技指挥中心质感 + 常见故障一键模板 + 顺丰级时间轴
 */
import '../common/style.css';
import { Icons } from '../common/icons.js';
import { request, uploadImage, fetchConfig, STATUS_MAP } from '../common/api.js';
import { escapeHtml, formatTime, formatShortTime, toast, openModal, closeModal, viewImage, initTheme, copyText, renderTicketSkeleton } from '../common/utils.js';

let appConfig = {
  schoolName: '学校总务报修服务中心',
  buildings: ['教学楼A栋', '教学楼B栋', '教学楼C栋', '实验楼', '图书馆', '行政楼', '食堂', '体育馆', '学生公寓1栋', '学生公寓2栋'],
  categories: ['水电照明', '门窗家具', '空调风扇', '给排水/卫浴', '多媒体设备', '墙面地面', '电梯设施', '其他'],
};

// 常见故障智能快捷预设 (纯矢量 SVG 图标)
const PRESETS = [
  { icon: Icons.water(18, 'preset-icon'), title: '水龙头漏水', cat: '给排水/卫浴', urg: '普通', desc: '水龙头松动或关不紧，持续滴漏水，需要检修或更换阀芯。' },
  { icon: Icons.lightbulb(18, 'preset-icon'), title: '教室灯管不亮', cat: '水电照明', urg: '普通', desc: '室内日光灯闪烁或彻底不亮，疑似灯管损坏或镇流器故障。' },
  { icon: Icons.snowflake(18, 'preset-icon'), title: '空调不冷/漏水', cat: '空调风扇', urg: '较急', desc: '开机运行无冷风/制冷效果差，空调内机有滴水现象。' },
  { icon: Icons.monitor(18, 'preset-icon'), title: '多媒体投影黑屏', cat: '多媒体设备', urg: '较急', desc: '教学多媒体设备无法开机或投影仪无信号输入，急需排查。' },
  { icon: Icons.doorLock(18, 'preset-icon'), title: '门锁门窗损坏', cat: '门窗家具', urg: '普通', desc: '门锁锁舌卡滞损坏，无法正常锁门或合页脱落。' },
  { icon: Icons.toiletPipe(18, 'preset-icon'), title: '厕所下水堵塞', cat: '给排水/卫浴', urg: '紧急', desc: '下水道返水堵塞排污不畅，现场有异味，需紧急疏通排障。' },
];

let currentTab = 'form'; // 'form' | 'mine'
let myPhone = localStorage.getItem('bx_reporter_phone') || '';
let uploadedPhotos = [];
let myTickets = [];

// 初始化
async function init() {
  initTheme();
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
          <span style="color: var(--cyan);">${Icons.school(24)}</span>
          <div>
            <div class="title" id="portalSchoolName">学校总务报修系统</div>
          </div>
        </div>
        <div class="topbar-actions">
          <div class="portal-tag">师生报修专区</div>
          <button class="theme-toggle-btn" onclick="window.toggleTheme()" title="切换深浅主题"></button>
        </div>
      </div>
    </header>

    <main class="app-container" id="mainContainer"></main>

    <nav class="tabbar">
      <button class="tabbar-item active" id="tabFormBtn">
        <span class="icon">${Icons.edit(20)}</span>
        <span>在线报修</span>
      </button>
      <button class="tabbar-item" id="tabMineBtn">
        <span class="icon">${Icons.clipboard(20)}</span>
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

  const presetsHtml = PRESETS.map((p, idx) => `
    <div class="preset-tile" data-idx="${idx}">
      <span style="color: var(--cyan);">${p.icon}</span>
      <span>${escapeHtml(p.title)}</span>
    </div>
  `).join('');

  return `
    <div class="card">
      <div class="card-title">
        <span style="display: flex; align-items: center; gap: 6px;">
          ${Icons.edit(18, 'text-cyan')}
          <span>填写报修单</span>
        </span>
        <span class="text-muted">免注册 · 实时流转可查</span>
      </div>

      <!-- 快捷故障一键填单模板 -->
      <div class="presets-wrap">
        <div class="presets-label">
          ${Icons.bolt(15)}
          <span>常见故障一键模板（点击自动填单）：</span>
        </div>
        <div class="presets-grid" id="presetsGrid">${presetsHtml}</div>
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
        <textarea id="f_desc" placeholder="请详细描述损坏情况、受损部位或现场具体问题..."></textarea>
      </div>

      <div class="form-group">
        <label>现场照片 (最多5张)</label>
        <div class="photos-grid" id="photosGrid">
          <label class="photo-upload-btn" id="uploadBtn">
            <span>${Icons.camera(24)}</span>
            <span style="margin-top: 4px;">添加照片</span>
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

      <button class="btn" id="btnSubmitTicket" style="margin-top: 10px;">
        ${Icons.bolt(18)}
        <span>立即提交报修申请</span>
      </button>
    </div>
  `;
}

function bindFormEvents() {
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

  const presetsGrid = document.getElementById('presetsGrid');
  if (presetsGrid) {
    presetsGrid.onclick = (e) => {
      const tile = e.target.closest('.preset-tile');
      if (!tile) return;
      const idx = parseInt(tile.dataset.idx, 10);
      const p = PRESETS[idx];
      if (!p) return;

      const catChips = document.querySelectorAll('#f_cat_chips .chip');
      catChips.forEach((c) => {
        if (c.dataset.val === p.cat || c.innerText.trim() === p.cat) c.click();
      });

      const urgChips = document.querySelectorAll('#f_urg_chips .chip');
      urgChips.forEach((c) => {
        if (c.dataset.val === p.urg) c.click();
      });

      const descEl = document.getElementById('f_desc');
      if (descEl) {
        descEl.value = p.desc;
        descEl.focus();
      }

      toast(`已填入【${p.title}】模板，可修改地点后提交`);
    };
  }

  renderPhotoGrid();

  const btnSubmit = document.getElementById('btnSubmitTicket');
  if (btnSubmit) {
    btnSubmit.onclick = async () => {
      const bldg = document.getElementById('f_bldg').value;
      const room = document.getElementById('f_room').value.trim();
      const desc = document.getElementById('f_desc').value.trim();
      const reporter = document.getElementById('f_reporter').value.trim();
      const phone = document.getElementById('f_phone').value.trim();

      const catEl = document.querySelector('#f_cat_chips .chip.active');
      const urgEl = document.querySelector('#f_urg_chips .chip.active');
      const whoEl = document.querySelector('#f_who_chips .chip.active');

      const category = catEl ? catEl.dataset.val : '水电照明';
      const urgency = urgEl ? urgEl.dataset.val : '普通';
      const identity = whoEl ? whoEl.dataset.val : '教职工';

      if (!room) { toast('请填写具体的楼层/房间号'); return; }
      if (!desc) { toast('请填写故障现象描述'); return; }
      if (!reporter) { toast('请填写联系人姓名'); return; }
      if (!/^1\d{10}$/.test(phone)) { toast('请填写正确的11位手机号码'); return; }

      btnSubmit.disabled = true;
      btnSubmit.innerHTML = `<span>提交中...</span>`;

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

        toast(`报修提交成功！工单号：${created.id}`, () => {
          switchTab('mine');
        });
      } catch (err) {
        toast(err.message || '提交失败');
      } finally {
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = `${Icons.bolt(18)} <span>立即提交报修申请</span>`;
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
        <span>${Icons.camera(24)}</span>
        <span style="margin-top: 4px;">添加照片</span>
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

// ----------------- 我的报修查询页面 (带骨架屏动画) -----------------
function renderMineView() {
  return `
    <div class="card">
      <div class="card-title">
        <span style="display: flex; align-items: center; gap: 6px;">
          ${Icons.clipboard(18, 'text-cyan')}
          <span>我的报修记录查询</span>
        </span>
      </div>
      <div style="display: flex; gap: 8px;">
        <input type="tel" id="inputQueryPhone" maxlength="11" placeholder="输入报修填写的11位手机号" value="${escapeHtml(myPhone)}">
        <button class="btn btn-sm" id="btnQuery" style="flex: none; width: 90px;">查 询</button>
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

  // 渲染现代波浪骨架屏 (Skeleton Screen)
  container.innerHTML = renderTicketSkeleton(3);

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
  const timeoutBadge = t.isTimeout ? `<span class="badge b-timeout">${Icons.alertTriangle(12)} ${escapeHtml(t.timeoutReason)}</span>` : '';
  const remindBadge = t.remindCount > 0 ? `<span class="badge b-remind">${Icons.bell(12)} 催单(${t.remindCount})</span>` : '';

  const photosHtml = t.photos && t.photos.length > 0
    ? `<div class="photos-grid" style="margin-top: 8px;">${t.photos.map((p) => `<div class="photo-item" style="width: 58px; height: 58px;"><img src="${escapeHtml(p)}" onclick="window.viewImage('${escapeHtml(p)}')"></div>`).join('')}</div>`
    : '';

  let actionsHtml = `<button class="btn btn-sm btn-ghost" onclick="window.openDetail('${escapeHtml(t.id)}')">查看详情与轨迹</button> `;
  if (t.status === 'pending' || t.status === 'assigned' || t.status === 'working') {
    actionsHtml += `<button class="btn btn-sm btn-warn" onclick="window.remindTicket('${escapeHtml(t.id)}')">${Icons.bell(13)} 加急催单</button> `;
  }
  if (t.status === 'done') {
    actionsHtml += `<button class="btn btn-sm btn-ok" onclick="window.openRate('${escapeHtml(t.id)}')">${Icons.check(13)} 验收评价</button> `;
  }

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

// ----------------- 顺丰/京东快递级沉浸式流转时间轴 (矢量 SVG 节点) -----------------
export function renderStepperTimeline(t) {
  const s = t.status;
  const isRejected = s === 'rejected';

  const step1Done = true;
  const step2Done = ['assigned', 'working', 'done', 'closed'].includes(s);
  const step2Cur = s === 'pending';
  const step3Done = ['working', 'done', 'closed'].includes(s);
  const step3Cur = s === 'assigned';
  const step4Done = ['closed'].includes(s);
  const step4Cur = s === 'done';
  const step5Done = s === 'closed';

  const checkSvg = Icons.check(13);

  return `
    <div class="stepper-wrap">
      <div style="font-weight: 700; font-size: 14px; margin-bottom: 10px; color: var(--cyan); display: flex; align-items: center; gap: 6px;">
        ${Icons.layers(16)}
        <span>报修流转轨迹（顺丰级全程可溯）</span>
      </div>
      <div class="stepper-track">
        <!-- 节点 1: 提交报修 -->
        <div class="stepper-item ${step1Done ? 'done' : ''}">
          <div class="stepper-node">${checkSvg}</div>
          <div class="stepper-header">
            <span class="stepper-title">工单已提交</span>
            <span class="stepper-time">${formatShortTime(t.createdAt)}</span>
          </div>
          <div class="stepper-desc">报修人 <strong>${escapeHtml(t.reporter)}</strong> (${escapeHtml(t.identity || '师生')}) 发起申请</div>
        </div>

        <!-- 节点 2: 总务处受理与派工 -->
        <div class="stepper-item ${step2Done ? 'done' : (step2Cur ? 'current' : '')}">
          <div class="stepper-node">${step2Done ? checkSvg : '2'}</div>
          <div class="stepper-header">
            <span class="stepper-title">${isRejected ? '工单已驳回' : (t.assignee ? '总务处已派工' : '总务处受理中')}</span>
            <span class="stepper-time">${step2Done ? formatShortTime(t.createdAt) : ''}</span>
          </div>
          <div class="stepper-desc">
            ${isRejected
              ? `<span style="color: var(--danger);">理由：${escapeHtml(t.timeline?.slice(-1)[0]?.note || '未符合报修要求')}</span>`
              : (t.assignee ? `已指派专职师傅：<strong style="color: var(--brand);">${escapeHtml(t.assignee)}</strong>` : '总务处值班老师正在审核并派发至责任维修班组...')}
          </div>
        </div>

        <!-- 节点 3: 师傅接单施工 -->
        <div class="stepper-item ${step3Done ? 'done' : (step3Cur ? 'current' : '')}">
          <div class="stepper-node">${step3Done ? checkSvg : '3'}</div>
          <div class="stepper-header">
            <span class="stepper-title">${s === 'working' ? '师傅施工排查中' : (step3Done ? '已到场施工' : '师傅待接单')}</span>
            <span class="stepper-time"></span>
          </div>
          <div class="stepper-desc">
            ${s === 'working'
              ? `<span style="color: #a855f7;">师傅已确认接单，正在现场检修配件及处理...</span>`
              : (s === 'assigned' ? '工单已推送到责任师傅手机工作台，等待接单出发' : (step3Done ? '现场维修处置完毕' : '待师傅接单前往现场'))}
          </div>
        </div>

        <!-- 节点 4: 完工待验收 -->
        <div class="stepper-item ${step4Done ? 'done' : (step4Cur ? 'current' : '')}">
          <div class="stepper-node">${step4Done ? checkSvg : '4'}</div>
          <div class="stepper-header">
            <span class="stepper-title">${t.result ? '维修已完工' : '待完工'}</span>
            <span class="stepper-time">${t.completedAt ? formatShortTime(t.completedAt) : ''}</span>
          </div>
          <div class="stepper-desc">
            ${t.result ? `维修结论：<strong>${escapeHtml(t.result)}</strong>` : '待维修师傅上传现场修复完好照片并提交完工'}
          </div>
        </div>

        <!-- 节点 5: 验收评价结单 -->
        <div class="stepper-item ${step5Done ? 'done' : ''}">
          <div class="stepper-node">${step5Done ? checkSvg : '5'}</div>
          <div class="stepper-header">
            <span class="stepper-title">${t.rating ? '已验收结单' : '待验收评价'}</span>
            <span class="stepper-time">${t.closedAt ? formatShortTime(t.closedAt) : ''}</span>
          </div>
          <div class="stepper-desc">
            ${t.rating ? `师生综合评价：${Icons.star(14, '', '#f59e0b').repeat(t.rating.score || 5)} (${escapeHtml(t.rating.comment || '满意')})` : '师傅修好后，师生核验通过并打分结单'}
          </div>
        </div>
      </div>
    </div>
  `;
}

// ----------------- 工单详情弹窗 -----------------
window.openDetail = async (id) => {
  try {
    const t = await request(`/api/tickets/${id}`);
    const st = STATUS_MAP[t.status] || { label: t.status, cls: 'b-pending' };

    const timeoutAlert = t.isTimeout
      ? `<div style="background: var(--danger-light); color: var(--danger); border: 1px solid var(--danger); padding: 10px 14px; border-radius: 8px; font-weight: 700; margin-bottom: 12px; font-size: 13.5px; display: flex; align-items: center; gap: 8px;">
          <span class="pulse-dot danger"></span>
          <span>${Icons.alertTriangle(16)} SLA 超时预警：【${escapeHtml(t.timeoutReason)}】已触发加快督办！</span>
        </div>`
      : '';

    const photosHtml = t.photos && t.photos.length > 0
      ? `<div style="margin-top: 10px;"><strong>现场照片：</strong><div class="photos-grid">${t.photos.map((p) => `<div class="photo-item"><img src="${escapeHtml(p)}" onclick="window.viewImage('${escapeHtml(p)}')"></div>`).join('')}</div></div>`
      : '';

    const finishHtml = t.result
      ? `<div style="background: var(--ok-light); border: 1px solid var(--ok); border-radius: 9px; padding: 12px 14px; margin-top: 12px; font-size: 13.5px;">
          <div style="font-weight: 700; color: var(--ok); margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
            ${Icons.check(16)}
            <span>维修处理结论：</span>
          </div>
          <div>${escapeHtml(t.result)}</div>
          ${t.finishPhotos && t.finishPhotos.length > 0 ? `<div class="photos-grid" style="margin-top: 8px;">${t.finishPhotos.map((p) => `<div class="photo-item"><img src="${escapeHtml(p)}" onclick="window.viewImage('${escapeHtml(p)}')"></div>`).join('')}</div>` : ''}
        </div>`
      : '';

    const ratingHtml = t.rating
      ? `<div style="background: var(--warn-light); border: 1px solid var(--warn); border-radius: 9px; padding: 12px 14px; margin-top: 12px; font-size: 13.5px;">
          <div style="font-weight: 700; color: var(--warn); margin-bottom: 4px; display: flex; align-items: center; gap: 4px;">
            ${Icons.star(16, '', '#f59e0b')}
            <span>验收评价与评分：</span>
          </div>
          <div style="display: flex; gap: 3px; margin: 4px 0;">${Icons.star(16, '', '#f59e0b').repeat(t.rating.score || 5)} (${t.rating.score}星)</div>
          <div style="color: var(--text-muted);">反馈内容：${escapeHtml(t.rating.comment || '服务满意，已修好')}</div>
        </div>`
      : '';

    const stepperHtml = renderStepperTimeline(t);

    const commentsHtml = `
      <div style="background: var(--card-alt); border-radius: 9px; padding: 12px; margin-top: 14px; border: 1px solid var(--border);">
        <div style="font-weight: 700; font-size: 13.5px; margin-bottom: 8px; color: var(--text); display: flex; align-items: center; gap: 6px;">
          ${Icons.messageSquare(16, 'text-cyan')}
          <span>现场三方留言沟通板 (${(t.comments || []).length})</span>
        </div>
        <div style="display: flex; flex-direction: column; gap: 8px; max-height: 200px; overflow-y: auto;">
          ${(t.comments || []).length === 0 ? `<div class="text-muted" style="font-size: 12px;">暂无留言，您可输入文字与师傅/总务处留言互动</div>` : (t.comments || []).map((c) => `
            <div style="border-bottom: 1px dashed var(--border); padding-bottom: 6px;">
              <div style="display: flex; justify-content: space-between; font-size: 11.5px; color: var(--text-muted);">
                <span><strong>${escapeHtml(c.senderName)}</strong> (${escapeHtml(c.senderRole === 'admin' ? '总务处' : c.senderRole === 'worker' ? '维修师傅' : '报修人')})</span>
                <span>${formatShortTime(c.createdAt)}</span>
              </div>
              <div style="font-size: 13px; color: var(--text); margin-top: 3px;">${escapeHtml(c.content)}</div>
            </div>
          `).join('')}
        </div>
        <div style="display: flex; gap: 6px; margin-top: 10px;">
          <input type="text" id="dlgCommentInput" placeholder="留言沟通上门时间或配件问题...">
          <button class="btn btn-sm" id="dlgSendCommentBtn" style="flex: none; width: 70px;">发送</button>
        </div>
      </div>
    `;

    openModal(`
      <div class="modal-header">
        <h3>工单详情 #${escapeHtml(t.id)}</h3>
        <button class="modal-close-btn" onclick="window.closeModal()">×</button>
      </div>
      ${timeoutAlert}
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <div>
          <span class="badge ${st.cls}">${st.label}</span>
          <strong style="font-size: 16.5px; margin-left: 6px;">${escapeHtml(t.building)} ${escapeHtml(t.room)}</strong>
        </div>
      </div>
      <div style="background: var(--card-alt); border: 1px solid var(--border); border-radius: 9px; padding: 12px; font-size: 13.5px; line-height: 1.8;">
        <div><strong>报修类别：</strong>${escapeHtml(t.category)} | <strong>紧急程度：</strong>${escapeHtml(t.urgency)}</div>
        <div><strong>报修人员：</strong>${escapeHtml(t.reporter)} (${escapeHtml(t.identity)}) · ${Icons.phone(12)} ${escapeHtml(t.phone)}</div>
        <div><strong>报修时间：</strong>${formatTime(t.createdAt)}</div>
        ${t.assignee ? `<div><strong>责任师傅：</strong><span style="color: var(--brand); font-weight: 700;">${escapeHtml(t.assignee)}</span></div>` : ''}
        <div style="margin-top: 6px; border-top: 1px dashed var(--border); padding-top: 6px;">
          <strong>故障现象：</strong>${escapeHtml(t.desc)}
        </div>
        ${photosHtml}
      </div>
      ${finishHtml}
      ${ratingHtml}
      ${stepperHtml}
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
  const note = prompt('请输入催单原因（例如：影响现场教学自习、急需使用等）：', '急需使用，请尽快处理！');
  if (note === null) return;
  try {
    await request(`/api/tickets/${id}/remind`, {
      method: 'POST',
      body: { note },
    });
    toast('加急催单已通知总务处及师傅！');
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
        <span class="chip active" data-s="5">5星 非常满意</span>
        <span class="chip" data-s="4">4星 满意</span>
        <span class="chip" data-s="3">3星 一般</span>
        <span class="chip" data-s="2">2星 不太满意</span>
        <span class="chip" data-s="1">1星 很差</span>
      </div>
    </div>
    <div class="form-group">
      <label>评价与建议反馈</label>
      <textarea id="rateCommentText" placeholder="师傅处理及时，技术好，现场收拾得很干净..."></textarea>
    </div>
    <button class="btn btn-ok" id="btnRateSubmit">${Icons.bolt(16)} 提交评价并结单</button>
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
      toast('感谢您的评价，工单已正式结单！');
      closeModal();
      loadMyTickets();
    } catch (err) {
      toast(err.message);
    }
  };
};

init();
