/**
 * 统一 API 客户端
 */

export const STATUS_MAP = {
  pending: { label: '待受理', cls: 'b-pending' },
  assigned: { label: '已派工', cls: 'b-assigned' },
  working: { label: '维修中', cls: 'b-working' },
  done: { label: '待验收', cls: 'b-done' },
  closed: { label: '已结单', cls: 'b-closed' },
  rejected: { label: '已驳回', cls: 'b-rejected' },
};

export async function request(path, options = {}) {
  const { method = 'GET', body, token } = options;
  const headers = options.headers || {};

  if (!headers['Content-Type'] && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const effectiveToken = token || localStorage.getItem('bx_admin_token') || localStorage.getItem('bx_worker_token') || localStorage.getItem('bx_token');
  if (effectiveToken) {
    headers['Authorization'] = `Bearer ${effectiveToken}`;
  }

  const fetchOpts = { method, headers };
  if (body) {
    fetchOpts.body = body instanceof FormData ? body : JSON.stringify(body);
  }

  const res = await fetch(path, fetchOpts);
  const json = await res.json().catch(() => ({}));

  if (!res.ok || json.ok === false) {
    throw new Error(json.msg || '请求处理失败');
  }

  return json.data !== undefined ? json.data : json;
}

export async function uploadImage(file) {
  const formData = new FormData();
  formData.append('file', file);
  return request('/api/upload', {
    method: 'POST',
    body: formData,
  });
}

export async function fetchConfig() {
  return request('/api/config');
}
