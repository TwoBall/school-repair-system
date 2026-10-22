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

/** 请求超时时间（毫秒） */
const DEFAULT_TIMEOUT = 20000;

/** 判断错误是否值得让用户重试（网络中断 / 超时 / 服务端 5xx） */
export function isRetryableError(err) {
  return Boolean(err && err.retryable);
}

export async function request(path, options = {}) {
  const { method = 'GET', body, token, timeout = DEFAULT_TIMEOUT } = options;
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

  // 超时控制 + 网络异常归一化，让上层可以安全地提示"重试"
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let res;
  try {
    res = await fetch(path, { ...fetchOpts, signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      throw Object.assign(new Error('请求超时，请检查网络后重试'), { isTimeout: true, retryable: true });
    }
    throw Object.assign(new Error('网络连接失败，请检查网络后重试'), { isNetwork: true, retryable: true });
  }
  clearTimeout(timer);

  const json = await res.json().catch(() => ({}));

  if (!res.ok || json.ok === false) {
    const err = new Error(json.msg || '请求处理失败');
    err.status = res.status;
    err.isAuth = res.status === 401 || res.status === 403;
    err.retryable = res.status >= 500; // 服务端异常可重试，业务报错不行
    throw err;
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
