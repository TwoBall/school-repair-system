/**
 * 师生在线报修专区 - 前端主逻辑
 * UI 层：design system (style.css) + 内联 SVG 图标 (icons.js)
 */
import '../common/style.css';
import { request, fetchConfig, STATUS_MAP } from '../common/api.js';
import { escapeHtml, formatTime, formatShortTime, toast, openModal, closeModal, viewImage, confirmDialog, promptDialog, uploadPhoto, runAction, uploadingTile, updateUploadTile, delegateActions, createPoller, relTimeFrom, bindChipRadioGroup, setChipGroupValue } from '../common/utils.js';
import { icon, categoryIcon, stars, themeToggleBtn, bindThemeToggle } from '../common/icons.js';
import { REPAIR_TEMPLATES, QUICK_TEMPLATE_COUNT } from '../common/templates.js';

let appConfig = {
  schoolName: '学校总务报修服务中心',
  buildings: [
    'A1 教学楼', 'A2 教学楼', 'A3 教学楼', 'A4 教学楼',
    'B1 实训楼', 'B2 实训楼',
    'C1 学生宿舍', 'C2 学生宿舍', 'C3 学生宿舍', 'C4 学生宿舍',
    'C5 学生宿舍', 'C6 学生宿舍', 'C7 教师宿舍',
  ],
  categories: ['水电照明', '门窗家具', '空调风扇', '给排水/卫浴', '多媒体设备', '墙面地面', '电梯设施', '其他'],
};

let currentTab = 'form'; // 'form' | 'mine'
// 当前生效的一键填入模板，用于「再点一次取消」；null 表示没有用模板
let activeTemplate = null;
let myPhone = localStorage.getItem('bx_reporter_phone') || '';
let uploadedPhotos = [];
let myTickets = [];
// #11 轮询自动刷新：上次快照的状态表（用于识别进度变更）
const lastStatusMap = new Map();
let myPoller = null;
let myLabelTimer = null;
let lastMineRefresh = 0;

// 初始化
async function init() {
  renderLayout();
  try {
    const cfg = await fetchConfig();
    appConfig = { ...appConfig, ...cfg };
    const el = document.getElementById('portalSchoolName');
    if (el) el.textContent = appConfig.schoolName || '学校总务报修系统';
  } catch (e) {
    console.warn('加载系统配置失败，使用默认配置:', e);
  }

  // 读取 URL 参数以支持二维码带入地点
  const urlParams = new URLSearchParams(window.location.search);
  const qBldg = urlParams.get('bldg');
  const qRoom = urlParams.get('room');

  switchTab(currentTab);

  applyQrPlace(qBldg, qRoom);
}

/**
 * 二维码带入地点。
 * 只带入「楼栋 + 房间」两项，不碰故障信息——卡片副标题必须和这个行为一致。
 * 房间走「追加到 chips」而不是覆盖输入框：扫码后再手动补几间不会把扫码结果冲掉。
 * 楼栋不在当前字典里时不静默失败：明确提示手动选择。
 */
function applyQrPlace(bldg, room) {
  if (!bldg && !room) return;

  const sel = document.getElementById('f_bldg');
  const roomEl = document.getElementById('f_room');
  const known = Boolean(sel) && Array.from(sel.options).some((o) => o.value === bldg);

  if (sel && known) sel.value = bldg;
  if (room) {
    const { rooms } = parseRooms(room);
    if (rooms.length) {
      mergeRooms(rooms);
      paintRoomChips();
      if (roomEl) roomEl.value = '';
      scheduleDraftSave();
    } else if (roomEl) {
      // 解析不出来（比如整段文字超长）时退回填进输入框，让用户自己改
      roomEl.value = room;
      syncRoomAddBtn();
    }
  }

  const host = document.getElementById('qrHintHost');
  if (!host) return;
  const place = [bldg, room].filter(Boolean).map(escapeHtml).join(' · ');

  host.innerHTML = known
    ? `<div class="alert alert-ok mb-12">${icon('mapPin', 16)}<div>已按扫码位置带入：<strong>${place}</strong>，可再修改。</div></div>`
    : `<div class="alert alert-warn mb-12">${icon('alert', 16)}<div><strong>扫码楼栋「${escapeHtml(bldg)}」不在当前可选楼栋中</strong>，请手动选择；${room ? `房间已带入「${escapeHtml(room)}」。` : ''}</div></div>`;
}

// ----------------- 骨架布局 -----------------
function renderLayout() {
  document.getElementById('app').innerHTML = `
    <header class="topbar">
      <div class="nav-wrap">
        <div class="brand">
          <span class="logo-mark">${icon('school', 19)}</span>
          <div class="titles">
            <div class="title" id="portalSchoolName">学校总务报修系统</div>
            <div class="subtitle">师生报修服务专区</div>
          </div>
        </div>
        <div class="topbar-actions">
          <span class="portal-tag hide-sm">${icon('checkCircle', 13)}免注册报修</span>
          ${themeToggleBtn()}
        </div>
      </div>
    </header>

    <main class="app-container" id="mainContainer"></main>

    <nav class="tabbar" aria-label="主导航">
      <button class="tabbar-item active" id="tabFormBtn" type="button">
        ${icon('edit', 21)}
        <span>在线报修</span>
      </button>
      <button class="tabbar-item" id="tabMineBtn" type="button">
        ${icon('clipboard', 21)}
        <span>我的报修</span>
      </button>
    </nav>
  `;

  document.getElementById('tabFormBtn').onclick = () => switchTab('form');
  document.getElementById('tabMineBtn').onclick = () => switchTab('mine');
  bindThemeToggle();
}

function switchTab(tab) {
  currentTab = tab;
  const formBtn = document.getElementById('tabFormBtn');
  const mineBtn = document.getElementById('tabMineBtn');
  if (formBtn) formBtn.classList.toggle('active', tab === 'form');
  if (mineBtn) mineBtn.classList.toggle('active', tab === 'mine');

  const container = document.getElementById('mainContainer');
  if (tab === 'form') {
    container.innerHTML = renderFormView();
    // 先回填草稿（可能重绘照片区），再绑事件，避免把已绑定的 file input 冲掉
    setupDraft();
    bindFormEvents();
  } else {
    container.innerHTML = renderMineView();
    bindMineEvents();
    if (myPhone) loadMyTickets();
  }
}

// ----------------- 报修表单页面 -----------------
function renderFormView() {
  const bldgOptions = appConfig.buildings
    .map((b) => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`)
    .join('');
  const catChips = appConfig.categories
    .map((c, i) => `<span class="chip ${i === 0 ? 'active' : ''}" data-val="${escapeHtml(c)}">${categoryIcon(c, 15)}${escapeHtml(c)}</span>`)
    .join('');

  return `
    <form id="repairForm" novalidate>
      <div id="draftBarHost"></div>
      <section class="card">
        <div class="card-head">
          <div class="card-title"><span class="step-index">1</span>报修位置</div>
          <span class="card-sub">扫码自动带入楼栋与房间</span>
        </div>
        <div id="qrHintHost"></div>
        <div class="grid-form">
          <div class="field">
            <label class="label" for="f_bldg"><span class="req">*</span>报修楼栋</label>
            <div class="select-wrap">
              <select class="control" id="f_bldg">${bldgOptions}</select>
            </div>
          </div>
          <div class="field">
            <label class="label" for="f_room"><span class="req">*</span>楼层 / 房间号<span class="opt">可一次报多间</span></label>
            <div class="room-input-row">
              <input class="control" type="text" id="f_room" placeholder="例如：305教室，或 305、306、307" autocomplete="off">
              <button class="btn btn-outline shrink-0" type="button" id="btnRoomAdd" hidden>加入</button>
            </div>
            <div class="room-chips" id="f_room_chips" role="group" aria-label="已加入的房间"></div>
            <div class="room-hint" id="f_room_hint"></div>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card-head">
          <div class="card-title"><span class="step-index">2</span>故障信息</div>
        </div>
        <div class="field">
          <span class="label" id="f_tpl_label">常见故障一键填入<span class="opt">点一下自动填好类别与描述，可再修改</span></span>
          <div class="tpl-panel">
            <div class="tpl-grid" id="f_tpl_chips" role="group" aria-labelledby="f_tpl_label">
              ${REPAIR_TEMPLATES.slice(0, QUICK_TEMPLATE_COUNT)
                .map((t) => `
                  <button class="tpl-card" type="button" data-act="use-tpl" data-val="${escapeHtml(t.name)}" aria-pressed="false">
                    <span class="tpl-card-top">
                      ${icon('zap', 15)}
                      <span class="tpl-card-name">${escapeHtml(t.name)}</span>
                      <span class="tpl-chk" aria-hidden="true">${icon('check', 15)}</span>
                    </span>
                    <span class="tpl-card-meta">
                      <span class="tpl-meta-idle">${escapeHtml(t.cat)} · 历史 ${t.hits} 次</span>
                      <span class="tpl-meta-on">已填入 · 再点一次取消</span>
                    </span>
                  </button>`)
                .join('')}
            </div>
            <button class="tpl-all" type="button" data-act="more-tpl">
              ${icon('clipboard', 15)}查看全部 ${REPAIR_TEMPLATES.length} 条常见故障${icon('chevronRight', 15)}
            </button>
          </div>
        </div>
        <div class="field">
          <span class="label" id="f_cat_label"><span class="req">*</span>故障类别</span>
          <div class="chips-group" id="f_cat_chips" aria-labelledby="f_cat_label">${catChips}</div>
        </div>
        <div class="field">
          <span class="label" id="f_urg_label"><span class="req">*</span>紧急程度</span>
          <div class="chips-group" id="f_urg_chips" aria-labelledby="f_urg_label">
            <span class="chip active" data-val="普通">${icon('clock', 15)}普通</span>
            <span class="chip warn" data-val="较急">${icon('alert', 15)}较急</span>
            <span class="chip danger" data-val="紧急">${icon('zap', 15)}紧急（现场严重）</span>
          </div>
        </div>
        <div class="field">
          <label class="label" for="f_desc"><span class="req">*</span>故障现象描述</label>
          <textarea class="control" id="f_desc" placeholder="请详细描述损坏情况、受损部位或具体现场问题，便于维修师傅提前备料"></textarea>
        </div>
        <div class="field">
          <span class="label" id="f_photo_label">现场照片<span class="opt">选填，最多 3 张</span></span>
          <div class="photos-grid" id="photosGrid" role="group" aria-labelledby="f_photo_label">
            ${photoUploadBtn()}
          </div>
          <div class="hint">${icon('info', 13)}清晰的现场照片可显著缩短维修排期</div>
        </div>
      </section>

      <section class="card">
        <div class="card-head">
          <div class="card-title"><span class="step-index">3</span>联系方式</div>
          <span class="card-sub">仅用于进度通知</span>
        </div>
        <div class="grid-form">
          <div class="field">
            <label class="label" for="f_reporter"><span class="req">*</span>联系人姓名</label>
            <input class="control" type="text" id="f_reporter" placeholder="您的姓名" autocomplete="name">
          </div>
          <div class="field">
            <label class="label" for="f_phone"><span class="req">*</span>联系手机号<span class="opt">查单凭证</span></label>
            <input class="control" type="tel" id="f_phone" maxlength="11" inputmode="numeric" placeholder="11 位手机号" value="${escapeHtml(myPhone)}" autocomplete="tel">
          </div>
        </div>
        <div class="field">
          <span class="label" id="f_who_label">您的身份</span>
          <div class="chips-group" id="f_who_chips" aria-labelledby="f_who_label">
            <span class="chip active" data-val="教职工">${icon('check', 14, 'chk')}教职工</span>
            <span class="chip" data-val="职工">${icon('check', 14, 'chk')}后勤职工</span>
            <span class="chip" data-val="学生">${icon('check', 14, 'chk')}学生</span>
            <span class="chip" data-val="访客">${icon('check', 14, 'chk')}访客 / 其他</span>
          </div>
        </div>
        <div id="dupBarHost"></div>
        <button class="btn btn-primary btn-block btn-lg mt-16" id="btnSubmitTicket" type="button">
          ${icon('send', 17)}提交报修申请
        </button>
        <p class="hint center">${icon('checkCircle', 13)}提交后可在「我的报修」实时查看处理进度</p>
      </section>
    </form>
  `;
}

function photoUploadBtn() {
  return `<label class="photo-upload-btn" id="uploadBtn">
    ${icon('camera', 22)}
    <span>添加照片</span>
    <input type="file" id="photoFileInput" accept="image/*" capture="environment" aria-label="添加报修现场照片" class="d-none">
  </label>`;
}

// ----------------- 表单草稿 -----------------
const DRAFT_KEY = 'bx_reporter_draft';
const DRAFT_TTL = 7 * 24 * 60 * 60 * 1000;
let draftTimer = null;

function readDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || typeof d !== 'object' || !d.ts) return null;
    if (Date.now() - d.ts > DRAFT_TTL) {
      localStorage.removeItem(DRAFT_KEY);
      return null;
    }
    return d;
  } catch {
    return null;
  }
}

function draftHasContent(d) {
  const rooms = Array.isArray(d.rooms) ? d.rooms : (d.room ? [d.room] : []);
  return Boolean(rooms.length || d.desc || d.reporter || d.phone || (d.photos && d.photos.length));
}

function clearFormDraft() {
  localStorage.removeItem(DRAFT_KEY);
  paintDraftBar(null);
}

function collectFormDraft() {
  const activeChip = (boxId, fallback) => {
    const el = document.querySelector(`#${boxId} .chip.active`);
    return el ? el.dataset.val : fallback;
  };
  const val = (id) => document.getElementById(id)?.value || '';
  return {
    ts: Date.now(),
    bldg: val('f_bldg'),
    rooms: [...roomList], // 已加入 chips 的房间
    room: val('f_room'), // 输入框里还没加入的内容，一并存下来
    desc: val('f_desc'),
    reporter: val('f_reporter'),
    phone: val('f_phone'),
    category: activeChip('f_cat_chips', ''),
    urgency: activeChip('f_urg_chips', '普通'),
    identity: activeChip('f_who_chips', '教职工'),
    photos: [...uploadedPhotos],
  };
}

function scheduleDraftSave() {
  if (draftTimer) clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    const d = collectFormDraft();
    if (!draftHasContent(d)) {
      localStorage.removeItem(DRAFT_KEY);
      paintDraftBar(null);
      return;
    }
    localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    paintDraftBar('saved');
  }, 600);
}

// 离开页面时把待写入的草稿立即落盘，避免最后 600ms 的输入丢失
window.addEventListener('pagehide', () => {
  if (!draftTimer) return;
  clearTimeout(draftTimer);
  const d = collectFormDraft();
  if (draftHasContent(d)) localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
});

/** 重置表单（清空草稿时用） */
function resetRepairForm() {
  ['f_room', 'f_desc', 'f_reporter'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  roomList = [];
  paintRoomChips();
  syncRoomAddBtn();
  uploadedPhotos = [];
  renderPhotoGrid();
  Object.keys(FIELD_RULES).forEach(clearFieldError);
  touched.clear();
  dupHits = [];
  dupDismissed = false;
  paintDupBar();
  clearTemplateSelection();
}

/** 只清除模板选中态（不动表单内容） */
function clearTemplateSelection() {
  activeTemplate = null;
  document.querySelectorAll('.tpl-card, .tpl-chip').forEach((c) => {
    c.classList.remove('active');
    if (c.classList.contains('tpl-card')) c.setAttribute('aria-pressed', 'false');
  });
}

/**
 * 取消一键填入：撤销模板带来的三项内容。
 * 原则是「只撤销用户没动过的」——
 * 描述若已被改就保留，类别/紧急度若已被手动改过也不动。
 */
function cancelTemplate() {
  const prev = activeTemplate;
  if (!prev) return;

  const descEl = document.getElementById('f_desc');
  if (descEl && descEl.value.trim() === prev.desc) {
    descEl.value = '';
    touched.delete('f_desc');
    clearFieldError('f_desc');
  }

  const catBox = document.getElementById('f_cat_chips');
  if (catBox && catBox.querySelector('.chip.active')?.dataset.val === prev.cat) {
    setChipGroupValue(catBox, appConfig.categories[0]);
  }

  const urgBox = document.getElementById('f_urg_chips');
  if (urgBox && urgBox.querySelector('.chip.active')?.dataset.val === prev.urgency) {
    setChipGroupValue(urgBox, '普通');
  }

  clearTemplateSelection();
  scheduleDraftSave();
  toast(`已取消填入「${prev.name}」`);
}

/** 把草稿回填到表单 */
function restoreFormDraft(d) {
  const setVal = (id, v) => {
    if (!v) return;
    const el = document.getElementById(id);
    if (el) el.value = v;
  };
  setVal('f_bldg', d.bldg);
  // 草稿兼容：新格式存 rooms 数组；旧草稿只有 room 字符串，按分隔符拆一遍再回填
  const draftRooms = Array.isArray(d.rooms) ? [...d.rooms] : parseRooms(d.room || '').rooms;
  roomList = [];
  mergeRooms(draftRooms);
  paintRoomChips();
  setVal('f_room', typeof d.room === 'string' ? d.room : '');
  syncRoomAddBtn();
  setVal('f_desc', d.desc);
  setVal('f_reporter', d.reporter);
  setVal('f_phone', d.phone);

  const pickChip = (boxId, want) => {
    if (!want) return;
    const box = document.getElementById(boxId);
    if (!box) return;
    let hit = null;
    box.querySelectorAll('.chip').forEach((c) => {
      const on = c.dataset.val === want;
      c.classList.toggle('active', on);
      if (on) hit = true;
    });
    return hit;
  };
  pickChip('f_cat_chips', d.category);
  pickChip('f_urg_chips', d.urgency);
  pickChip('f_who_chips', d.identity);

  if (Array.isArray(d.photos) && d.photos.length) {
    uploadedPhotos = d.photos.slice(0, 5);
    renderPhotoGrid();
  }
}

/** 草稿状态栏：state 为 null 隐藏、'saved' 已保存、{ts} 已恢复 */
function paintDraftBar(state) {
  const host = document.getElementById('draftBarHost');
  if (!host) return;
  if (!state) {
    host.innerHTML = '';
    return;
  }
  if (state === 'saved') {
    const now = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    host.innerHTML = `
      <div class="hint mb-12 row between gap-8">
        <span class="row gap-4">${icon('checkCircle', 13)}草稿已自动保存 · ${escapeHtml(now)}</span>
        <button class="poll-refresh" type="button" id="btnClearDraft">清空草稿</button>
      </div>`;
  } else {
    host.innerHTML = `
      <div class="alert alert-warn mb-12">
        ${icon('info', 16)}
        <div class="grow">已为你恢复上次未提交的报修草稿（${escapeHtml(formatShortTime(state.ts))}）</div>
        <button class="btn btn-sm btn-outline shrink-0" type="button" id="btnClearDraft">清空草稿</button>
      </div>`;
  }
  const btn = document.getElementById('btnClearDraft');
  if (btn) {
    btn.onclick = () => {
      clearFormDraft();
      resetRepairForm();
      toast('草稿已清空');
    };
  }
}

// ----------------- 多房间录入 -----------------
// 一条工单只能承载一个房间（派工/打印/CSV/完工逐间流转都依赖单值 room），
// 所以多房间由前端拆成「每间一条工单」，再用同一个 batchToken 串成一批。
const MAX_ROOMS = 20; // 一个班主任一次最多报 20 间，超过容易是误粘贴整列数据
let roomList = []; // 已录入的房间（保留用户原始写法，判重时再归一化）

/** 把一段文字拆成房间数组：支持 、 , ， ; / 空格 换行。不做区间展开，305-310 原样保留并提示 */
function parseRooms(raw) {
  const text = String(raw || '').replace(/[、,，;；\/\n\r\t|]+/g, ' ');
  const seen = new Set();
  const rooms = [];
  let invalid = 0;
  text.split(/\s+/).forEach((piece) => {
    const s = piece.trim();
    if (!s) return;
    // 单间最长 20 字符，超长基本是整段描述被误粘贴进来
    if (s.length > 20) { invalid += 1; return; }
    const key = normRoom(s);
    if (!key || seen.has(key)) return;
    seen.add(key);
    rooms.push(s);
  });
  return { rooms, invalid };
}

/** 合并新解析出的房间；返回 { added, dup, overflow } */
function mergeRooms(list) {
  const seen = new Set(roomList.map((r) => normRoom(r)));
  let added = 0;
  let dup = 0;
  let overflow = 0;
  list.forEach((r) => {
    const key = normRoom(r);
    if (!key) return;
    if (seen.has(key)) { dup += 1; return; }
    if (roomList.length >= MAX_ROOMS) { overflow += 1; return; }
    seen.add(key);
    roomList.push(r);
    added += 1;
  });
  return { added, dup, overflow };
}

function roomKeys() {
  return roomList.map((r) => normRoom(r)).filter(Boolean);
}

function paintRoomChips() {
  const host = document.getElementById('f_room_chips');
  const hint = document.getElementById('f_room_hint');
  if (!host) return;

  host.innerHTML = roomList
    .map((r, i) => `
      <span class="room-chip">
        <span class="room-chip-name">${escapeHtml(r)}</span>
        <button class="room-chip-x" type="button" data-act="room-remove" data-idx="${i}" aria-label="移除 ${escapeHtml(r)}">${icon('close', 12)}</button>
      </span>`)
    .join('');

  if (hint) {
    if (roomList.length > 1) {
      hint.innerHTML = `<span class="room-hint-ok">${icon('layers', 13)}将生成 <strong>${roomList.length}</strong> 条工单（每间一条，便于分别派工与完工）</span>`;
    } else if (roomList.length === 1) {
      hint.innerHTML = `<span class="room-hint-ok">将生成 1 条工单</span>`;
    } else {
      hint.innerHTML = '';
    }
  }
}

/** 把输入框里的内容解析并加入 chips，然后清空输入框 */
function commitRoomInput() {
  const input = document.getElementById('f_room');
  if (!input) return;
  const { rooms, invalid } = parseRooms(input.value);
  if (!rooms.length && !invalid) return;

  const { added, dup, overflow } = mergeRooms(rooms);
  const msgs = [];
  if (added) msgs.push(`已加入 ${added} 间`);
  if (dup) msgs.push(`${dup} 间重复，已略过`);
  if (overflow) msgs.push(`最多一次 ${MAX_ROOMS} 间，多出的 ${overflow} 间未加入`);
  if (invalid) msgs.push(`${invalid} 项过长被忽略`);
  if (!added && !dup && !overflow && !invalid) msgs.push('没有识别到有效房间号');

  input.value = '';
  syncRoomAddBtn();
  paintRoomChips();
  scheduleDraftSave();
  scheduleDupCheck();
  if (msgs.length) toast(msgs.join('，'));
}

function removeRoomAt(idx) {
  if (!Number.isInteger(idx) || idx < 0 || idx >= roomList.length) return;
  roomList.splice(idx, 1);
  paintRoomChips();
  // 删到列表为空时，输入框那个红字错误要跟着一起清掉，否则会留一条过期提示
  if (!roomList.length) validateField('f_room');
  scheduleDraftSave();
  scheduleDupCheck();
}

/** 输入框有内容时显示「加入」按钮，提示可以按分隔符批量填 */
function syncRoomAddBtn() {
  const btn = document.getElementById('btnRoomAdd');
  const input = document.getElementById('f_room');
  if (!btn || !input) return;
  btn.hidden = !input.value.trim();
}

// 前端侧的「疑似重复」判断：同一手机号近 30 天内、同一楼栋 + 同一房间 + 同一故障类别，
// 且工单尚未走完（受理中/派工/维修中/待验收），即提示用户先确认，避免重复派工。
const DUP_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const DUP_OPEN_STATUS = {
  pending: '待受理',
  assigned: '已派工',
  working: '维修中',
  done: '待验收',
};
let dupTimer = null;
let dupHits = [];
let dupDismissed = false;
const dupPhoneCache = new Map(); // phone -> { ts, list }，60s 内复用，避免频繁打接口
const DUP_CACHE_TTL = 60 * 1000;

/** 房间号归一化：去空白、统一小写、剥掉中文后缀，避免「305 教室」与「305教室」判成两条 */
function normRoom(s) {
  return String(s || '')
    .replace(/\s+/g, '')
    .toLowerCase()
    .replace(/(教室|房间|寝室|宿舍|办公室|号)$/g, '');
}

async function fetchRecentTickets(phone) {
  const cached = dupPhoneCache.get(phone);
  if (cached && Date.now() - cached.ts < DUP_CACHE_TTL) return cached.list;
  const list = (await request(`/api/tickets?phone=${encodeURIComponent(phone)}`)) || [];
  dupPhoneCache.set(phone, { ts: Date.now(), list });
  return list;
}

function findDuplicates(list, { bldg, room, category }) {
  const nr = normRoom(room);
  if (!nr) return [];
  const now = Date.now();
  return list.filter((t) => {
    if (!DUP_OPEN_STATUS[t.status]) return false; // 已结单/已驳回不算重复
    if (t.building !== bldg || t.category !== category) return false;
    if (normRoom(t.room) !== nr) return false;
    const ts = t.createdAt ? new Date(t.createdAt).getTime() : NaN;
    return Number.isFinite(ts) && now - ts <= DUP_WINDOW_MS;
  });
}

/**
 * 多房间判重：返回 { [归一化房间]: 命中的工单数组 }。
 * 只统计当前类别下、每间房各自的命中，互不牵连——一间重复不应该拦住其他间提交。
 */
function findDuplicatesForRooms(list, { bldg, category, rooms }) {
  const map = new Map();
  rooms.forEach((room) => {
    const key = normRoom(room);
    if (!key) return;
    const hits = findDuplicates(list, { bldg, room, category });
    if (hits.length) map.set(key, hits);
  });
  return map;
}

function paintDupBar() {
  const host = document.getElementById('dupBarHost');
  if (!host) return;
  if (!dupHits.length || dupDismissed) {
    host.innerHTML = '';
    return;
  }
  const bldgName = escapeHtml(document.getElementById('f_bldg')?.value || '');
  const catName = escapeHtml(currentCategory());

  // 按房间分组展示：多房间批量报修时，用户需要清楚知道是哪几间已有人报过
  const groups = new Map();
  dupHits.forEach((t) => {
    const key = normRoom(t.room) || '未知房间';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  });

  const groupHtml = Array.from(groups.entries())
    .map(([key, list]) => {
      const rows = list.map((t) => `
        <div class="dup-row">
          <span class="badge ${(STATUS_MAP[t.status] || {}).cls || 'b-pending'}">${escapeHtml((STATUS_MAP[t.status] || {}).label || t.status)}</span>
          <span class="dup-no">${escapeHtml(t.id)}</span>
          <span class="dup-when">${escapeHtml(formatShortTime(t.createdAt))}</span>
          <button class="poll-refresh" type="button" data-act="dup-detail" data-id="${escapeHtml(t.id)}">查看进度</button>
        </div>`).join('');
      const label = list[0]?.room || key;
      return `
        <div class="dup-group">
          <div class="dup-group-head">${icon('mapPin', 13)}<strong>${escapeHtml(label)}</strong><span class="dup-group-num">${list.length} 条</span></div>
          ${rows}
        </div>`;
    })
    .join('');

  const roomCount = roomsWithDup();
  const scope = roomList.length > 1
    ? `${bldgName} 本批 ${roomList.length} 间中有 <strong>${roomCount}</strong> 间`
    : `${bldgName} ${escapeHtml(roomList[0] || '')}`;

  host.innerHTML = `
    <div class="alert alert-warn mb-12 col gap-6 start" role="status">
      ${icon('alert', 16)}
      <div class="grow">
        <strong>疑似重复报修</strong>
        <div class="mt-4">${scope} 的「${catName}」近 30 天内已有未完成的报修，重复提交会占用维修排期。</div>
        <div class="dup-list">${groupHtml}</div>
      </div>
      <button class="btn btn-sm btn-outline shrink-0" type="button" data-act="dup-dismiss">知道了</button>
    </div>`;
}

/** 命中的房间去重计数 */
function roomsWithDup() {
  return new Set(dupHits.map((t) => normRoom(t.room))).size;
}

/** 当前生效的房间列表：输入框里还没「加入」的内容也算上，避免用户漏点按钮就提交 */
function effectiveRooms() {
  const input = document.getElementById('f_room');
  const pending = parseRooms(input ? input.value : '').rooms;
  if (!pending.length) return [...roomList];
  const seen = new Set(roomList.map((r) => normRoom(r)));
  const all = [...roomList];
  pending.forEach((r) => {
    const key = normRoom(r);
    if (key && !seen.has(key)) {
      seen.add(key);
      all.push(r);
    }
  });
  return all;
}

async function runDupCheck() {
  const bldgEl = document.getElementById('f_bldg');
  const roomEl = document.getElementById('f_room');
  const phoneEl = document.getElementById('f_phone');
  if (!bldgEl || !roomEl || !phoneEl) return;

  const bldg = bldgEl.value;
  const rooms = effectiveRooms();
  const phone = phoneEl.value.trim();
  const category = currentCategory();

  // 手机号或房间列表不完整时先清掉旧提示，避免误导
  if (!/^1\d{10}$/.test(phone) || !rooms.length) {
    dupHits = [];
    dupDismissed = false;
    dupPhoneCache.delete(phone);
    paintDupBar();
    return;
  }

  try {
    const list = await fetchRecentTickets(phone);
    const map = findDuplicatesForRooms(list, { bldg, category, rooms });
    dupHits = Array.from(map.values()).flat();
    dupDismissed = false;
    paintDupBar();
  } catch {
    dupPhoneCache.delete(phone);
    // 查重是增强能力，失败时静默降级，不打扰用户提交
  }
}

/** 条件变化后的防抖查重 */
function scheduleDupCheck() {
  if (dupTimer) clearTimeout(dupTimer);
  dupTimer = setTimeout(runDupCheck, 800);
}

function currentCategory() {
  return (document.querySelector('#f_cat_chips .chip.active') || {}).dataset?.val || '水电照明';
}

/** 进入表单页时恢复草稿 */
function setupDraft() {
  const d = readDraft();
  if (d && draftHasContent(d)) {
    restoreFormDraft(d);
    paintDraftBar({ ts: d.ts });
  }
}

// ----------------- 即时校验 -----------------
const touched = new Set();

const FIELD_RULES = {
  f_room: (v) => {
    // 多房间改造后，输入框本身可以为空（房间已进 chips），校验以 chips + 输入框合并结果为准
    const rooms = effectiveRooms();
    if (!rooms.length) {
      return v.trim() ? '房间号太短，请填写完整位置' : '请填写楼层 / 房间号';
    }
    if (rooms.length > MAX_ROOMS) return `一次最多报 ${MAX_ROOMS} 间，请分次提交`;
    const bad = rooms.find((r) => r.trim().length < 2);
    if (bad !== undefined) return `「${bad}」太短，请填写完整位置`;
    return '';
  },
  f_desc: (v) => {
    const s = v.trim();
    if (!s) return '请描述故障现象';
    if (s.length < 5) return '请至少填写 5 个字，便于师傅提前备料';
    return '';
  },
  f_reporter: (v) => (v.trim() ? '' : '请填写联系人姓名'),
  f_phone: (v) => (/^1\d{10}$/.test(v.trim()) ? '' : '请填写 11 位手机号（作为查单凭证）'),
};

function clearFieldError(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('invalid');
  el.removeAttribute('aria-invalid');
  el.removeAttribute('aria-describedby');
  const box = el.closest('.field')?.querySelector('.field-error');
  if (box) box.remove();
}

function showFieldError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle('invalid', Boolean(msg));
  const field = el.closest('.field');
  if (!field) return;
  if (!msg) {
    clearFieldError(id);
    return;
  }
  el.setAttribute('aria-invalid', 'true');
  let box = field.querySelector('.field-error');
  if (!box) {
    box = document.createElement('div');
    box.id = `${id}_err`;
    box.className = 'field-error';
    box.setAttribute('role', 'alert'); // 读屏可即时播报错信息
    field.appendChild(box);
  }
  el.setAttribute('aria-describedby', box.id);
  box.textContent = msg;
}

/** force=true 时无视 touched 直接校验（提交用） */
function validateField(id, force = false) {
  const el = document.getElementById(id);
  if (!el) return true;
  if (!force && !touched.has(id)) return true;
  const msg = FIELD_RULES[id](el.value);
  showFieldError(id, msg);
  return !msg;
}

function validateAll() {
  const ids = Object.keys(FIELD_RULES);
  let firstBad = null;
  ids.forEach((id) => {
    touched.add(id);
    if (!validateField(id, true) && !firstBad) firstBad = id;
  });
  if (firstBad) document.getElementById(firstBad)?.focus();
  return !firstBad;
}

function bindFormEvents() {
  // 单选 Chips 绑定（radiogroup 语义 + 方向键可选）
  const chipGroups = [
    ['f_cat_chips', 'f_cat_label'],
    ['f_urg_chips', 'f_urg_label'],
    ['f_who_chips', 'f_who_label'],
  ];
  chipGroups.forEach(([boxId, labelId]) => {
    bindChipRadioGroup(document.getElementById(boxId), {
      labelId,
      onChange: () => {
        scheduleDraftSave();
        if (boxId === 'f_cat_chips') scheduleDupCheck();
      },
    });
  });

  // 即时校验 + 草稿自动保存
  Object.keys(FIELD_RULES).forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.setAttribute('aria-required', 'true');
    el.addEventListener('blur', () => { touched.add(id); validateField(id, true); });
    el.addEventListener('input', () => {
      if (touched.has(id)) validateField(id);
      scheduleDraftSave();
    });
  });
  const bldg = document.getElementById('f_bldg');
  if (bldg) bldg.addEventListener('change', () => { scheduleDraftSave(); scheduleDupCheck(); });

  // 房间号：回车/失焦/点「加入」都把它并入 chips；输入变化时按内容显示「加入」按钮
  const roomInput = document.getElementById('f_room');
  const roomAddBtn = document.getElementById('btnRoomAdd');
  if (roomInput) {
    roomInput.addEventListener('input', syncRoomAddBtn);
    roomInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault(); // 别让回车触发 form 提交
        commitRoomInput();
        validateField('f_room', true);
      }
    });
    roomInput.addEventListener('blur', () => {
      // 失焦时若输入框里是「305、306」这种多值，直接并入；单个值也并入，减少一次点击
      if (roomInput.value.trim()) {
        commitRoomInput();
        validateField('f_room', true);
      }
      scheduleDupCheck();
    });
    roomInput.addEventListener('paste', () => {
      // 等粘贴内容进 DOM 再判断，粘贴多值时直接并入
      setTimeout(() => {
        if (/[、,，;；\/\n\t|]/.test(roomInput.value)) commitRoomInput();
        else syncRoomAddBtn();
      }, 0);
    });
  }
  if (roomAddBtn) {
    roomAddBtn.onclick = () => {
      commitRoomInput();
      validateField('f_room', true);
    };
  }
  // 房间 chips 用事件委托，避免每次重绘都重新绑。
  // 注意：room-remove 刻意不放进全局 delegateActions —— 它在 #f_room_chips 上就地处理，
  // 因为 chips 会频繁重绘，就地监听比全局委托更容易保证只响应自己容器里的点击。
  const roomChipsHost = document.getElementById('f_room_chips');
  if (roomChipsHost) {
    roomChipsHost.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act="room-remove"]');
      if (!btn) return;
      removeRoomAt(Number(btn.dataset.idx));
    });
  }

  // 手机号填够位数后才开始查重，边填边打接口没必要
  const phoneEl = document.getElementById('f_phone');
  if (phoneEl) phoneEl.addEventListener('blur', scheduleDupCheck);

  bindPhotoInput();
  bindSubmit();
  paintRoomChips();
  runDupCheck(); // 草稿回填后可能已经构成重复，进入即查一次
}

// ----------------- 常见故障一键填入 -----------------
/**
 * 把模板回填到表单：故障类别 + 紧急程度 + 故障描述。
 * 类别/紧急程度若因后台调整字典而匹配不上，仅填描述并提示手动选择，不静默失败。
 * 再点一次同一个模板 = 取消填入，避免误点后无法撤销。
 */
function applyTemplate(name, { closeAfter = false } = {}) {
  const tpl = REPAIR_TEMPLATES.find((t) => t.name === name);
  if (!tpl) return;
  if (closeAfter) closeModal();

  if (activeTemplate && activeTemplate.name === name) {
    cancelTemplate();
    return;
  }

  const catOk = setChipGroupValue(document.getElementById('f_cat_chips'), tpl.cat);
  const urgOk = setChipGroupValue(document.getElementById('f_urg_chips'), tpl.urgency);

  const descEl = document.getElementById('f_desc');
  if (descEl) {
    descEl.value = tpl.desc;
    touched.add('f_desc');
    validateField('f_desc');
  }

  // 高亮当前使用的模板（表单上的卡片与弹窗里的 chips 各有一份）
  document.querySelectorAll('.tpl-card, .tpl-chip').forEach((c) => {
    const on = c.dataset.val === name;
    c.classList.toggle('active', on);
    if (c.classList.contains('tpl-card')) c.setAttribute('aria-pressed', on ? 'true' : 'false');
  });

  activeTemplate = { name: tpl.name, cat: tpl.cat, urgency: tpl.urgency, desc: tpl.desc };
  scheduleDraftSave();
  if (catOk && urgOk) toast(`已填入「${tpl.name}」，再点一次可取消`);
  else toast(`已填入描述；「${tpl.cat}」类别请手动选择（后台字典可能已调整）`);
}

/** 全部常见任务，按故障类别分组展示 */
function openTemplatePicker() {
  const groups = new Map();
  REPAIR_TEMPLATES.forEach((t) => {
    if (!groups.has(t.cat)) groups.set(t.cat, []);
    groups.get(t.cat).push(t);
  });
  const body = [...groups.entries()].map(([cat, list]) => `
      <div class="tpl-pick-group">
        <div class="tpl-pick-cat">${categoryIcon(cat, 14)}${escapeHtml(cat)}<span class="tpl-pick-num">${list.length} 条</span></div>
        <div class="chips-group">
          ${list.map((t) => `<span class="chip tpl-chip" data-act="pick-tpl" data-val="${escapeHtml(t.name)}" role="button" tabindex="0">${escapeHtml(t.name)}<span class="tpl-hits">${t.hits}</span></span>`).join('')}
        </div>
      </div>`).join('');

  openModal(`
    <div class="modal-header">
      <h3>${icon('clipboard', 18)}常见报修任务</h3>
      <button class="modal-close-btn" type="button" data-act="modal-close" aria-label="关闭">${icon('close', 16)}</button>
    </div>
    <div class="modal-body">
      <p class="hint mb-12">${icon('info', 13)}按集团历史报修工单统计排序，数字为历史出现次数；点击即填入表单。</p>
      ${body}
    </div>
  `);
}

function bindPhotoInput() {
  const fileInput = document.getElementById('photoFileInput');
  if (!fileInput) return;
  fileInput.onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = ''; // 允许重复选择同一张
    if (!file) return;
    if (uploadedPhotos.length >= 3) {
      toast('最多上传 3 张照片');
      return;
    }

    const tileId = 'upTile_' + Date.now();
    renderPhotoGrid(uploadingTile(tileId, '压缩上传中'));

    try {
      const res = await uploadPhoto(file, {
        maxEdge: 1600,
        quality: 0.82,
        onProgress: (p) => updateUploadTile(tileId, p),
      });
      updateUploadTile(tileId, 100);
      uploadedPhotos.push(res.url);
      scheduleDraftSave();
      toast('照片上传成功');
    } catch (err) {
      toast(`上传失败：${err.message}`);
    } finally {
      renderPhotoGrid();
    }
  };
}

function bindSubmit() {
  const btnSubmit = document.getElementById('btnSubmitTicket');
  if (!btnSubmit) return;
  btnSubmit.onclick = async () => {
    if (!validateAll()) {
      toast('请先完善表单中标红的内容');
      return;
    }

    const bldg = document.getElementById('f_bldg').value;
    // 输入框里没点「加入」的内容也要算进来，否则用户填完直接点提交会漏报
    const rooms = effectiveRooms();
    if (!rooms.length) {
      toast('请先填写房间号');
      return;
    }

    const desc = document.getElementById('f_desc').value.trim();
    const reporter = document.getElementById('f_reporter').value.trim();
    const phone = document.getElementById('f_phone').value.trim();
    const category = currentCategory();
    const urgency = (document.querySelector('#f_urg_chips .chip.active') || {}).dataset?.val || '普通';
    const identity = (document.querySelector('#f_who_chips .chip.active') || {}).dataset?.val || '教职工';

    // 最后一刻再兜一次查重：距上次防抖检查可能又产生了新工单。
    // 加 3s 上限，接口慢也不能把用户卡在提交这一步。
    await Promise.race([runDupCheck().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
    if (dupHits.length && !dupDismissed) {
      const dupRooms = Array.from(new Set(dupHits.map((t) => t.room))).join('、');
      const extra = rooms.length > 1 ? `（本批共 ${rooms.length} 间，仅提示已报过的房间，其余照常提交）` : '';
      const goon = await confirmDialog({
        title: '确认仍然提交？',
        desc: `${bldg} ${dupRooms} 的「${category}」近 30 天内已有 ${dupHits.length} 条未完成的报修（${dupHits.map((t) => t.id).join('、')}）。继续提交会生成重复工单，建议先查看原工单进度。${extra}`,
        okText: '仍然提交',
        cancelText: '返回修改',
        danger: true,
      });
      if (!goon) return;
    }

    // 多房间时先确认，避免用户误粘贴一大串就生成几十条工单
    if (rooms.length > 1) {
      const multi = await confirmDialog({
        title: `确认生成 ${rooms.length} 条工单？`,
        desc: `将按房间拆分为 ${rooms.length} 条独立工单（同一批次，便于分别派工与逐间完工）：${rooms.join('、')}`,
        okText: `提交 ${rooms.length} 条`,
        cancelText: '返回修改',
      });
      if (!multi) return;
    }

    // 批次号：同一次提交的所有房间共用，管理端/师傅端据此归组
    const batchToken = rooms.length > 1 ? `B${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}` : '';
    const failed = [];
    const created = [];

    await runAction(btnSubmit, rooms.length > 1 ? `正在提交 1/${rooms.length}…` : '正在提交…', async () => {
      for (let i = 0; i < rooms.length; i += 1) {
        if (rooms.length > 1) {
          btnSubmit.textContent = `正在提交 ${i + 1}/${rooms.length}…`;
        }
        try {
          const t = await request('/api/tickets', {
            method: 'POST',
            body: {
              building: bldg,
              room: rooms[i],
              category,
              urgency,
              desc,
              reporter,
              phone,
              identity,
              photos: uploadedPhotos,
              batchToken,
              batchSize: rooms.length,
              // 幂等键：同一次提交的同一间房，重试也不会生成第二条
              clientToken: batchToken ? `${batchToken}-${i}` : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
            },
          });
          created.push(t);
        } catch (err) {
          failed.push({ room: rooms[i], msg: err.message || '提交失败' });
        }
      }
    });

    if (!created.length) {
      toast(`提交失败：${failed[0]?.msg || '请稍后重试'}`);
      return;
    }

    myPhone = phone;
    localStorage.setItem('bx_reporter_phone', phone);
    uploadedPhotos = [];
    touched.clear();
    clearTemplateSelection();
    // 工单刚生成，本机缓存已经过期，下次进表单必须重新拉列表比对
    dupPhoneCache.delete(phone);
    dupHits = [];
    dupDismissed = false;

    if (failed.length) {
      // 部分失败：成功的已入库，失败的留在 chips 里让用户再点一次提交（幂等键保证成功的不会重复）
      roomList = failed.map((f) => f.room);
      paintRoomChips();
      scheduleDraftSave();
      toast(`已提交 ${created.length} 条，${failed.length} 间失败（${failed.map((f) => f.room).join('、')}），可直接再次提交`);
      return;
    }

    roomList = [];
    paintRoomChips();
    clearFormDraft();

    if (created.length > 1) {
      toast(`已生成 ${created.length} 条工单：${created.map((t) => t.id).join('、')}`, () => switchTab('mine'));
    } else {
      toast(`报修提交成功，工单号 ${created[0].id}`, () => switchTab('mine'));
    }
  };
}

function renderPhotoGrid(extraHtml = '') {
  const grid = document.getElementById('photosGrid');
  if (!grid) return;
  const items = uploadedPhotos
    .map((url, idx) => `
      <div class="photo-item">
        <img src="${escapeHtml(url)}" alt="现场照片 ${idx + 1}" data-act="view-photo" data-src="${escapeHtml(url)}" role="button" tabindex="0">
        <span class="btn-remove" data-act="remove-photo" data-idx="${idx}" role="button" tabindex="0" aria-label="删除照片">${icon('close', 12)}</span>
      </div>`)
    .join('');

  // 上传中的占位块保留在末尾（extraHtml 为增量渲染用）
  grid.innerHTML = items + extraHtml + (uploadedPhotos.length < 5 ? photoUploadBtn() : '');
  bindPhotoInput();
}

const removePhoto = (idx) => {
  uploadedPhotos.splice(idx, 1);
  renderPhotoGrid();
  scheduleDraftSave();
};

// ----------------- 我的报修查询页面 -----------------
function renderMineView() {
  return `
    <section class="card">
      <div class="card-head">
        <div class="card-title">${icon('search', 16)}查询我的报修</div>
      </div>
      <div class="row gap-8">
        <input class="control grow" type="tel" id="inputQueryPhone" aria-label="报修手机号" maxlength="11" inputmode="numeric" placeholder="输入报修填写的 11 位手机号" value="${escapeHtml(myPhone)}" autocomplete="tel">
        <button class="btn btn-primary shrink-0" id="btnQuery" type="button">${icon('search', 16)}查询</button>
      </div>
      <div class="hint">${icon('info', 13)}凭报修时填写的手机号即可查看工单进度与处理动态</div>
    </section>
    <div id="ticketsListContainer">
      ${emptyBlock('clipboard', '输入手机号查询进度', '可在上方输入报修时填写的手机号')}
    </div>
  `;
}

function emptyBlock(iconName, title, desc) {
  return `<div class="card"><div class="empty">
    <div class="empty-icon">${icon(iconName, 22)}</div>
    <div class="empty-title">${escapeHtml(title)}</div>
    <div class="empty-desc">${escapeHtml(desc)}</div>
  </div></div>`;
}

function loadingBlock(text) {
  return `<div class="card"><div class="empty">
    <div class="empty-icon">${icon('clock', 22)}</div>
    <div class="empty-title">${escapeHtml(text)}</div>
  </div></div>`;
}

function bindMineEvents() {
  const btnQuery = document.getElementById('btnQuery');
  if (btnQuery) {
    btnQuery.onclick = () => {
      const val = document.getElementById('inputQueryPhone').value.trim();
      const input = document.getElementById('inputQueryPhone');
      if (!/^1\d{10}$/.test(val)) {
        input.classList.add('invalid');
        toast('请填写正确的 11 位手机号');
        return;
      }
      input.classList.remove('invalid');
      myPhone = val;
      localStorage.setItem('bx_reporter_phone', val);
      loadMyTickets();
    };
  }
  const input = document.getElementById('inputQueryPhone');
  if (input) {
    input.onkeydown = (e) => { if (e.key === 'Enter') document.getElementById('btnQuery').click(); };
  }
}

function updateMinePollLabel() {
  const el = document.getElementById('minePollLabel');
  if (el) el.textContent = relTimeFrom(lastMineRefresh);
}

function bindMinePollButton() {
  const btn = document.getElementById('btnMineRefresh');
  if (btn) btn.onclick = () => loadMyTickets({ silent: true });
}

/** 启动"我的报修"轮询（需已查询过手机号，且当前在该标签页） */
function startMyPoller() {
  if (myPoller) return;
  myPoller = createPoller(async () => {
    if (currentTab !== 'mine' || !myPhone) return false;
    if (document.querySelector('.modal-overlay')) return false;
    if (!document.getElementById('ticketsListContainer')) return false;
    await loadMyTickets({ silent: true });
    return true;
  }, 45000, () => updateMinePollLabel());

  if (!myLabelTimer) myLabelTimer = setInterval(updateMinePollLabel, 30000);
}

async function loadMyTickets({ silent = false } = {}) {
  const container = document.getElementById('ticketsListContainer');
  if (!container) return;
  if (!silent) container.innerHTML = `${loadingBlock('正在加载报修记录')}<div class="skeleton sk-row"></div>`;

  try {
    const list = await request(`/api/tickets?phone=${encodeURIComponent(myPhone)}`);
    myTickets = list || [];

    // 静默轮询时找出状态发生变化的工单；首查仅记录基线，不高亮
    const changed = new Set();
    myTickets.forEach((t) => {
      if (lastStatusMap.has(t.id) && lastStatusMap.get(t.id) !== t.status) changed.add(t.id);
      lastStatusMap.set(t.id, t.status);
    });
    if (silent && changed.size > 0) toast(`${changed.size} 条报修有新的进度更新`);
    lastMineRefresh = Date.now();
    const markNew = silent ? changed : new Set();

    if (!myTickets.length) {
      container.innerHTML = emptyBlock('inbox', '未查询到报修单', `手机号 ${myPhone} 暂无关联报修记录`);
      return;
    }
    container.innerHTML = `<div class="row between grow mb-8 subtle fs-13">
        <span>共 ${myTickets.length} 条报修记录</span>
        <span class="poll-bar">
          <span class="poll-dot" aria-hidden="true"></span>
          <span id="minePollLabel">${relTimeFrom(lastMineRefresh)}</span>
          <button class="poll-refresh" type="button" id="btnMineRefresh">${icon('refresh', 12)}刷新</button>
        </span>
      </div>` + myTickets.map((t) => renderTicketCard(t, markNew.has(t.id))).join('');
    bindMinePollButton();
    startMyPoller();
  } catch (err) {
    if (silent) return; // 轮询失败保持原列表
    container.innerHTML = `<div class="card"><div class="empty">
      <div class="empty-icon">${icon('alert', 22)}</div>
      <div class="empty-title">${escapeHtml(err.retryable ? '网络异常，查询失败' : '查询失败')}</div>
      <div class="empty-desc">${escapeHtml(err.message)}</div>
      <button class="btn btn-primary mt-16" type="button" id="btnBlockRetry">${icon('refresh', 14)}重新加载</button>
    </div></div>`;
    const retryBtn = document.getElementById('btnBlockRetry');
    if (retryBtn) retryBtn.onclick = () => loadMyTickets();
  }
}

/** 批次徽标：同一次提交的多间房共用 batchToken，界面上标出「同批 N 间」便于理解 */
function batchBadgeHtml(t) {
  if (!t || !t.batchToken || (t.batchSize || 1) < 2) return '';
  return `<span class="batch-badge" title="与同批次的其它房间一起提交">${icon('layers', 11)}同批 ${t.batchSize} 间</span>`;
}

function renderTicketCard(t, isNew = false) {
  const st = STATUS_MAP[t.status] || { label: t.status, cls: 'b-pending' };
  const timeoutBadge = t.isTimeout ? `<span class="badge b-timeout">${icon('alert', 12)}超时</span>` : '';
  const remindBadge = t.remindCount > 0 ? `<span class="badge b-remind">${icon('bell', 12)}催单 ${t.remindCount}</span>` : '';
  const batchBadge = batchBadgeHtml(t);

  const photosHtml = t.photos && t.photos.length > 0
    ? `<div class="photos-grid">${t.photos.map((p, i) => `<div class="photo-item sm"><img src="${escapeHtml(p)}" alt="现场照片 ${i + 1}" data-act="view-photo" data-src="${escapeHtml(p)}" role="button" tabindex="0"></div>`).join('')}</div>`
    : '';

  let actionsHtml = `<button class="btn btn-sm btn-outline" type="button" data-act="my-detail" data-id="${escapeHtml(t.id)}">${icon('eye', 14)}详情</button>`;
  if (t.status === 'pending' || t.status === 'assigned' || t.status === 'working') {
    actionsHtml += `<button class="btn btn-sm btn-soft" type="button" data-act="remind" data-id="${escapeHtml(t.id)}">${icon('bell', 14)}加急催单</button>`;
  }
  if (t.status === 'done') {
    actionsHtml += `<button class="btn btn-sm btn-ok" type="button" data-act="rate" data-id="${escapeHtml(t.id)}">${icon('star', 14)}验收评价</button>`;
  }

  return `
    <article class="ticket-card ${t.isTimeout ? 'is-timeout' : ''}${isNew ? ' is-new' : ''}">
      <div class="ticket-head">
        <span class="ticket-no">${escapeHtml(t.id)}</span>
        <div class="badge-row">${batchBadge}${remindBadge}${timeoutBadge}<span class="badge ${st.cls}">${st.label}</span></div>
      </div>
      <h3 class="ticket-title">${icon('mapPin', 15)}${escapeHtml(t.building)} ${escapeHtml(t.room)}</h3>
      <div class="ticket-meta">
        <span class="meta-item">${categoryIcon(t.category, 13)}${escapeHtml(t.category)}</span>
        <span class="meta-item ${t.urgency === '紧急' ? 'urgent strong' : ''}">${icon('alert', 13)}${escapeHtml(t.urgency)}</span>
        <span class="meta-item">${icon('clock', 13)}${formatShortTime(t.createdAt)}</span>
        ${t.assignee ? `<span class="meta-item">${icon('wrench', 13)}师傅 ${escapeHtml(t.assignee)}</span>` : ''}
      </div>
      <p class="ticket-desc">${escapeHtml(t.desc)}</p>
      ${photosHtml}
      <div class="ticket-actions">${actionsHtml}</div>
    </article>
  `;
}

// ----------------- 工单详情弹窗 -----------------
const openDetail = async (id) => {
  try {
    const t = await request(`/api/tickets/${id}`);
    const st = STATUS_MAP[t.status] || { label: t.status, cls: 'b-pending' };

    const timeoutAlert = t.isTimeout
      ? `<div class="alert alert-danger mb-12">${icon('alert', 16)}<div><strong>SLA 超时预警</strong>：${escapeHtml(t.timeoutReason)}，已自动触发督办流程。</div></div>`
      : '';

    const photosHtml = t.photos && t.photos.length > 0
      ? `<div class="mt-12">
          <div class="label">现场照片</div>
          <div class="photos-grid">${t.photos.map((p, i) => `<div class="photo-item"><img src="${escapeHtml(p)}" alt="现场照片 ${i + 1}" data-act="view-photo" data-src="${escapeHtml(p)}" role="button" tabindex="0"></div>`).join('')}</div>
        </div>`
      : '';

    const finishHtml = t.result
      ? `<div class="alert alert-ok mt-12 col gap-4 start">
          ${icon('checkCircle', 16)}
          <div>
            <strong>维修结果</strong>
            <div class="mt-4">${escapeHtml(t.result)}</div>
            ${t.finishPhotos && t.finishPhotos.length > 0 ? `<div class="photos-grid">${t.finishPhotos.map((p, i) => `<div class="photo-item"><img src="${escapeHtml(p)}" alt="完工照片 ${i + 1}" data-act="view-photo" data-src="${escapeHtml(p)}" role="button" tabindex="0"></div>`).join('')}</div>` : ''}
          </div>
        </div>`
      : '';

    const ratingHtml = t.rating
      ? `<div class="alert alert-warn mt-12 col gap-4 start">
          ${icon('star', 16)}
          <div>
            <strong>我的验收评分</strong>
            <div class="mt-4 row gap-6">${stars(t.rating.score, 15)}<span class="fs-13">${escapeHtml(t.rating.score)} 星</span></div>
            <div class="mt-4 fs-13">${escapeHtml(t.rating.comment || '未填写评价')}</div>
          </div>
        </div>`
      : '';

    const timelineHtml = `
      <div class="mt-16">
        <div class="card-title mb-8 fs-14">${icon('history', 16)}处理动态</div>
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
        <div class="thread-head">${icon('message', 16)}现场留言 <span class="badge b-plain">${(t.comments || []).length}</span></div>
        <div class="thread-list">
          ${(t.comments || []).length === 0
            ? `<div class="subtle fs-13">暂无留言，可在此与维修师傅、总务处沟通</div>`
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
          <input class="control" type="text" id="dlgCommentInput" aria-label="留言内容" placeholder="留言说明现场情况...">
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
          ${batchBadgeHtml(t)}
        </div>
        <div class="soft-block">
          <div class="info-list">
            <div class="info-row"><span class="k">故障类别</span><span class="v">${categoryIcon(t.category, 14)}${escapeHtml(t.category)}｜紧急程度 <strong>${escapeHtml(t.urgency)}</strong></span></div>
            <div class="info-row"><span class="k">报修人</span><span class="v">${escapeHtml(t.reporter)}（${escapeHtml(t.identity)}）</span></div>
            <div class="info-row"><span class="k">联系电话</span><span class="v mono">${escapeHtml(t.phone)}</span></div>
            <div class="info-row"><span class="k">报修时间</span><span class="v">${formatTime(t.createdAt)}</span></div>
            ${t.assignee ? `<div class="info-row"><span class="k">维修师傅</span><span class="v">${escapeHtml(t.assignee)}</span></div>` : ''}
            <div class="info-row"><span class="k">故障描述</span><span class="v">${escapeHtml(t.desc)}</span></div>
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
    const send = async () => {
      const content = input.value.trim();
      if (!content) return;
      const sendBtnEl = document.getElementById('dlgSendCommentBtn');
      const run = async () => {
        await request(`/api/tickets/${t.id}/comments`, {
          method: 'POST',
          body: { senderRole: 'reporter', senderName: t.reporter || '报修人', content },
        });
        openDetail(t.id);
      };
      await runAction(sendBtnEl, '发送中…', run);
    };
    const sendBtn = document.getElementById('dlgSendCommentBtn');
    sendBtn.onclick = send;
    input.onkeydown = (e) => { if (e.key === 'Enter') send(); };
  } catch (err) {
    toast(`加载详情失败: ${err.message}`);
  }
};

const remindTicket = async (id) => {
  const note = await promptDialog({
    title: '加急催单',
    desc: '催单会推送给总务处与负责师傅，请说明现场的实际影响。',
    label: '催单原因',
    value: '急需使用，请尽快处理！',
    rows: 3,
    maxlength: 60,
    iconName: 'bell',
  });
  if (!note) return;
  try {
    await request(`/api/tickets/${id}/remind`, { method: 'POST', body: { note } });
    toast('加急催单已通知总务处及师傅');
    loadMyTickets();
  } catch (err) {
    toast(err.message);
  }
};

const openRate = (id) => {
  let curScore = 5;
  const scoreChips = [
    [5, '非常满意'], [4, '满意'], [3, '一般'], [2, '不太满意'], [1, '很差'],
  ].map(([s, label]) => `<span class="chip ${s === 5 ? 'active' : ''}" data-s="${s}">${stars(s, 15)}${label}</span>`).join('');

  openModal(`
    <div class="modal-header">
      <h3>${icon('star', 18)}完工验收评价</h3>
      <button class="modal-close-btn" type="button" data-act="modal-close" aria-label="关闭">${icon('close', 16)}</button>
    </div>
    <div class="modal-body">
      <div class="field">
        <span class="label" id="rateScoreLabel">服务评分<span class="opt">1 ~ 5 星</span></span>
        <div class="chips-group" id="rateScoreGroup" aria-labelledby="rateScoreLabel">${scoreChips}</div>
      </div>
      <div class="field">
        <label class="label" for="rateCommentText">评价与建议反馈</label>
        <textarea class="control" id="rateCommentText" placeholder="例如：师傅处理及时，技术好，现场收拾得很干净"></textarea>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-outline" type="button" data-act="modal-close">取消</button>
      <button class="btn btn-ok" id="btnRateSubmit" type="button">${icon('check', 16)}提交评价并结单</button>
    </div>
  `);

  bindChipRadioGroup(document.getElementById('rateScoreGroup'), {
    labelId: 'rateScoreLabel',
    valueKey: 's',
    onChange: (val) => { curScore = parseInt(val, 10) || 5; },
  });

  document.getElementById('btnRateSubmit').onclick = async () => {
    const comment = document.getElementById('rateCommentText').value.trim();
    const btn = document.getElementById('btnRateSubmit');
    await runAction(btn, '正在提交…', async () => {
      await request(`/api/tickets/${id}/rate`, { method: 'POST', body: { score: curScore, comment } });
      toast('感谢评价，工单已结单');
      closeModal();
      loadMyTickets();
    });
  };
};

// ----------------- 事件委托（替代 onclick="window.xxx()"） -----------------
delegateActions({
  'my-detail': ({ id }) => openDetail(id),
  remind: ({ id }) => remindTicket(id),
  rate: ({ id }) => openRate(id),
  'view-photo': ({ src }) => viewImage(src),
  'remove-photo': ({ idx }) => removePhoto(Number(idx)),
  'modal-close': () => closeModal(),
  'dup-detail': ({ id }) => openDetail(id),
  'dup-dismiss': () => {
    dupDismissed = true;
    paintDupBar();
  },
  'use-tpl': ({ val }) => applyTemplate(val),
  'more-tpl': () => openTemplatePicker(),
  'pick-tpl': ({ val }) => applyTemplate(val, { closeAfter: true }),
});

init();
