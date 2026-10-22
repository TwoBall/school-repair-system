/**
 * 通用交互与辅助工具模块
 */
import { icon } from './icons.js';

export function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

export function formatTime(ts) {
  if (!ts) return '--';
  const d = new Date(ts);
  const p = (v) => (v < 10 ? '0' : '') + v;
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function formatShortTime(ts) {
  if (!ts) return '--';
  const d = new Date(ts);
  const p = (v) => (v < 10 ? '0' : '') + v;
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function ensureToastBox() {
  let box = document.getElementById('toastContainer');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toastContainer';
    document.body.appendChild(box);
  }
  return box;
}

export function toast(msg, cb) {
  const box = ensureToastBox();
  box.innerHTML = `<div class="toast-notice">${escapeHtml(msg)}</div>`;
  setTimeout(() => {
    box.innerHTML = '';
    if (cb) cb();
  }, 2200);
}

/**
 * 带「重试」按钮的失败提示，用于网络异常等可恢复错误。
 * 停留时间比普通 toast 长，给用户点击重试的机会。
 * @param {string} msg 错误文案
 * @param {Function} onRetry 点击重试的回调
 */
export function toastRetry(msg, onRetry) {
  const box = ensureToastBox();
  box.innerHTML = `
    <div class="toast-notice toast-retry">
      <span class="grow">${escapeHtml(msg)}</span>
      <button type="button" id="toastRetryBtn">重试</button>
    </div>`;
  const btn = document.getElementById('toastRetryBtn');
  if (btn) btn.onclick = () => { box.innerHTML = ''; onRetry(); };
  clearTimeout(box.dataset.t ? Number(box.dataset.t) : undefined);
  box.dataset.t = String(setTimeout(() => { box.innerHTML = ''; }, 8000));
}

/**
 * 执行写操作并显示加载态：失败时按错误类型决定是否给「重试」按钮，
 * 重试会原样再跑一次 task（当前弹窗与已填内容都保留）。
 * @param {HTMLElement|null} btn
 * @param {string} loadingText
 * @param {Function} task
 */
export async function runAction(btn, loadingText, task) {
  const run = async () => {
    await withLoading(btn, loadingText, task);
  };
  try {
    await run();
  } catch (err) {
    reportFailure(err, run);
  }
}

/**
 * 统一收口异步失败：网络类错误给「重试」，业务错误只提示。
 * @param {Error} err
 * @param {Function} retry 重试同一动作
 */
export function reportFailure(err, retry) {
  const msg = err && err.message ? err.message : '操作失败，请重试';
  const canRetry = Boolean(err && err.retryable) && typeof retry === 'function';
  if (canRetry) toastRetry(msg, retry);
  else toast(msg);
}

export function openModal(htmlContent) {
  let box = document.getElementById('modalContainer');
  if (!box) {
    box = document.createElement('div');
    box.id = 'modalContainer';
    document.body.appendChild(box);
  }
  box.innerHTML = `
    <div class="modal-overlay" id="activeModalOverlay">
      <div class="modal-content" onclick="event.stopPropagation()">
        ${htmlContent}
      </div>
    </div>
  `;
  document.getElementById('activeModalOverlay').onclick = closeModal;
}

export function closeModal() {
  const box = document.getElementById('modalContainer');
  if (box) box.innerHTML = '';
}

/* ---------------- 加载态 ---------------- */

/**
 * 统一按钮 loading：自动保存/还原按钮原文案，插入 spinner，防止重复点击。
 * @param {HTMLElement} btn 目标按钮（传 null 时直接执行任务）
 * @param {string} loadingText loading 文案
 * @param {Function} task 异步任务
 */
export async function withLoading(btn, loadingText, task) {
  if (!btn) return task();
  const raw = btn.dataset.rawHtml || btn.innerHTML;
  btn.dataset.rawHtml = raw;
  btn.classList.add('is-loading');
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  btn.innerHTML = `<span class="spinner" aria-hidden="true"></span><span>${escapeHtml(loadingText || '处理中…')}</span>`;
  try {
    return await task();
  } finally {
    btn.disabled = false;
    btn.classList.remove('is-loading');
    btn.removeAttribute('aria-busy');
    btn.innerHTML = raw;
  }
}

/* ---------------- 自定义对话弹窗 ---------------- */

function bindDialogEvents(overlay, finish) {
  overlay.onclick = () => finish(false);
  overlay.querySelectorAll('[data-act]').forEach((el) => {
    el.onclick = (ev) => {
      ev.stopPropagation();
      finish(el.dataset.act === 'ok');
    };
  });
  const onKey = (e) => {
    if (e.key === 'Escape') finish(false);
  };
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}

/**
 * 确认弹窗，取代原生 confirm()
 * @returns {Promise<boolean>}
 */
export function confirmDialog({
  title = '确认操作',
  desc = '',
  okText = '确定',
  cancelText = '取消',
  danger = false,
  iconName = 'alert',
} = {}) {
  return new Promise((resolve) => {
    openModal(`
      <div class="modal-header">
        <h3>${icon(iconName, 18)}${escapeHtml(title)}</h3>
        <button class="modal-close-btn" type="button" data-act="cancel" aria-label="关闭">${icon('close', 16)}</button>
      </div>
      <div class="modal-body">
        ${desc ? `<p class="confirm-desc${danger ? ' danger' : ''}">${escapeHtml(desc)}</p>` : ''}
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" type="button" data-act="cancel">${escapeHtml(cancelText)}</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" type="button" data-act="ok">${escapeHtml(okText)}</button>
      </div>
    `);
    const overlay = document.getElementById('activeModalOverlay');
    let dispose = () => {};
    const finish = (v) => {
      dispose();
      closeModal();
      resolve(v);
    };
    dispose = bindDialogEvents(overlay, finish);
    const okBtn = overlay.querySelector('[data-act="ok"]');
    if (okBtn) okBtn.focus();
  });
}

/**
 * 输入弹窗，取代原生 prompt()，支持校验、多行、字数上限
 * @returns {Promise<string|null>} 取消时返回 null
 */
export function promptDialog({
  title = '请输入',
  desc = '',
  label = '',
  value = '',
  placeholder = '',
  rows = 0,
  maxlength = 0,
  okText = '确定',
  cancelText = '取消',
  iconName = 'edit',
  validate = null,
} = {}) {
  const inputId = 'dlgInput_' + Math.random().toString(36).slice(2, 8);
  const maxAttr = maxlength ? `maxlength="${maxlength}"` : '';
  const control = rows > 0
    ? `<textarea class="control" id="${inputId}" rows="${rows}" ${maxAttr} placeholder="${escapeHtml(placeholder)}">${escapeHtml(value)}</textarea>`
    : `<input class="control" type="text" id="${inputId}" value="${escapeHtml(value)}" ${maxAttr} placeholder="${escapeHtml(placeholder)}" autocomplete="off">`;

  return new Promise((resolve) => {
    openModal(`
      <div class="modal-header">
        <h3>${icon(iconName, 18)}${escapeHtml(title)}</h3>
        <button class="modal-close-btn" type="button" data-act="cancel" aria-label="关闭">${icon('close', 16)}</button>
      </div>
      <div class="modal-body">
        ${desc ? `<p class="confirm-desc">${escapeHtml(desc)}</p>` : ''}
        <div class="field">
          ${label ? `<label class="label" for="${inputId}">${escapeHtml(label)}</label>` : ''}
          ${control}
          <div class="field-error d-none" id="${inputId}_err"></div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" type="button" data-act="cancel">${escapeHtml(cancelText)}</button>
        <button class="btn btn-primary" type="button" data-act="ok">${escapeHtml(okText)}</button>
      </div>
    `);

    const overlay = document.getElementById('activeModalOverlay');
    const input = overlay.querySelector(`#${inputId}`);
    const errBox = overlay.querySelector(`#${inputId}_err`);
    if (input) setTimeout(() => input.focus(), 30);

    const showError = (msg) => {
      if (!errBox) return;
      if (msg) {
        errBox.textContent = msg;
        errBox.classList.remove('d-none');
        input && input.classList.add('invalid');
      } else {
        errBox.textContent = '';
        errBox.classList.add('d-none');
        input && input.classList.remove('invalid');
      }
    };

    const submit = () => {
      if (!input) return finish(null);
      const val = input.value.trim();
      if (!val) {
        showError('此项为必填内容');
        input.focus();
        return;
      }
      if (validate) {
        const msg = validate(val);
        if (msg) {
          showError(msg);
          input.focus();
          return;
        }
      }
      finish(val);
    };

    let dispose = () => {};
    const finish = (v) => {
      dispose();
      closeModal();
      resolve(v);
    };
    dispose = bindDialogEvents(overlay, finish);

    overlay.querySelector('[data-act="ok"]').onclick = (ev) => {
      ev.stopPropagation();
      submit();
    };
    if (rows === 0 && input) {
      input.onkeydown = (e) => {
        if (e.key === 'Enter') submit();
      };
    }
    if (input) {
      input.oninput = () => showError('');
    }
  });
}

/* ---------------- 图片压缩与带进度上传 ---------------- */

/**
 * canvas 压缩图片：长边缩到 maxEdge 内，JPEG quality 输出。
 * 动图与小图原样返回，避免损坏和无意义压缩。
 */
export function compressImage(file, { maxEdge = 1600, quality = 0.82 } = {}) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type) return resolve(file);
    if (file.type === 'image/gif') return resolve(file);
    if (file.size < 300 * 1024) return resolve(file);

    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        let { width, height } = img;
        if (!width || !height) return resolve(file);
        const scale = Math.min(1, maxEdge / Math.max(width, height));
        const w = Math.round(width * scale);
        const h = Math.round(height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => {
          if (!blob) return resolve(file);
          // 压缩后反而变大时，仍用原图
          if (blob.size >= file.size) return resolve(file);
          const name = String(file.name || 'photo').replace(/\.\w+$/, '') + '.jpg';
          resolve(new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() }));
        }, 'image/jpeg', quality);
      } catch (err) {
        resolve(file);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片读取失败，请换一张重试'));
    };
    img.src = url;
  });
}

/**
 * XHR 上传，支持实时进度百分比
 * @returns {Promise<{url:string}>}
 */
function uploadWithProgress(file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');
    xhr.timeout = 60000;
    const token = localStorage.getItem('bx_admin_token')
      || localStorage.getItem('bx_worker_token')
      || localStorage.getItem('bx_token');
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.min(99, Math.round((e.loaded / e.total) * 100)));
      }
    };
    xhr.onload = () => {
      let json = null;
      try {
        json = JSON.parse(xhr.responseText);
      } catch (e) {
        return reject(new Error('服务器返回异常，请稍后重试'));
      }
      if (xhr.status >= 200 && xhr.status < 300 && json.ok !== false) {
        onProgress && onProgress(100);
        resolve(json.data !== undefined ? json.data : json);
      } else {
        reject(new Error(json.msg || '上传失败，请重试'));
      }
    };
    xhr.onerror = () => reject(new Error('网络连接失败，请检查网络后重试'));
    xhr.ontimeout = () => reject(new Error('上传超时，请重试'));

    const fd = new FormData();
    fd.append('file', file);
    xhr.send(fd);
  });
}

/** 压缩 + 上传一体流程 */
export async function uploadPhoto(file, { onProgress, maxEdge, quality } = {}) {
  if (!file) throw new Error('未选择图片');
  if (file.size > 12 * 1024 * 1024) throw new Error('图片过大（上限 12MB）');
  const compressed = await compressImage(file, { maxEdge, quality });
  return uploadWithProgress(compressed, onProgress);
}

/** 正在上传的占位缩略图 */
export function uploadingTile(id, label = '上传中') {
  return `<div class="photo-item uploading" id="${id}">
    <div class="upload-box"><span class="spinner lg" aria-hidden="true"></span><em class="upload-pct">0%</em></div>
    <span class="upload-label">${escapeHtml(label)}</span>
  </div>`;
}

/** 刷新上传占位图进度 */
export function updateUploadTile(id, pct) {
  const el = document.getElementById(id);
  if (!el) return;
  const pctEl = el.querySelector('.upload-pct');
  if (pctEl) pctEl.textContent = `${pct}%`;
  el.style.setProperty('--p', `${pct}%`);
}

export function viewImage(url) {
  openModal(`
    <div class="modal-header">
      <h3>${icon('image', 18)}查看照片</h3>
      <button class="modal-close-btn" type="button" data-act="modal-close" aria-label="关闭">${icon('close', 16)}</button>
    </div>
    <div class="modal-body text-center">
      <img class="img-viewer" src="${escapeHtml(url)}" alt="报修现场照片">
    </div>
  `);
}

export function exportToCsv(filename, headers, rows) {
  const allRows = [headers, ...rows];
  const csvContent = '\uFEFF' + allRows.map((r) => r.map((cell) => `"${String(cell == null ? '' : cell).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `报修导出_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  toast('已生成 CSV 导出文件！');
}

/**
 * 事件委托：把 [data-act] 元素的点击 / 键盘操作分发到处理函数，替代 onclick="window.xxx()"。
 * @param {Record<string, Function>} map act 名 -> 处理函数 ({id,idx,src,val}, el, ev) => void
 * @param {Document|HTMLElement} root 委托根节点，默认 document
 */
export function delegateActions(map, root = document) {
  const hit = (target) => {
    if (!(target instanceof Element)) return null;
    const el = target.closest('[data-act]');
    if (!el || !root.contains(el)) return null;
    const name = el.dataset.act;
    if (!Object.prototype.hasOwnProperty.call(map, name)) return null;
    return {
      el,
      name,
      data: { id: el.dataset.id, idx: el.dataset.idx, src: el.dataset.src, val: el.dataset.val },
    };
  };
  root.addEventListener('click', (ev) => {
    const h = hit(ev.target);
    if (!h) return;
    const isSubmitBtn = h.el.tagName === 'BUTTON' && h.el.type === 'submit';
    if (!isSubmitBtn) ev.preventDefault();
    map[h.name](h.data, h.el, ev);
  });
  // role="button" 的非原生元素补键盘可达性（Enter / Space）
  root.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const h = hit(ev.target);
    if (!h) return;
    if (h.el.tagName === 'BUTTON' || h.el.tagName === 'A') return; // 原生已自带
    ev.preventDefault();
    map[h.name](h.data, h.el, ev);
  });
}

/**
 * 列表轮询器：页面可见时按固定间隔静默刷新；切后台自动暂停，切回来立刻补拉一次。
 * @param {Function} task 刷新任务；返回 false 表示本次跳过（例如当前不在该标签页）
 * @param {number} intervalMs 轮询间隔
 * @param {Function} onDone 每次成功刷新后的回调，用于更新"最后更新时间"
 */
export function createPoller(task, intervalMs = 30000, onDone) {
  let timer = null;
  let running = false;
  let destroyed = false;
  let lastOkAt = 0;

  const tick = async () => {
    if (destroyed || running || document.hidden) return;
    running = true;
    try {
      const r = await task();
      if (r !== false) {
        lastOkAt = Date.now();
        if (onDone) onDone(lastOkAt);
      }
    } catch {
      /* 轮询失败静默处理，不打扰用户 */
    } finally {
      running = false;
    }
  };

  const start = () => {
    if (destroyed || timer) return;
    timer = setInterval(tick, intervalMs);
  };
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else {
      tick();
      start();
    }
  });

  start();
  return {
    refresh: tick,
    stop,
    destroy: () => {
      destroyed = true;
      stop();
    },
    get lastOkAt() {
      return lastOkAt;
    },
  };
}

/** 把时间戳渲染成"刚刚 / N 分钟前"的相对文案 */
export function relTimeFrom(ts) {
  if (!ts) return '尚未刷新';
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 10) return '刚刚更新';
  if (diff < 60) return `${diff} 秒前更新`;
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前更新`;
  return `${Math.floor(diff / 3600)} 小时前更新`;
}

/**
 * 把 .chips-group 升级为 WAI-ARIA 单选组：补齐 role / aria-checked /
 * roving tabindex，并支持方向键、Home、End 选择。原来纯 span 的点选组
 * 对读屏和键盘用户完全不可见，一概走这里。
 *
 * @param {HTMLElement} box chips 容器
 * @param {object} opts
 * @param {string} opts.valueKey 取值用的 data-* 后缀，默认 'val'
 * @param {string} [opts.label] 无可见标题时的可读名称
 * @param {string} [opts.labelId] 可见标题元素 id，用于 aria-labelledby
 * @param {(value: string, chip: HTMLElement) => void} [opts.onChange]
 */
export function bindChipRadioGroup(box, { valueKey = 'val', label, labelId, onChange } = {}) {
  if (!box) return;
  box.setAttribute('role', 'radiogroup');
  if (labelId) box.setAttribute('aria-labelledby', labelId);
  else if (label) box.setAttribute('aria-label', label);

  const chips = () => Array.from(box.querySelectorAll('.chip'));

  const paint = () => {
    chips().forEach((c) => {
      const on = c.classList.contains('active');
      c.setAttribute('role', 'radio');
      c.setAttribute('aria-checked', on ? 'true' : 'false');
      c.tabIndex = on ? 0 : -1;
    });
  };

  const select = (chip) => {
    if (!chip) return;
    chips().forEach((c) => c.classList.toggle('active', c === chip));
    paint();
    chip.focus();
    if (onChange) onChange(chip.dataset[valueKey], chip);
  };

  box.onclick = (e) => {
    const chip = e.target.closest('.chip');
    if (chip) select(chip);
  };

  box.onkeydown = (e) => {
    const navKeys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
    if (!navKeys.includes(e.key)) return;
    const list = chips();
    const cur = list.indexOf(document.activeElement.closest('.chip'));
    if (cur === -1) return;
    e.preventDefault();
    let next = 0;
    if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = list.length - 1;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (cur + 1) % list.length;
    else next = (cur - 1 + list.length) % list.length;
    select(list[next]);
  };

  paint();
}
