/**
 * 通用交互与辅助工具模块
 */

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

export function toast(msg, cb) {
  let box = document.getElementById('toastContainer');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toastContainer';
    document.body.appendChild(box);
  }
  box.innerHTML = `<div class="toast-notice">${escapeHtml(msg)}</div>`;
  setTimeout(() => {
    box.innerHTML = '';
    if (cb) cb();
  }, 2200);
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

export function viewImage(url) {
  openModal(`
    <div style="text-align: center; padding: 10px;">
      <img src="${escapeHtml(url)}" style="max-width: 100%; max-height: 75vh; border-radius: 8px; object-fit: contain; box-shadow: 0 0 20px rgba(0,0,0,0.5);">
      <div style="margin-top: 14px;">
        <button class="btn btn-sm btn-ghost" onclick="window.closeModal()">关闭大图</button>
      </div>
    </div>
  `);
}

export function copyText(text, successMsg = '已复制到剪贴板') {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => toast(successMsg)).catch(() => fallbackCopy(text, successMsg));
  } else {
    fallbackCopy(text, successMsg);
  }
}

function fallbackCopy(text, successMsg) {
  const input = document.createElement('textarea');
  input.value = text;
  document.body.appendChild(input);
  input.select();
  document.execCommand('copy');
  document.body.removeChild(input);
  toast(successMsg);
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

// ----------------- 深浅色模式 (Dark/Light Mode) 管理 -----------------
export function initTheme() {
  const saved = localStorage.getItem('bx_theme') || 'dark'; // 默认智慧后勤深色科技风
  document.documentElement.setAttribute('data-theme', saved);
  setTimeout(updateThemeIcon, 0);
  return saved;
}

export function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('bx_theme', next);
  updateThemeIcon();
  return next;
}

export function updateThemeIcon() {
  const cur = document.documentElement.getAttribute('data-theme') || 'dark';
  document.querySelectorAll('.theme-toggle-btn').forEach((btn) => {
    btn.innerHTML = cur === 'dark' ? '☀️' : '🌙';
    btn.title = cur === 'dark' ? '切换为日光浅色模式' : '切换为后勤指挥中心深色模式';
  });
}

// 暴露全局便捷调用
if (typeof window !== 'undefined') {
  window.closeModal = closeModal;
  window.viewImage = viewImage;
  window.toggleTheme = toggleTheme;
  window.copyText = copyText;
}
