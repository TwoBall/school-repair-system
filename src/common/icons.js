/**
 * 内联 SVG 图标库（线性风格，零外部请求）
 * 用法：import { icon, CATEGORY_ICONS } from '../common/icons.js';
 *      `${icon('wrench', 18)}`
 * 说明：所有 path 为手写几何路径，stroke 使用 currentColor，随文字色自动适配深浅主题。
 */

const PATHS = {
  /* 品牌与导航 */
  school: '<path d="M4 20.5V9.8L12 4.5l8 5.3v10.7"/><path d="M9.2 20.5v-5.6a2.8 2.8 0 0 1 5.6 0v5.6"/><path d="M2.6 9.8h18.8"/><path d="M12 4.5v2.6"/>',
  dashboard: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.8"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.8"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.8"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.8"/>',
  edit: '<path d="M4.2 19.8h3.9L19.3 9.1a2.3 2.3 0 0 0-3.2-3.2L4.2 16.6z"/><path d="m14.6 6.2 3.2 3.2"/>',
  clipboard: '<rect x="6" y="4.6" width="12" height="16" rx="2.2"/><path d="M9.6 4.6V3.4a.9.9 0 0 1 .9-.9h3a.9.9 0 0 1 .9.9v1.2"/><path d="M9.4 11.4h5.2M9.4 15.4h3.4"/>',
  wrench: '<path d="M16.6 3.6a5.6 5.6 0 0 0-7.5 7L4.2 15.6a2.2 2.2 0 0 0 3.1 3.1l5-5a5.6 5.6 0 0 0 7-5.9l-4.3 4.3-2-.5-.5-2z"/>',
  hammer: '<path d="m14.6 3.4 6 6-2.4 2.4-6-6z"/><path d="m12.2 5.8-8 8 2.4 2.4 8-8"/><path d="M4.4 19.6h6.2"/>',
  history: '<path d="M3.6 12A8.4 8.4 0 1 0 6.6 6.2"/><path d="M3.6 4.2v4.4H8"/><path d="M12 8.2v4.3l3 1.9"/>',
  inbox: '<path d="M4.2 12.6h4l1.5 2.6h4.6l1.5-2.6h4"/><path d="M4.2 12.6 6.9 5.9a1.6 1.6 0 0 1 1.5-1h7.2a1.6 1.6 0 0 1 1.5 1l2.7 6.7v4.9a1.6 1.6 0 0 1-1.6 1.6H5.8a1.6 1.6 0 0 1-1.6-1.6z"/>',

  /* 操作 */
  camera: '<path d="M3.6 8.6A1.6 1.6 0 0 1 5.2 7h1.5a1.6 1.6 0 0 0 1.4-.8l.8-1.4A1.6 1.6 0 0 1 10.3 4h3.4a1.6 1.6 0 0 1 1.4.8l.8 1.4a1.6 1.6 0 0 0 1.4.8h1.5a1.6 1.6 0 0 1 1.6 1.6v8.8A1.6 1.6 0 0 1 19 19.6H5a1.6 1.6 0 0 1-1.6-1.6z"/><circle cx="12" cy="13" r="3.4"/>',
  image: '<rect x="3.6" y="4.6" width="16.8" height="14.8" rx="2.2"/><circle cx="9" cy="10" r="1.6"/><path d="m4.4 17.4 4.4-4.2 3.5 3.2 3-2.6 4.3 3.6"/>',
  search: '<circle cx="11" cy="11" r="6.6"/><path d="m16 16 4.2 4.2"/>',
  plus: '<path d="M12 5.6v12.8M5.6 12h12.8"/>',
  trash: '<path d="M4.6 7h14.8"/><path d="M9.6 7V5.2A1.2 1.2 0 0 1 10.8 4h2.4a1.2 1.2 0 0 1 1.2 1.2V7"/><path d="M6.6 7l.9 12A1.6 1.6 0 0 0 9.1 20.6h5.8a1.6 1.6 0 0 0 1.6-1.5l.9-12.1"/><path d="M10.4 11v6M13.6 11v6"/>',
  send: '<path d="M20.4 3.6 10 14"/><path d="M20.4 3.6 14.4 20.4l-3.1-6.9-6.9-3.1z"/>',
  download: '<path d="M12 3.6v11.2M8.2 11l3.8 3.8L15.8 11"/><path d="M4.6 18.6h14.8"/>',
  printer: '<path d="M7.2 8.6V4.6h9.6v4"/><rect x="4.6" y="8.6" width="14.8" height="7" rx="1.8"/><path d="M7.6 15.6h8.8v4H7.6z"/>',
  refresh: '<path d="M20 11.6A8 8 0 0 0 6.4 6.8L3.6 9.4"/><path d="M4 13.4a8 8 0 0 0 13.6 5.2l2.8-2.6"/><path d="M3.6 4.6v4.8h4.8M20.4 19.4v-4.8h-4.8"/>',
  filter: '<path d="M3.6 5.6h16.8l-6.6 7.6v5.4l-3.6-2v-3.4z"/>',
  close: '<path d="m6.4 6.4 11.2 11.2M17.6 6.4 6.4 17.6"/>',
  chevronRight: '<path d="m9.6 5.6 6.4 6.4-6.4 6.4"/>',
  chevronDown: '<path d="m5.6 9.6 6.4 6.4 6.4-6.4"/>',

  /* 状态与反馈 */
  check: '<path d="m5 12.6 4.6 4.6L19 7.4"/>',
  checkCircle: '<circle cx="12" cy="12" r="8.4"/><path d="m8.4 12.2 2.6 2.6 4.6-5.2"/>',
  xCircle: '<circle cx="12" cy="12" r="8.4"/><path d="m9.4 9.4 5.2 5.2M14.6 9.4l-5.2 5.2"/>',
  info: '<circle cx="12" cy="12" r="8.4"/><path d="M12 11.2v5M12 8h.01"/>',
  alert: '<path d="M10.3 4.3 2.7 17.5A1.5 1.5 0 0 0 4 19.8h16a1.5 1.5 0 0 0 1.3-2.3L13.7 4.3a1.5 1.5 0 0 0-2.6 0z"/><path d="M12 9.4v4M12 16.8h.01"/>',
  bell: '<path d="M18 9.4a6 6 0 1 0-12 0c0 4.8-2 5.8-2 5.8h16s-2-1-2-5.8z"/><path d="M10.2 19.4a2.1 2.1 0 0 0 3.6 0"/>',
  clock: '<circle cx="12" cy="12" r="8.4"/><path d="M12 7.4V12l3 2"/>',
  star: '<path d="m12 3.8 2.6 5.3 5.9.8-4.3 4.1 1 5.8L12 17l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/>',
  starOff: '<path d="m12 3.8 2.6 5.3 5.9.8-4.3 4.1 1 5.8L12 17l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/>',
  ban: '<circle cx="12" cy="12" r="8.4"/><path d="m6.6 17.4 10.8-10.8"/>',
  trend: '<path d="m3.6 16.6 5.4-5.4 4 4 7.4-7.4"/><path d="M15.4 7.6h5v5"/>',
  chart: '<path d="M4.6 19.6v-7.4M9.6 19.6V6.6M14.6 19.6v-5.4M19.6 19.6V9.6"/>',

  /* 人员与权限 */
  user: '<circle cx="12" cy="8.4" r="3.6"/><path d="M5 20a7 7 0 0 1 14 0"/>',
  users: '<circle cx="9.4" cy="8.4" r="3.2"/><path d="M3.6 19.6a5.8 5.8 0 0 1 11.6 0"/><path d="M16.2 5.8a3.2 3.2 0 0 1 0 6.2"/><path d="M18.4 14.6a5.8 5.8 0 0 1 2 4.4"/>',
  userCheck: '<circle cx="10" cy="8.4" r="3.4"/><path d="M3.6 19.6a6.4 6.4 0 0 1 10-5.2"/><path d="m15.4 19.6 2 2 4.2-4.6"/>',
  lock: '<rect x="5.4" y="10.4" width="13.2" height="9.6" rx="2.2"/><path d="M8.4 10.4V8a3.6 3.6 0 0 1 7.2 0v2.4"/><path d="M12 14.4v2.2"/>',
  logout: '<path d="M14.6 4.6h-6A2 2 0 0 0 6.6 6.6v10.8a2 2 0 0 0 2 2h6"/><path d="M12.6 12h8.4m0 0-2.6-2.6M21 12l-2.6 2.6"/>',
  eye: '<path d="M2.6 12S6.2 6.6 12 6.6 21.4 12 21.4 12S17.8 17.4 12 17.4 2.6 12 2.6 12z"/><circle cx="12" cy="12" r="3"/>',
  qr: '<rect x="3.6" y="3.6" width="6" height="6" rx="1.4"/><rect x="14.4" y="3.6" width="6" height="6" rx="1.4"/><rect x="3.6" y="14.4" width="6" height="6" rx="1.4"/><path d="M14.4 14.4h2.6v2.6h-2.6zM19.4 14.4h1M14.4 19.4h1M19.4 19.4h1"/>',
  phone: '<rect x="6.4" y="2.6" width="11.2" height="18.8" rx="2.6"/><path d="M10.4 18.6h3.2"/>',
  sliders: '<path d="M4 7.4h9.6M18.4 7.4H20M4 16.6h3.4M12 16.6h8"/><circle cx="16" cy="7.4" r="2.2"/><circle cx="10" cy="16.6" r="2.2"/>',
  calendar: '<rect x="3.6" y="5.4" width="16.8" height="15" rx="2.2"/><path d="M3.6 10.4h16.8M8.4 3.4v4M15.6 3.4v4"/>',
  message: '<path d="M20.4 12.2c0 3.8-3.8 6.8-8.4 6.8-1 0-2-.15-2.9-.42L4 20.4l1.3-3.1a6.5 6.5 0 0 1-1.8-5.1c0-3.8 3.8-6.8 8.5-6.8s8.4 3 8.4 6.8z"/>',
  mapPin: '<path d="M18.8 10.4c0 5.4-6.8 9.8-6.8 9.8s-6.8-4.4-6.8-9.8a6.8 6.8 0 0 1 13.6 0z"/><circle cx="12" cy="10.2" r="2.6"/>',
  receipt: '<path d="M4.6 7.6a2 2 0 0 1 2-2h10.8a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6.6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z"/><path d="M12 8.4v7.2"/>',
  dots: '<circle cx="5.6" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="18.4" cy="12" r="1.5"/>',

  /* 主题 */
  sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.6v2.2M12 19.2v2.2M4.4 4.4l1.6 1.6M18 18l1.6 1.6M2.6 12h2.2M19.2 12h2.2M4.4 19.6l1.6-1.6M18 6l1.6-1.6"/>',
  moon: '<path d="M20.2 14.4A8.6 8.6 0 0 1 9.6 3.8 8.6 8.6 0 1 0 20.2 14.4z"/>',

  /* 故障类别 */
  zap: '<path d="M13.6 3.2 5.6 13.6h5.2L9.4 20.8l8-10.4h-5.2z"/>',
  door: '<path d="M14.2 3.6H6.6A1.6 1.6 0 0 0 5 5.2v13.6A1.6 1.6 0 0 0 6.6 20.4h7.6"/><path d="M14.2 3.6h4.2v16.8h-4.2"/><path d="M11.8 12h.01"/>',
  wind: '<path d="M3.6 8.6h11a3 3 0 1 0-3-3"/><path d="M3.6 15.4h13.4a3 3 0 1 1-3 3"/><path d="M3.6 12h7.4"/>',
  droplet: '<path d="M12 3.2s6 6.2 6 10.2a6 6 0 0 1-12 0C6 9.4 12 3.2 12 3.2z"/>',
  monitor: '<rect x="3.6" y="4.6" width="16.8" height="11.4" rx="2.2"/><path d="M8.6 20.4h6.8M12 16v4.4"/>',
  layers: '<path d="m12 3.6 8.4 4.4L12 12.4 3.6 8z"/><path d="m3.6 12.8 8.4 4.4 8.4-4.4"/>',
  elevator: '<path d="M7.6 20.4V3.6M7.6 3.6 4 7.2M7.6 3.6 11.2 7.2M7.6 20.4 4 16.8M7.6 20.4l3.6-3.6M16.4 20.4V3.6M16.4 3.6 12.8 7.2M16.4 3.6 20 7.2"/>',
};

/** 生成内联 SVG 字符串；未知图标回退为圆点，避免渲染崩坏 */
export function icon(name, size = 18, extraClass = '') {
  const body = PATHS[name] || '<circle cx="12" cy="12" r="8"/>';
  const cls = extraClass ? ` class="${extraClass}"` : '';
  return `<svg${cls} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}

/** 故障类别 → 图标名（精确匹配优先） */
export const CATEGORY_ICONS = {
  水电照明: 'zap',
  门窗家具: 'door',
  空调风扇: 'wind',
  '给排水/卫浴': 'droplet',
  多媒体设备: 'monitor',
  墙面地面: 'layers',
  电梯设施: 'elevator',
  其他: 'dots',
};

/**
 * 关键词兜底：管理员改了分类名（如「水电照明」→「水电维修」）或新增分类时，
 * 精确匹配会失配，这里按关键词再试一次，避免图标一律退化成 «dots».
 * 顺序即优先级，先命中的生效。
 */
const CATEGORY_KEYWORDS = [
  // 「电梯」必须排在「电」前面，否则「电梯困人」会被单字「电」抢先匹配成 zap
  ['电梯', 'elevator'],
  ['多媒体', 'monitor'], ['投影', 'monitor'], ['电脑', 'monitor'], ['广播', 'monitor'], ['监控', 'monitor'],
  ['空调', 'wind'], ['风扇', 'wind'], ['通风', 'wind'],
  ['电', 'zap'], ['灯', 'zap'], ['照明', 'zap'],
  ['水', 'droplet'], ['排水', 'droplet'], ['卫浴', 'droplet'], ['管道', 'droplet'], ['厕所', 'droplet'],
  ['门', 'door'], ['窗', 'door'], ['家具', 'door'], ['桌椅', 'door'], ['锁', 'door'],
  ['墙', 'layers'], ['地面', 'layers'], ['地砖', 'layers'], ['油漆', 'layers'],
];

export function categoryIcon(name, size = 15) {
  const n = String(name || '');
  if (CATEGORY_ICONS[n]) return icon(CATEGORY_ICONS[n], size);
  const hit = CATEGORY_KEYWORDS.find(([kw]) => n.includes(kw));
  return icon(hit ? hit[1] : 'dots', size);
}

/** 星级渲染（整数星 + 空心星） */
export function stars(score, size = 16) {
  const n = Math.max(0, Math.min(5, Number(score) || 0));
  return `<span class="stars">${Array.from({ length: 5 }, (_, i) => icon('star', size, i < n ? '' : 'off')).join('')}</span>`;
}

/** 主题管理：初始化 + 切换按钮文案 */
const THEME_KEY = 'bx_theme';
const THEME_ANIM_MS = 320;
let themeAnimTimer = 0;
let themeSpinTimer = 0;

function prefersReducedMotion() {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * 主题切换动画包装器。
 * 支持 View Transitions 时走「从按钮扩散」的圆形揭示；否则退化为全局颜色淡变
 * （依靠短暂的 .theme-anim 类，动画结束即摘除，不做常驻 transition）。
 * 开启「减弱动效」的机器直接跳到终态。
 */
function animateThemeSwitch(apply) {
  const root = document.documentElement;
  if (prefersReducedMotion()) {
    apply();
    return;
  }

  // 按钮图标回弹，两条路径都给
  root.classList.add('theme-switching');
  clearTimeout(themeSpinTimer);
  themeSpinTimer = setTimeout(() => root.classList.remove('theme-switching'), THEME_ANIM_MS + 160);

  // 圆形揭示的圆心 = 主题按钮中心（px 坐标与快照坐标系一致）
  const btn = document.getElementById('themeToggleBtn');
  if (btn && typeof btn.getBoundingClientRect === 'function') {
    const r = btn.getBoundingClientRect();
    root.style.setProperty('--theme-x', `${Math.round(r.left + r.width / 2)}px`);
    root.style.setProperty('--theme-y', `${Math.round(r.top + r.height / 2)}px`);
  }

  if (typeof document.startViewTransition === 'function') {
    try {
      const vt = document.startViewTransition(() => { apply(); });
      // 老浏览器实现可能在 settled 时 reject，吞掉即可，不影响主题结果
      if (vt && vt.finished && typeof vt.finished.catch === 'function') vt.finished.catch(() => {});
      return;
    } catch (_) {
      /* 退化到下面的 CSS 过渡 */
    }
  }

  root.classList.add('theme-anim');
  apply();
  clearTimeout(themeAnimTimer);
  themeAnimTimer = setTimeout(() => root.classList.remove('theme-anim'), THEME_ANIM_MS + 60);
}

export function applyStoredTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = saved || (prefersDark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
  return theme;
}

export function toggleTheme() {
  animateThemeSwitch(() => {
    const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', cur);
    localStorage.setItem(THEME_KEY, cur);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', cur === 'dark' ? '#0e1116' : '#ffffff');
  });
  return currentTheme();
}

export function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

/** 顶栏右上角的主题切换按钮 HTML */
export function themeToggleBtn() {
  return `<button class="icon-btn" id="themeToggleBtn" type="button" aria-label="切换深浅主题" title="切换深浅主题">${icon(currentTheme() === 'dark' ? 'sun' : 'moon', 18)}</button>`;
}

/** 绑定主题按钮事件（需在该按钮插入 DOM 之后调用） */
export function bindThemeToggle(rerender) {
  const btn = document.getElementById('themeToggleBtn');
  if (!btn) return;
  btn.onclick = () => {
    toggleTheme();
    btn.innerHTML = icon(currentTheme() === 'dark' ? 'sun' : 'moon', 18);
    if (typeof rerender === 'function') rerender();
  };
}
