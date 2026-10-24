/**
 * Cloudflare Pages Functions - 全局后端 API 路由网关
 * 运行在 Cloudflare Edge V8 环境中，直连 Cloudflare D1 (SQLite) 与 R2 存储
 */

// 跨域及响应头配置
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-admin-key, x-worker-key',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...CORS_HEADERS,
    },
  });
}

const ok = (data = null, msg = 'ok') => json({ ok: true, msg, data });
const fail = (msg = 'error', status = 400) => json({ ok: false, msg }, status);

// ------------------- 数据库与表初始化 -------------------
const INIT_SQL = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS workers (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL, name TEXT NOT NULL, skill TEXT, phone TEXT, active INTEGER DEFAULT 1, createdAt INTEGER);
CREATE TABLE IF NOT EXISTS buildings (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, sortOrder INTEGER DEFAULT 0, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, sortOrder INTEGER DEFAULT 0, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS tickets (id TEXT PRIMARY KEY, day TEXT, createdAt INTEGER, building TEXT, room TEXT, category TEXT, urgency TEXT, desc TEXT, reporter TEXT, phone TEXT, identity TEXT, photos TEXT, status TEXT, assignee TEXT, timeline TEXT, rating TEXT, completedAt INTEGER, closedAt INTEGER, result TEXT, material TEXT, materialSource TEXT, finishPhotos TEXT, lastRemindAt INTEGER DEFAULT 0, remindCount INTEGER DEFAULT 0, batchToken TEXT, batchSize INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS ticket_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, ticketId TEXT NOT NULL, senderRole TEXT NOT NULL, senderName TEXT NOT NULL, content TEXT NOT NULL, createdAt INTEGER NOT NULL);
-- 提交幂等表：同一个 clientToken 只会生成一条工单，网络重试不会出双份
CREATE TABLE IF NOT EXISTS ticket_dedup (clientToken TEXT PRIMARY KEY, ticketId TEXT NOT NULL, createdAt INTEGER);
CREATE INDEX IF NOT EXISTS idx_dedup_createdAt ON ticket_dedup(createdAt);
CREATE INDEX IF NOT EXISTS idx_tickets_batch ON tickets(batchToken);
-- 这四个索引原本只写在 schema.sql 里，而线上库是这里自动建的，等于一直没有：
-- phone / status / assignee 恰好是最高频的三个查询条件（报修人查单与判重、师傅端轮询、管理端筛选）
CREATE INDEX IF NOT EXISTS idx_tickets_phone ON tickets(phone);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_assignee ON tickets(assignee);
CREATE INDEX IF NOT EXISTS idx_tickets_createdAt ON tickets(createdAt);
`;

// 楼栋字典（编号 + 用途）。A=教学楼 / B=实训楼 / C=宿舍
const DEFAULT_BUILDINGS = [
  'A1 教学楼', 'A2 教学楼', 'A3 教学楼', 'A4 教学楼',
  'B1 实训楼', 'B2 实训楼',
  'C1 学生宿舍', 'C2 学生宿舍', 'C3 学生宿舍', 'C4 学生宿舍',
  'C5 学生宿舍', 'C6 学生宿舍', 'C7 教师宿舍',
];

const DEFAULT_CATEGORIES = ['水电照明', '门窗家具', '空调风扇', '给排水/卫浴', '多媒体设备', '墙面地面', '电梯设施', '其他'];

// 紧急度只有三档。催办阈值（urgency === '紧急'）、Webhook 标题、管理端筛选、列表高亮
// 全部依赖这三个字面量，接口可被直调，必须在写入侧兜住，否则会落进库里变成筛不出的脏值。
const URGENCY_LEVELS = ['普通', '较急', '紧急'];
const IDENTITIES = ['教职工', '职工', '学生', '访客'];

// 上传上限。前端压缩后一般 300KB 以内，放宽到 10MB 兜住直接拍照的原图
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
// 文本字段长度上限，防止直调接口灌超长文本撑爆 D1 单行（1MB 硬限）
const MAX_LEN = { desc: 500, result: 500, reporter: 20, room: 30, note: 100, comment: 200, material: 200 };

let schemaChecked = false;
async function ensureSchema(db) {
  if (schemaChecked) return;
  try {
    await db.exec(INIT_SQL);
    // 检查是否有数据，若没有则插入默认种子数据
    const countRes = await db.prepare('SELECT count(*) as c FROM workers').first();
    if (!countRes || countRes.c === 0) {
      await seedDefaults(db);
    }
    await normalizeLegacyUrgency(db);
    schemaChecked = true;
  } catch (e) {
    console.error('ensureSchema error:', e);
  }
}

let urgencyNormalized = false;
/**
 * 历史脏值订正（幂等）：早期接口没校验紧急度，落进过 normal 之类不在三档内的值，
 * 结果管理端按「普通」筛选时这几条筛不出来。这里兜一次让老数据自愈，
 * 免得为了几条测试数据去线上手工 UPDATE。
 */
async function normalizeLegacyUrgency(db) {
  if (urgencyNormalized) return;
  try {
    const r = await db.prepare(
      "UPDATE tickets SET urgency = '普通' WHERE urgency IS NULL OR urgency NOT IN ('普通', '较急', '紧急')"
    ).run();
    const n = (r && ((r.meta && r.meta.changes) || r.changes)) || 0;
    if (n) console.log('normalizeLegacyUrgency: 订正历史紧急度', n, '条');
  } catch (e) {
    console.error('normalizeLegacyUrgency error:', e);
  }
  urgencyNormalized = true; // 失败也别每个请求都重试
}

async function seedDefaults(db) {
  const now = Date.now();
  // 默认配置
  const stmts = [
    db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').bind('admin_password', 'admin888'),
    db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').bind('worker_common_key', 'worker888'),
    db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').bind('sla_pending_hours', '4'),
    db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').bind('sla_accept_hours', '8'),
    db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').bind('sla_finish_hours', '24'),
    db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').bind('webhook_type', 'none'),
    db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').bind('webhook_url', ''),
    db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').bind('school_name', '学校总务报修服务中心'),
  ];

  // 默认师傅
  const workers = [
    ['w1', '13800000001', 'worker888', '张建国', '水电照明、给排水', '13800000001', 1, now],
    ['w2', '13800000002', 'worker888', '李国强', '门窗家具、墙面地面', '13800000002', 1, now],
    ['w3', '13800000003', 'worker888', '王海', '空调电器、多媒体设备', '13800000003', 1, now],
    ['w4', '13800000004', 'worker888', '赵永发', '综合维修、电梯设施', '13800000004', 1, now],
  ];
  for (const w of workers) {
    stmts.push(db.prepare('INSERT INTO workers (id, username, password, name, skill, phone, active, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(...w));
  }

  // 楼栋
  DEFAULT_BUILDINGS.forEach((b, i) => {
    stmts.push(db.prepare('INSERT INTO buildings (name, sortOrder, active) VALUES (?, ?, 1)').bind(b, i + 1));
  });

  // 默认分类
  DEFAULT_CATEGORIES.forEach((c, i) => {
    stmts.push(db.prepare('INSERT INTO categories (name, sortOrder, active) VALUES (?, ?, 1)').bind(c, i + 1));
  });

  await db.batch(stmts);
}

// ------------------- 身份鉴权与 Token -------------------
function uint8ToBase64(uint8) {
  let binary = '';
  const len = uint8.byteLength;
  const CHUNK_SZ = 8192;
  for (let i = 0; i < len; i += CHUNK_SZ) {
    binary += String.fromCharCode.apply(null, uint8.subarray(i, Math.min(i + CHUNK_SZ, len)));
  }
  return btoa(binary);
}

function utf8ToBase64(str) {
  return uint8ToBase64(new TextEncoder().encode(str));
}

function base64ToUtf8(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

/**
 * 签名密钥。优先读 Pages 环境变量 JWT_SECRET。
 *
 * 没配时**不能**只用进程内随机密钥：Cloudflare 是多节点分布，登录请求在 A 节点签发、
 * 下一个请求落到 B 节点就验不过（实测表现：登录成功但后续全部 401）。
 * 所以未配置时生成一次随机密钥并**写进 D1 settings 持久化**，各节点共享同一份。
 * 源码里那个硬编码密钥已随仓库公开，绝不能再回落到固定字符串。
 */
let cachedSecret = '';
async function getJwtSecret(env) {
  if (env && env.JWT_SECRET) return env.JWT_SECRET;
  if (cachedSecret) return cachedSecret;

  const db = env && (env.DB || env.D1);
  if (!db) {
    // 拿不到库（本地测试）时只能退化为进程内随机
    const b = new Uint8Array(32);
    crypto.getRandomValues(b);
    cachedSecret = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return cachedSecret;
  }

  try {
    const row = await db.prepare("SELECT value FROM settings WHERE key = 'jwt_secret'").first();
    if (row && row.value) {
      cachedSecret = row.value;
      return cachedSecret;
    }
  } catch (e) {
    console.error('read jwt_secret failed:', e);
  }

  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  cachedSecret = Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
  try {
    await db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind('jwt_secret', cachedSecret).run();
    console.warn('[auth] 未配置 JWT_SECRET，已在数据库中生成并持久化随机密钥');
  } catch (e) {
    console.error('persist jwt_secret failed:', e);
  }
  return cachedSecret;
}

/** base64url → 字节，容忍缺 padding 与 -_ 两种字母表 */
function base64ToBytes(b64) {
  let s = String(b64).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const binary = atob(s);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function createToken(payload, env) {
  const secret = await getJwtSecret(env);
  const header = utf8ToBase64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const data = utf8ToBase64(JSON.stringify(payload));
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(header + "." + data));
  const sig = uint8ToBase64(new Uint8Array(signature));
  return header + "." + data + "." + sig;
}

/**
 * 校验签名后再解 payload。以前只 base64 解 payload、从不看第三段，
 * 任何人都能手搓一个 {role:'admin'} 的 token 直接接管系统。
 */
async function verifyToken(token, env) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(await getJwtSecret(env)),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const valid = await crypto.subtle.verify('HMAC', key, base64ToBytes(parts[2]), enc.encode(parts[0] + "." + parts[1]));
    if (!valid) return null;
    const payload = JSON.parse(base64ToUtf8(parts[1]));
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload;
  } catch (e) {
    return null;
  }
}
async function checkAdmin(request, env) {
  const db = env.DB || env.D1;
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind('admin_password').first();
  const adminPwd = (row && row.value) || 'admin888';

  const authHeader = request.headers.get('Authorization') || '';
  if (authHeader.startsWith('Bearer ')) {
    const payload = await verifyToken(authHeader.slice(7).trim(), env);
    if (payload && payload.role === 'admin') return true;
  }

  const keyHeader = request.headers.get('x-admin-key');
  if (keyHeader && keyHeader === adminPwd) return true;

  return false;
}

/** 取出带指定角色的 token payload，不匹配返回 null */
async function requireRole(request, env, role) {
  const h = request.headers.get('Authorization') || '';
  const p = h.startsWith('Bearer ') ? await verifyToken(h.slice(7).trim(), env) : null;
  return p && p.role === role ? p : null;
}

// ------------------- SLA 计算与工单格式化 -------------------
function formatTicket(t, settings = {}) {
  if (!t) return null;
  const now = Date.now();
  let photos = [], timeline = [], rating = null, finishPhotos = [];
  try { photos = JSON.parse(t.photos || '[]'); } catch (e) {}
  try { timeline = JSON.parse(t.timeline || '[]'); } catch (e) {}
  try { rating = JSON.parse(t.rating || 'null'); } catch (e) {}
  try { finishPhotos = JSON.parse(t.finishPhotos || '[]'); } catch (e) {}

  const pendingHours = parseFloat(settings.sla_pending_hours) || 4;
  const acceptHours = parseFloat(settings.sla_accept_hours) || 8;
  const finishHours = parseFloat(settings.sla_finish_hours) || 24;

  let isTimeout = false;
  let timeoutReason = '';

  if (t.status === 'pending') {
    const limit = t.urgency === '紧急' ? Math.min(2, pendingHours) : pendingHours;
    if (now - t.createdAt > limit * 3600000) {
      isTimeout = true;
      const overH = Math.round(((now - t.createdAt - limit * 3600000) / 3600000) * 10) / 10;
      timeoutReason = `超期待受理 (${overH}h)`;
    }
  } else if (t.status === 'assigned') {
    let assignTime = t.createdAt;
    for (let i = timeline.length - 1; i >= 0; i--) {
      if (timeline[i].action && timeline[i].action.includes('派单')) {
        assignTime = timeline[i].t;
        break;
      }
    }
    if (now - assignTime > acceptHours * 3600000) {
      isTimeout = true;
      const overH = Math.round(((now - assignTime - acceptHours * 3600000) / 3600000) * 10) / 10;
      timeoutReason = `超时未接单 (${overH}h)`;
    }
  } else if (t.status === 'working') {
    let workTime = t.createdAt;
    for (let i = timeline.length - 1; i >= 0; i--) {
      if (timeline[i].action && timeline[i].action.includes('接单')) {
        workTime = timeline[i].t;
        break;
      }
    }
    if (now - workTime > finishHours * 3600000) {
      isTimeout = true;
      const overH = Math.round(((now - workTime - finishHours * 3600000) / 3600000) * 10) / 10;
      timeoutReason = `超时未完工 (${overH}h)`;
    }
  }

  return {
    ...t,
    photos,
    timeline,
    rating,
    finishPhotos,
    material: t.material || '',
    materialSource: t.materialSource || '',
    batchToken: t.batchToken || '',
    batchSize: t.batchSize || 1,
    isTimeout,
    timeoutReason,
  };
}

/**
 * 照片白名单校验：只接受本站上传路径或图片 data URL。
 * 返回 null 表示不合法；R2 未绑定时前端会传 base64，故一并放行但限总量。
 */
function sanitizePhotos(input) {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) return null;
  if (input.length > 3) return null;
  const out = [];
  let total = 0;
  for (const p of input) {
    if (typeof p !== 'string') return null;
    total += p.length;
    // 单条上限 200KB、整单上限 500KB，防止 base64 撑爆 D1 单行（硬限 1MB）
    if (p.length > 200000 || total > 500000) return null;
    const ok = p.startsWith('/api/uploads/') || /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(p);
    if (!ok) return null;
    out.push(p);
  }
  return out;
}

/**
 * 字典项上移/下移：把整表按 sortOrder 重新编号，避免相邻两项 sortOrder 相同时挪不动。
 * table 只接受调用方传入的固定字面量（buildings / categories）。
 */
async function moveDictItem(db, table, id, dir) {
  const rows = (await db.prepare(`SELECT id, sortOrder FROM ${table} ORDER BY sortOrder ASC, id ASC`).all()).results || [];
  const idx = rows.findIndex((r) => String(r.id) === String(id));
  if (idx < 0) return false;
  const target = dir === 'up' ? idx - 1 : idx + 1;
  if (target < 0 || target >= rows.length) return false; // 已在边界，直接忽略

  const arr = rows.slice();
  const tmp = arr[idx];
  arr[idx] = arr[target];
  arr[target] = tmp;

  // 重新编号为 10、20、30…，顺便把历史遗留的重复值理顺
  const stmts = arr.map((r, i) => db.prepare(`UPDATE ${table} SET sortOrder = ? WHERE id = ?`).bind((i + 1) * 10, r.id));
  await db.batch(stmts);
  return true;
}

// ------------------- 角色鉴权与脱敏 -------------------
// 前端 token 解密后带 role，用来区分"自己看自己"和"管理员看全部"
async function getAuthRole(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const payload = await verifyToken(authHeader.slice(7).trim(), env);
  return payload && payload.role ? payload.role : null;
}

// 未鉴权的公开请求里把手机号打码（138****0001），避免任何人拉一遍列表就能拿到全校联系方式
function maskPhone(v) {
  const s = String(v || '');
  return s.length >= 7 ? s.slice(0, 3) + '****' + s.slice(-4) : s;
}

/**
 * 只有管理员能看全号。以前「带了 ?phone= 就算本人查询」也放行全号，
 * 但报修人端根本不登录、无从证明机主身份，等于谁都能遍历号段把全校联系方式拉走。
 * 而且这个全号前端压根没用到：列表卡片不显示手机号，详情走单条查询本来就会打码。
 */
async function publicView(request, env, tickets) {
  const role = await getAuthRole(request, env);
  if (role === 'admin') return tickets;
  return tickets.map((t) => ({ ...t, phone: maskPhone(t.phone) }));
}

// ------------------- Webhook 消息通知 -------------------
async function sendWebhook(settings, eventType, data) {
  const type = settings.webhook_type;
  let url = settings.webhook_url;
  const secret = settings.webhook_secret || '';

  if (!type || type === 'none' || !url) return;

  try {
    const timeStr = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    let title = '总务报修提醒';
    let text = '';

    if (eventType === 'ticket_create') {
      title = `📢 新报修申请【${data.urgency || '普通'}】`;
      text = `### 📢 新报修工单提交\n\n- **工单编号**：${data.id}\n- **报修地点**：${data.building} ${data.room}\n- **故障类型**：${data.category}\n- **紧急程度**：${data.urgency}\n- **报修人员**：${data.reporter} (${data.identity || '人员'}) 📱 ${data.phone}\n- **故障描述**：${data.desc}\n- **提交时间**：${timeStr}\n\n> 请总务处值班老师及时受理并指派维修师傅。`;
    } else if (eventType === 'ticket_assign') {
      title = `🔧 报修派工提醒【${data.assignee}】`;
      text = `### 🔧 报修工单已派工\n\n- **工单编号**：${data.id}\n- **地点**：${data.building} ${data.room}\n- **指派师傅**：${data.assignee}\n- **故障描述**：${data.desc}\n- **派工备注**：${data.note || '无'}\n- **派工时间**：${timeStr}`;
    } else if (eventType === 'ticket_remind') {
      title = `⚠️ 报修加急催单提醒！`;
      text = `### ⚠️【加急催单】报修人正在催单！\n\n- **工单编号**：${data.id}\n- **报修地点**：${data.building} ${data.room}\n- **报修人**：${data.reporter} 📱 ${data.phone}\n- **负责人**：${data.assignee || '未派工'}\n- **说明**：${data.note || '急需处理'}\n- **累计催单**：${data.remindCount || 1} 次`;
    } else if (eventType === 'ticket_finish') {
      title = `✅ 维修已完工【待验收】`;
      text = `### ✅ 维修已完工，等待验收\n\n- **工单编号**：${data.id}\n- **地点**：${data.building} ${data.room}\n- **维修人员**：${data.assignee}\n- **处理结果**：${data.result}\n- **耗材/配件**：${data.material || '无'}\n- **配件购方**：${data.materialSource || '无'}\n- **完工时间**：${timeStr}`;
    } else if (eventType === 'ticket_rate') {
      title = `⭐ 报修已评价结单`;
      text = `### ⭐ 报修工单已验收结单\n\n- **工单编号**：${data.id}\n- **评价得分**：${'⭐'.repeat(data.score || 5)} (${data.score}分)\n- **评价反馈**：${data.comment || '满意'}`;
    } else if (eventType === 'ticket_accept') {
      title = `🛠 师傅已接单【${data.assignee}】`;
      text = `### 🛠 师傅已接单并到场\n\n- **工单编号**：${data.id}\n- **报修地点**：${data.building} ${data.room}\n- **故障类型**：${data.category}\n- **维修人员**：${data.assignee}\n- **接单时间**：${timeStr}\n\n> 维修已启动，完工后系统将通知报修人验收。`;
    } else if (eventType === 'ticket_reject') {
      title = `🚫 工单已驳回【${data.id}】`;
      text = `### 🚫 工单被总务处驳回\n\n- **工单编号**：${data.id}\n- **报修地点**：${data.building} ${data.room}\n- **故障类型**：${data.category}\n- **报修人**：${data.reporter}\n- **驳回原因**：${data.note || '不在维修范围或重复报修'}\n- **处理时间**：${timeStr}`;
    } else if (eventType === 'test') {
      title = `🎉 Cloudflare Pages Webhook 连通测试`;
      text = `### 🎉 Cloudflare Pages + D1 报修系统 Webhook 测试成功！\n\n- **通道**：${type}\n- **时间**：${timeStr}\n\n> 边缘计算节点已成功触发消息推送！`;
    }

    let payload = null;
    if (type === 'wecom') {
      payload = { msgtype: 'markdown', markdown: { content: text } };
    } else if (type === 'dingtalk') {
      if (secret) {
        const timestamp = Date.now();
        const stringToSign = `${timestamp}\n${secret}`;
        const enc = new TextEncoder();
        const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        const sig = await crypto.subtle.sign('HMAC', key, enc.encode(stringToSign));
        const sign = encodeURIComponent(btoa(String.fromCharCode(...new Uint8Array(sig))));
        url += (url.includes('?') ? '&' : '?') + `timestamp=${timestamp}&sign=${sign}`;
      }
      payload = { msgtype: 'markdown', markdown: { title, text } };
    } else if (type === 'feishu') {
      payload = {
        msg_type: 'interactive',
        card: {
          header: { title: { tag: 'plain_text', content: title }, template: eventType === 'ticket_remind' ? 'red' : 'blue' },
          elements: [{ tag: 'div', text: { tag: 'lark_md', content: text } }],
        },
      };
    } else {
      payload = { event: eventType, title, text, timestamp: Date.now(), data };
    }

    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error('Webhook error:', err);
  }
}

// ------------------- Pages Functions 主入口 -------------------
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  /**
   * 把旁支的异步任务托管给平台的 waitUntil。
   * Webhook 以前是 sendWebhook(...).catch(() => {}) 丢出去不管，
   * Cloudflare 在响应返回后可能直接掐断未决子请求 —— 通知会静默丢失。
   */
  const notify = (p) => {
    const task = Promise.resolve(p).catch(() => {});
    if (typeof context.waitUntil === 'function') context.waitUntil(task);
    return task;
  };

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // 必须绑定 D1 数据库
  const db = env.DB || env.D1;
  if (!db) {
    return fail('Cloudflare D1 数据库尚未绑定！请在 Pages 控制台 -> Settings -> Functions -> D1 Database Bindings 中添加名为 DB 的数据库绑定。', 500);
  }

  await ensureSchema(db);

  try {
    // 1. 系统健康与配置
    if (path === '/api/health') {
      return ok({ status: 'healthy', edge: 'Cloudflare Workers/Pages', time: Date.now() });
    }

    if (path === '/api/config') {
      const sRows = (await db.prepare('SELECT key, value FROM settings').all()).results || [];
      const sMap = {};
      sRows.forEach((r) => (sMap[r.key] = r.value));

      const bRows = (await db.prepare('SELECT name FROM buildings WHERE active = 1 ORDER BY sortOrder ASC').all()).results || [];
      const cRows = (await db.prepare('SELECT name FROM categories WHERE active = 1 ORDER BY sortOrder ASC').all()).results || [];
      const wRows = (await db.prepare('SELECT id, name, skill, phone FROM workers WHERE active = 1').all()).results || [];

      return ok({
        schoolName: sMap.school_name || '学校总务报修服务中心',
        buildings: bRows.map((b) => b.name),
        categories: cRows.map((c) => c.name),
        workers: wRows,
        sla: {
          pendingHours: parseFloat(sMap.sla_pending_hours) || 4,
          acceptHours: parseFloat(sMap.sla_accept_hours) || 8,
          finishHours: parseFloat(sMap.sla_finish_hours) || 24,
        },
      });
    }

    // 2. 身份登录
    if (path === '/api/auth/login' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const { role, username, password, key } = body;
      const sRows = (await db.prepare('SELECT key, value FROM settings').all()).results || [];
      const sMap = {};
      sRows.forEach((r) => (sMap[r.key] = r.value));

      if (role === 'admin') {
        const adminPwd = sMap.admin_password || 'admin888';
        if (key === adminPwd || password === adminPwd) {
          const token = await createToken({ role: 'admin', name: '总务处管理员', exp: Date.now() + 7 * 86400000 }, env);
          return ok({ token, role: 'admin', name: '总务处' });
        }
        return fail('管理员口令不正确');
      }

      if (role === 'worker') {
        const workerCommonKey = sMap.worker_common_key || 'worker888';
        // 公共口令与个人密码走同一条路径：先命中启用中的师傅账号，再验口令。
        // 以前公共口令是个独立分支、直接拿 body.name 签发 token，而前端压根不传 key，
        // 那段是死代码 —— 结果系统设置里的「师傅公共口令」改了根本不生效。
        const account = String(username || '').trim();
        if (!account) return fail('请填写师傅工号或手机号');
        const worker = await db.prepare('SELECT * FROM workers WHERE username = ? OR phone = ?').bind(account, account).first();
        if (!worker) return fail('师傅工号或密码不正确');
        if (!worker.active) return fail('该师傅账号已停用');
        if (password !== worker.password && key !== workerCommonKey) {
          return fail('师傅工号或密码不正确');
        }

        const token = await createToken({ role: 'worker', workerId: worker.id, name: worker.name, username: worker.username, exp: Date.now() + 7 * 86400000 }, env);
        return ok({ token, role: 'worker', workerId: worker.id, name: worker.name, phone: worker.phone });
      }

      return fail('未知角色');
    }

    // 师傅自助修改登录密码（师傅端「修改密码」弹窗依赖此路由）
    if (path === '/api/auth/change-password' && method === 'POST') {
      const authHeader = request.headers.get('Authorization') || '';
      const payload = authHeader.startsWith('Bearer ') ? await verifyToken(authHeader.slice(7).trim(), env) : null;
      if (!payload || payload.role !== 'worker') return fail('请先登录师傅端', 401);

      const body = await request.json().catch(() => ({}));
      const oldPassword = String(body.oldPassword || '');
      const newPassword = String(body.newPassword || '');
      if (newPassword.length < 6) return fail('新密码长度不能少于 6 位');

      const worker = await db.prepare('SELECT * FROM workers WHERE id = ?').bind(payload.workerId).first();
      if (!worker) return fail('账号不存在，请联系总务处');
      if (worker.password !== oldPassword) return fail('原密码不正确');
      if (worker.password === newPassword) return fail('新密码不能与原密码相同');

      await db.prepare('UPDATE workers SET password = ? WHERE id = ?').bind(newPassword, worker.id).run();
      return ok(true, '密码修改成功');
    }

    // 3. 图片文件上传 (支持 Cloudflare R2，未配置 R2 时自动转换为 base64 存入)
    if (path === '/api/upload' && method === 'POST') {
      const formData = await request.formData();
      const file = formData.get('file');
      if (!file) return fail('未检测到上传文件');

      // 上传口子是公开的（报修人不登录就要能传照片），所以必须自己卡住类型与体积，
      // 否则 R2 会被当成免费图床：任何人都能往里塞任意大文件，账单是你的。
      if (!String(file.type || '').startsWith('image/')) return fail('只能上传图片文件');
      if (file.size > MAX_UPLOAD_BYTES) return fail(`图片不能超过 ${MAX_UPLOAD_BYTES / 1024 / 1024}MB`);
      if (file.size === 0) return fail('文件内容为空');

      // 扩展名只从 MIME 推导，不信任 file.name（可以伪造 xxx.jpg 实际传可执行文件）
      const extMap = {
        'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
        'image/gif': '.gif', 'image/heic': '.heic', 'image/heif': '.heif',
      };
      const ext = extMap[file.type] || '.jpg';
      const fileKey = `bx-${Date.now()}-${crypto.randomUUID().slice(0, 8)}${ext}`;

      const bucket = env.PHOTOS || env.BUCKET || env.R2;
      if (bucket) {
        // 如果绑定了 R2 存储桶，直接上传到 R2
        await bucket.put(fileKey, file.stream(), {
          httpMetadata: { contentType: file.type || 'image/jpeg' },
        });
        return ok({ url: `/api/uploads/${fileKey}` });
      } else {
        // 未绑定 R2 时的平替：转换为 Base64 Data URL 直接可用
        const arrayBuf = await file.arrayBuffer();
        const base64Str = uint8ToBase64(new Uint8Array(arrayBuf));
        const mime = file.type || 'image/jpeg';
        return ok({ url: `data:${mime};base64,${base64Str}` });
      }
    }

    // 从 R2 读取照片
    if (path.startsWith('/api/uploads/')) {
      const fileKey = path.replace('/api/uploads/', '');
      const bucket = env.PHOTOS || env.BUCKET || env.R2;
      if (!bucket) return fail('R2 bucket not bound', 404);
      const object = await bucket.get(fileKey);
      if (!object) return fail('File not found', 404);

      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set('etag', object.httpEtag);
      headers.set('Cache-Control', 'public, max-age=31536000');
      headers.set('Access-Control-Allow-Origin', '*');
      return new Response(object.body, { headers });
    }

    // 4. 工单相关接口
    if (path === '/api/tickets' && method === 'GET') {
      const phone = url.searchParams.get('phone');
      const assignee = url.searchParams.get('assignee');
      const status = url.searchParams.get('status');
      const search = url.searchParams.get('search');
      const urgency = url.searchParams.get('urgency');
      const building = url.searchParams.get('building');
      const category = url.searchParams.get('category');
      const batchToken = url.searchParams.get('batchToken');

      // 师傅端只应看到派给自己的单：带 worker token 时以 token 里的姓名为准，
      // 忽略前端传来的 assignee，避免改个参数就翻到别人的工单
      const authHeaderList = request.headers.get('Authorization') || '';
      const authPayload = authHeaderList.startsWith('Bearer ') ? await verifyToken(authHeaderList.slice(7).trim(), env) : null;
      const workerName = authPayload && authPayload.role === 'worker' ? authPayload.name : '';

      let sql = 'SELECT * FROM tickets WHERE 1=1';
      const params = [];
      if (phone) { sql += ' AND phone = ?'; params.push(phone); }
      if (workerName) { sql += ' AND assignee = ?'; params.push(workerName); }
      else if (assignee) { sql += ' AND assignee = ?'; params.push(assignee); }
      if (status && status !== 'all') { sql += ' AND status = ?'; params.push(status); }
      if (urgency && urgency !== 'all') { sql += ' AND urgency = ?'; params.push(urgency); }
      if (building && building !== 'all') { sql += ' AND building = ?'; params.push(building); }
      if (category && category !== 'all') { sql += ' AND category = ?'; params.push(category); }
      if (batchToken) { sql += ' AND batchToken = ?'; params.push(batchToken); }
      if (search) {
        sql += ' AND (id LIKE ? OR desc LIKE ? OR room LIKE ? OR reporter LIKE ? OR assignee LIKE ?)';
        const s = `%${search}%`;
        params.push(s, s, s, s, s);
      }
      sql += ' ORDER BY createdAt DESC LIMIT 500';

      const rows = (await db.prepare(sql).bind(...params).all()).results || [];
      const sRows = (await db.prepare('SELECT key, value FROM settings').all()).results || [];
      const sMap = {};
      sRows.forEach((r) => (sMap[r.key] = r.value));

      return ok(await publicView(request, env, rows.map((r) => formatTicket(r, sMap))));
    }

    if (path.startsWith('/api/tickets/') && method === 'GET' && !path.includes('/comments')) {
      const id = path.replace('/api/tickets/', '');
      const t = await db.prepare('SELECT * FROM tickets WHERE id = ?').bind(id).first();
      if (!t) return fail('工单不存在', 404);

      const sRows = (await db.prepare('SELECT key, value FROM settings').all()).results || [];
      const sMap = {};
      sRows.forEach((r) => (sMap[r.key] = r.value));

      const formatted = formatTicket(t, sMap);
      const comments = (await db.prepare('SELECT * FROM ticket_comments WHERE ticketId = ? ORDER BY createdAt ASC').bind(id).all()).results || [];
      formatted.comments = comments;
      return ok((await publicView(request, env, [formatted]))[0]);
    }

    if (path === '/api/tickets' && method === 'POST') {
      const body = await request.json();
      const { building, category, urgency, identity, photos } = body;
      const room = String(body.room || '').trim();
      const desc = String(body.desc || '').trim();
      const reporter = String(body.reporter || '').trim();
      const phone = String(body.phone || '').trim();
      if (!room || !desc || !reporter || !phone) return fail('请填写必填项');
      // 手机号既是查单凭证也是联系依据，必须卡格式；文本一律限长，
      // 否则直调接口能灌几万字进去，D1 单行 1MB 会被撑爆
      if (!/^1\d{10}$/.test(phone)) return fail('请填写正确的 11 位手机号');
      if (room.length > MAX_LEN.room) return fail('房间号过长');
      if (reporter.length > MAX_LEN.reporter) return fail('报修人姓名过长');
      if (desc.length > MAX_LEN.desc) return fail(`故障描述不能超过 ${MAX_LEN.desc} 字`);

      // 幂等：同一个 clientToken 重复提交（网络重试、用户连点）只认第一条
      const clientToken = typeof body.clientToken === 'string' ? body.clientToken.trim().slice(0, 64) : '';
      const batchToken = typeof body.batchToken === 'string' ? body.batchToken.trim().slice(0, 64) : '';
      const batchSize = Math.max(1, Math.min(50, parseInt(body.batchSize, 10) || 1));
      // 照片由前端限制 3 张并压缩，但接口可被直调：这里再兜一道，
      // 避免塞进超长数组或任意 URL；R2 未绑定时图片会退化为 base64，更要控住总量
      const safePhotos = sanitizePhotos(photos);
      if (safePhotos === null) return fail('现场照片最多 3 张，且必须来自系统上传');

      // 枚举字段：前端是固定 chip / 下拉，但接口可被直调，非法值一律回落到默认档，
      // 否则会污染催办阈值（=== '紧急'）、Webhook 标题与管理端紧急度筛选
      const safeUrgency = URGENCY_LEVELS.includes(urgency) ? urgency : '普通';
      const safeIdentity = IDENTITIES.includes(identity) ? identity : '教职工';
      // 楼栋/分类必须来自启用中的字典，避免停用后仍能被直调写入；
      // 字典为空（首次初始化异常）时不校验，免得把正常报修全挡掉
      const bldgNames = ((await db.prepare('SELECT name FROM buildings WHERE active = 1').all()).results || []).map((r) => r.name);
      const catNames = ((await db.prepare('SELECT name FROM categories WHERE active = 1').all()).results || []).map((r) => r.name);
      const safeBuilding = bldgNames.length ? (bldgNames.includes(building) ? building : '') : (building || DEFAULT_BUILDINGS[0]);
      const safeCategory = catNames.length ? (catNames.includes(category) ? category : '') : (category || DEFAULT_CATEGORIES[0]);
      if (!safeBuilding) return fail('楼栋无效或已停用，请刷新页面重新选择');
      if (!safeCategory) return fail('故障分类无效或已停用，请刷新页面重新选择');

      const settingsRows = (await db.prepare('SELECT key, value FROM settings').all()).results || [];
      const sMap = {};
      settingsRows.forEach((r) => (sMap[r.key] = r.value));

      if (clientToken) {
        const dup = await db.prepare('SELECT ticketId FROM ticket_dedup WHERE clientToken = ?').bind(clientToken).first();
        if (dup) {
          const existing = await db.prepare('SELECT * FROM tickets WHERE id = ?').bind(dup.ticketId).first();
          if (existing) return ok(formatTicket(existing, sMap), '该报修已提交过');
        }
      }

      const now = Date.now();
      const d = new Date();
      const p = (v) => (v < 10 ? '0' : '') + v;
      const day = '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
      const countRes = await db.prepare('SELECT count(*) as c FROM tickets WHERE day = ?').bind(day).first();
      const count = (countRes && countRes.c) || 0;
      const id = 'BX' + day + String(count + 1).padStart(3, '0') + String(Math.floor(Math.random() * 90) + 10);

      const timeline = [
        { t: now, by: reporter, action: '提交报修', note: '' },
        { t: now, by: '系统', action: '系统受理', note: '报修单已录入，等待总务处派工' },
      ];

      const stmts = [
        db.prepare(`
          INSERT INTO tickets (id, day, createdAt, building, room, category, urgency, desc, reporter, phone, identity, photos, status, assignee, timeline, rating, completedAt, closedAt, result, finishPhotos, lastRemindAt, remindCount, batchToken, batchSize)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?, NULL, NULL, NULL, '', '[]', 0, 0, ?, ?)
        `).bind(id, day, now, safeBuilding, room, safeCategory, safeUrgency, desc, reporter, phone, safeIdentity, JSON.stringify(safePhotos), JSON.stringify(timeline), batchToken || null, batchSize),
      ];
      // clientToken 与工单同批写入；若并发下被别的请求抢先插入，INSERT OR IGNORE 不报错，后续查回原工单
      if (clientToken) {
        stmts.push(db.prepare('INSERT OR IGNORE INTO ticket_dedup (clientToken, ticketId, createdAt) VALUES (?, ?, ?)').bind(clientToken, id, now));
      }
      await db.batch(stmts);

      const created = await db.prepare('SELECT * FROM tickets WHERE id = ?').bind(id).first();
      // 并发兜底：本次插入其实没进库（clientToken 被抢注），返回已存在的那条
      if (clientToken && !created) {
        const dup = await db.prepare('SELECT ticketId FROM ticket_dedup WHERE clientToken = ?').bind(clientToken).first();
        if (dup) {
          const existing = await db.prepare('SELECT * FROM tickets WHERE id = ?').bind(dup.ticketId).first();
          if (existing) return ok(formatTicket(existing, sMap), '该报修已提交过');
        }
        return fail('提交失败，请重试', 500);
      }

      // 发送通知
      notify(sendWebhook(sMap, 'ticket_create', formatTicket(created, sMap)));

      // 幂等表只用来挡短时间内的重试，7 天前的记录已无意义，顺手清掉避免无限膨胀
      // 清理失败不能影响建单结果，所以单独兜住
      try {
        await db.prepare('DELETE FROM ticket_dedup WHERE createdAt < ?').bind(now - 7 * 86400000).run();
      } catch (e) {
        console.error('ticket_dedup cleanup failed:', e);
      }

      return ok(formatTicket(created, sMap));
    }

    // 派工（管理员）
    if (path.startsWith('/api/tickets/') && path.endsWith('/assign') && method === 'POST') {
      if (!(await requireRole(request, env, 'admin'))) return fail('请先登录管理端', 401);
      const id = path.split('/')[3];
      const body = await request.json();
      const t = await db.prepare('SELECT * FROM tickets WHERE id = ?').bind(id).first();
      if (!t) return fail('工单不存在', 404);

      const workerName = String(body.worker || '').trim().slice(0, 20);
      if (!workerName) return fail('请选择派工师傅');

      let tl = [];
      try { tl = JSON.parse(t.timeline || '[]'); } catch (e) {}
      const now = Date.now();
      const note = String(body.note || '').trim().slice(0, 100);
      tl.push({ t: now, by: '总务处', action: '派单给 ' + workerName, note });

      await db.prepare('UPDATE tickets SET status = ?, assignee = ?, timeline = ? WHERE id = ?')
        .bind('assigned', workerName, JSON.stringify(tl), id).run();

      const updated = await db.prepare('SELECT * FROM tickets WHERE id = ?').bind(id).first();
      const sRows = (await db.prepare('SELECT key, value FROM settings').all()).results || [];
      const sMap = {};
      sRows.forEach((r) => (sMap[r.key] = r.value));
      notify(sendWebhook(sMap, 'ticket_assign', { ...formatTicket(updated, sMap), note }));
      return ok(formatTicket(updated, sMap));
    }

    // 师傅接单（师傅身份）
    if (path.startsWith('/api/tickets/') && path.endsWith('/accept') && method === 'POST') {
      if (!(await requireRole(request, env, 'worker'))) return fail('请先登录师傅端', 401);
      const id = path.split('/')[3];
      const t = await db.prepare('SELECT * FROM tickets WHERE id = ?').bind(id).first();
      if (!t) return fail('工单不存在', 404);

      let tl = [];
      try { tl = JSON.parse(t.timeline || '[]'); } catch (e) {}
      tl.push({ t: Date.now(), by: t.assignee || '维修师傅', action: '接单并到场', note: '师傅已接单到场' });

      await db.prepare('UPDATE tickets SET status = ?, timeline = ? WHERE id = ?')
        .bind('working', JSON.stringify(tl), id).run();

      const updated = await db.prepare('SELECT * FROM tickets WHERE id = ?').bind(id).first();
      const sRows = (await db.prepare('SELECT key, value FROM settings').all()).results || [];
      const sMap = {};
      sRows.forEach((r) => (sMap[r.key] = r.value));
      // 接单此前是唯一没有群通知的节点，报修人和群里都看不到"师傅已出发"
      notify(sendWebhook(sMap, 'ticket_accept', formatTicket(updated, sMap)));
      return ok(formatTicket(updated, sMap));
    }

    // 完工（师傅身份）
    if (path.startsWith('/api/tickets/') && path.endsWith('/finish') && method === 'POST') {
      if (!(await requireRole(request, env, 'worker'))) return fail('请先登录师傅端', 401);
      const id = path.split('/')[3];
      const body = await request.json();
      const t = await db.prepare('SELECT * FROM tickets WHERE id = ?').bind(id).first();
      if (!t) return fail('工单不存在', 404);

      const result = String(body.result || '').trim().slice(0, 500);
      if (!result) return fail('请填写维修处理结果说明');

      let tl = [];
      try { tl = JSON.parse(t.timeline || '[]'); } catch (e) {}
      const now = Date.now();
      const material = typeof body.material === 'string' ? body.material.trim().slice(0, 200) : '';
      const materialSource = typeof body.materialSource === 'string' ? body.materialSource.trim().slice(0, 200) : '';
      // 完工照片同样是外部可控输入，走同一套校验
      const safeFinishPhotos = sanitizePhotos(body.photos);
      if (safeFinishPhotos === null) return fail('完工照片最多 3 张，且必须来自系统上传');
      const noteParts = [result];
      if (material) noteParts.push(`耗材/配件：${material}`);
      if (materialSource) noteParts.push(`配件购方：${materialSource}`);
      tl.push({ t: now, by: t.assignee || '维修师傅', action: '维修完成，等待验收', note: noteParts.filter(Boolean).join('；') });

      await db.prepare('UPDATE tickets SET status = ?, completedAt = ?, result = ?, material = ?, materialSource = ?, finishPhotos = ?, timeline = ? WHERE id = ?')
        .bind('done', now, result, material, materialSource, JSON.stringify(safeFinishPhotos), JSON.stringify(tl), id).run();

      const updated = await db.prepare('SELECT * FROM tickets WHERE id = ?').bind(id).first();
      const sRows = (await db.prepare('SELECT key, value FROM settings').all()).results || [];
      const sMap = {};
      sRows.forEach((r) => (sMap[r.key] = r.value));
      notify(sendWebhook(sMap, 'ticket_finish', formatTicket(updated, sMap)));
      return ok(true);
    }

    // 驳回工单（管理员）：管理端「驳回」按钮依赖此路由，缺了会报「未知 API」
    if (path.startsWith('/api/tickets/') && path.endsWith('/reject') && method === 'POST') {
      if (!(await requireRole(request, env, 'admin'))) return fail('请先登录管理端', 401);
      const id = path.split('/')[3];
      const body = await request.json().catch(() => ({}));
      const t = await db.prepare('SELECT * FROM tickets WHERE id = ?').bind(id).first();
      if (!t) return fail('工单不存在', 404);
      if (t.status === 'closed') return fail('已验收关闭的工单不能驳回');

      const note = typeof body.note === 'string' ? body.note.trim().slice(0, 100) : '';
      let tl = [];
      try { tl = JSON.parse(t.timeline || '[]'); } catch (e) {}
      const now = Date.now();
      tl.push({ t: now, by: '总务处', action: '工单驳回', note: note || '不在维修范围或重复报修' });

      // 关闭时间一并落库，避免统计里出现"已驳回但未结束"的空档
      await db.prepare('UPDATE tickets SET status = ?, closedAt = ?, timeline = ? WHERE id = ?')
        .bind('rejected', now, JSON.stringify(tl), id).run();

      const updated = await db.prepare('SELECT * FROM tickets WHERE id = ?').bind(id).first();
      const sRows = (await db.prepare('SELECT key, value FROM settings').all()).results || [];
      const sMap = {};
      sRows.forEach((r) => (sMap[r.key] = r.value));
      notify(sendWebhook(sMap, 'ticket_reject', { ...formatTicket(updated, sMap), note }));
      return ok(formatTicket(updated, sMap), '已驳回该工单');
    }

    // 催单（报修人不登录，靠工单号 + 10 分钟限频兜底）
    if (path.startsWith('/api/tickets/') && path.endsWith('/remind') && method === 'POST') {
      const id = path.split('/')[3];
      const body = await request.json();
      const t = await db.prepare('SELECT * FROM tickets WHERE id = ?').bind(id).first();
      if (!t) return fail('工单不存在', 404);

      const now = Date.now();
      if (t.lastRemindAt && now - t.lastRemindAt < 10 * 60 * 1000) {
        return fail('催单过于频繁，请稍后再试');
      }

      let tl = [];
      try { tl = JSON.parse(t.timeline || '[]'); } catch (e) {}
      const count = (t.remindCount || 0) + 1;
      const note = String(body.note || '').trim().slice(0, 100) || '加急催办';
      tl.push({ t: now, by: t.reporter, action: `第 ${count} 次催单`, note });

      await db.prepare('UPDATE tickets SET lastRemindAt = ?, remindCount = ?, timeline = ? WHERE id = ?')
        .bind(now, count, JSON.stringify(tl), id).run();

      const sRows = (await db.prepare('SELECT key, value FROM settings').all()).results || [];
      const sMap = {};
      sRows.forEach((r) => (sMap[r.key] = r.value));
      notify(sendWebhook(sMap, 'ticket_remind', { ...t, remindCount: count, note }));
      return ok(null, '催单提醒已发出！');
    }

    // 验收评价（报修人凭工单号评价，不登录；但必须是已完工且没评过）
    if (path.startsWith('/api/tickets/') && path.endsWith('/rate') && method === 'POST') {
      const id = path.split('/')[3];
      const body = await request.json();
      const t = await db.prepare('SELECT * FROM tickets WHERE id = ?').bind(id).first();
      if (!t) return fail('工单不存在', 404);
      if (t.status !== 'done') return fail('工单尚未完工，暂不能评价');
      if (t.rating && t.rating !== 'null') return fail('该工单已评价过');

      // 评分收敛到 1~5 的整数。以前 body.score 原样入库：9999 能写进去，
      // 传个字符串还能在管理端/报修端未转义地渲染出来（存储型 XSS）。
      const score = Math.min(5, Math.max(1, parseInt(body.score, 10) || 5));
      const comment = String(body.comment || '').trim().slice(0, 200) || '满意';

      const now = Date.now();
      let tl = [];
      try { tl = JSON.parse(t.timeline || '[]'); } catch (e) {}
      tl.push({ t: now, by: t.reporter, action: '验收评价', note: `评分：${score}星 | ${comment}` });

      const ratingObj = { score, comment };
      await db.prepare('UPDATE tickets SET status = ?, closedAt = ?, rating = ?, timeline = ? WHERE id = ?')
        .bind('closed', now, JSON.stringify(ratingObj), JSON.stringify(tl), id).run();

      const sRows = (await db.prepare('SELECT key, value FROM settings').all()).results || [];
      const sMap = {};
      sRows.forEach((r) => (sMap[r.key] = r.value));
      notify(sendWebhook(sMap, 'ticket_rate', { ...t, score, comment }));
      return ok(true);
    }

    // 留言（三端都能留，报修端不登录，故不鉴权，但内容一律限长）
    if (path.startsWith('/api/tickets/') && path.endsWith('/comments')) {
      const id = path.split('/')[3];
      if (method === 'GET') {
        const rows = (await db.prepare('SELECT * FROM ticket_comments WHERE ticketId = ? ORDER BY createdAt ASC').bind(id).all()).results || [];
        return ok(rows);
      }
      if (method === 'POST') {
        const body = await request.json();
        const content = String(body.content || '').trim().slice(0, 200);
        if (!content) return fail('留言内容不能为空');
        const senderName = String(body.senderName || '').trim().slice(0, 20) || '匿名';
        const senderRole = ['admin', 'worker', 'user'].includes(body.senderRole) ? body.senderRole : 'user';
        const r = await db.prepare('INSERT INTO ticket_comments (ticketId, senderRole, senderName, content, createdAt) VALUES (?, ?, ?, ?, ?)')
          .bind(id, senderRole, senderName, content, Date.now()).run();
        return ok(r);
      }
    }

    // 5. 后台管理接口 (师傅/楼栋/分类/设置)
    // 这一整段都必须管理员身份：以前 checkAdmin 定义了却从未调用，
    // 导致任何人裸调 /api/admin/settings 就能读到管理员口令、并直接改写系统配置。
    if (path.startsWith('/api/admin/') && !(await checkAdmin(request, env))) {
      return fail('请先登录管理端', 401);
    }

    // 删除工单（管理员）：清理误报 / 测试数据用。物理删除，不可恢复。
    if (path.startsWith('/api/admin/tickets/') && method === 'DELETE') {
      const id = path.split('/')[4];
      const t = await db.prepare('SELECT id, building, room, status FROM tickets WHERE id = ?').bind(id).first();
      if (!t) return fail('工单不存在', 404);

      // 一条工单还挂着留言和提交幂等记录，只删主表会留下孤儿数据：
      // 幂等记录不清，同一个 clientToken 再提交会返回「已提交过」却查不到工单
      await db.batch([
        db.prepare('DELETE FROM tickets WHERE id = ?').bind(id),
        db.prepare('DELETE FROM ticket_comments WHERE ticketId = ?').bind(id),
        db.prepare('DELETE FROM ticket_dedup WHERE ticketId = ?').bind(id),
      ]);
      return ok({ id: t.id, building: t.building, room: t.room }, `已删除工单 ${t.id}`);
    }

    if (path === '/api/admin/workers') {
      if (method === 'GET') {
        const rows = (await db.prepare('SELECT * FROM workers ORDER BY createdAt ASC').all()).results || [];
        return ok(rows);
      }
      if (method === 'POST') {
        const body = await request.json();
        const id = 'w_' + Date.now().toString(36);
        await db.prepare('INSERT INTO workers (id, username, password, name, skill, phone, active, createdAt) VALUES (?, ?, ?, ?, ?, ?, 1, ?)')
          .bind(id, body.username || body.phone, body.password || 'worker888', body.name, body.skill || '', body.phone, Date.now()).run();
        return ok(true);
      }
    }
    if (path.startsWith('/api/admin/workers/') && method === 'PUT') {
      const id = path.split('/')[4];
      const body = await request.json();
      const sets = [], params = [];
      if (body.password) { sets.push('password = ?'); params.push(String(body.password)); }
      // 停用/启用：停用后师傅不能登录，且不再出现在派工名单，历史工单保留
      if (body.active === 0 || body.active === 1) { sets.push('active = ?'); params.push(body.active); }
      if (sets.length) {
        await db.prepare(`UPDATE workers SET ${sets.join(', ')} WHERE id = ?`).bind(...params, id).run();
      }
      return ok(true);
    }
    if (path.startsWith('/api/admin/workers/') && method === 'DELETE') {
      const id = path.split('/')[4];
      await db.prepare('DELETE FROM workers WHERE id = ?').bind(id).run();
      return ok(true);
    }

    if (path === '/api/admin/buildings') {
      if (method === 'GET') {
        const rows = (await db.prepare('SELECT * FROM buildings ORDER BY sortOrder ASC').all()).results || [];
        return ok(rows);
      }
      if (method === 'POST') {
        const body = await request.json();
        const maxRow = await db.prepare('SELECT COALESCE(MAX(sortOrder), 0) AS m FROM buildings').first();
        await db.prepare('INSERT INTO buildings (name, sortOrder, active) VALUES (?, ?, 1)').bind(body.name, (maxRow?.m || 0) + 10).run();
        return ok(true);
      }
    }
    if (path.startsWith('/api/admin/buildings/') && method === 'PUT') {
      const id = path.split('/')[4];
      const body = await request.json();
      const sets = [], params = [];
      // 停用后报修表单不再显示该楼栋；历史工单存的是名称快照，不受影响
      if (body.active === 0 || body.active === 1) { sets.push('active = ?'); params.push(body.active); }
      if (typeof body.name === 'string' && body.name.trim()) { sets.push('name = ?'); params.push(body.name.trim().slice(0, 20)); }
      if (sets.length) {
        await db.prepare(`UPDATE buildings SET ${sets.join(', ')} WHERE id = ?`).bind(...params, id).run();
      }
      return ok(true);
    }
    // 调整楼栋在报修表单里的排列顺序（上移 / 下移）
    if (path.startsWith('/api/admin/buildings/') && path.endsWith('/move') && method === 'POST') {
      const id = path.split('/')[4];
      const body = await request.json().catch(() => ({}));
      await moveDictItem(db, 'buildings', id, body.dir === 'up' ? 'up' : 'down');
      return ok(true);
    }
    if (path.startsWith('/api/admin/buildings/') && method === 'DELETE') {
      const id = path.split('/')[4];
      await db.prepare('DELETE FROM buildings WHERE id = ?').bind(id).run();
      return ok(true);
    }

    if (path === '/api/admin/categories') {
      if (method === 'GET') {
        const rows = (await db.prepare('SELECT * FROM categories ORDER BY sortOrder ASC').all()).results || [];
        return ok(rows);
      }
      if (method === 'POST') {
        const body = await request.json();
        const maxRow = await db.prepare('SELECT COALESCE(MAX(sortOrder), 0) AS m FROM categories').first();
        await db.prepare('INSERT INTO categories (name, sortOrder, active) VALUES (?, ?, 1)').bind(body.name, (maxRow?.m || 0) + 10).run();
        return ok(true);
      }
    }
    if (path.startsWith('/api/admin/categories/') && method === 'PUT') {
      const id = path.split('/')[4];
      const body = await request.json();
      const sets = [], params = [];
      // 停用后新建报修不再显示该分类；已有工单的分类名称保留
      if (body.active === 0 || body.active === 1) { sets.push('active = ?'); params.push(body.active); }
      if (typeof body.name === 'string' && body.name.trim()) { sets.push('name = ?'); params.push(body.name.trim().slice(0, 20)); }
      if (sets.length) {
        await db.prepare(`UPDATE categories SET ${sets.join(', ')} WHERE id = ?`).bind(...params, id).run();
      }
      return ok(true);
    }
    // 调整故障分类在报修表单里的排列顺序（上移 / 下移）
    if (path.startsWith('/api/admin/categories/') && path.endsWith('/move') && method === 'POST') {
      const id = path.split('/')[4];
      const body = await request.json().catch(() => ({}));
      await moveDictItem(db, 'categories', id, body.dir === 'up' ? 'up' : 'down');
      return ok(true);
    }
    if (path.startsWith('/api/admin/categories/') && method === 'DELETE') {
      const id = path.split('/')[4];
      await db.prepare('DELETE FROM categories WHERE id = ?').bind(id).run();
      return ok(true);
    }

    if (path === '/api/admin/settings') {
      if (method === 'GET') {
        const rows = (await db.prepare('SELECT key, value FROM settings').all()).results || [];
        const sMap = {};
        rows.forEach((r) => (sMap[r.key] = r.value));
        // 口令不下发：前端只需要知道"是否已设置"，回显明文等于把后台钥匙摆在接口里
        delete sMap.admin_password;
        delete sMap.worker_common_key;
        delete sMap.webhook_secret;
        delete sMap.jwt_secret; // 签名密钥：泄露等于可以把任意人签成管理员
        return ok(sMap);
      }
      if (method === 'POST') {
        const body = await request.json();
        const stmts = [];
        for (const [k, v] of Object.entries(body)) {
          // 口令留空 = 不修改，避免前端不回显导致误清空
          if ((k === 'admin_password' || k === 'worker_common_key' || k === 'webhook_secret') && !String(v || '').trim()) continue;
          if (k === 'jwt_secret') continue; // 不允许从接口改写签名密钥
          stmts.push(db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(k, String(v)));
        }
        if (stmts.length) await db.batch(stmts);
        return ok(true, '设置保存成功');
      }
    }

    if (path === '/api/admin/settings/test-webhook' && method === 'POST') {
      const body = await request.json();
      await sendWebhook(body, 'test', {});
      return ok(null, '测试消息已发出！');
    }

    // 统计大屏
    if (path === '/api/stats/dashboard') {
      if (!(await checkAdmin(request, env))) return fail('请先登录管理端', 401);
      // 只取统计用得上的列。photos / finishPhotos / desc / result 这些大字段
      // 每条都要从 D1 读出来再丢掉，工单多了纯属浪费。
      // timeline 必须留：SLA 超时判定要靠它找派单/接单时间点。
      const tickets = (await db.prepare(
        'SELECT status, building, category, urgency, assignee, rating, timeline, createdAt, completedAt, closedAt FROM tickets'
      ).all()).results || [];
      const sRows = (await db.prepare('SELECT key, value FROM settings').all()).results || [];
      const sMap = {};
      sRows.forEach((r) => (sMap[r.key] = r.value));

      let pending = 0, assigned = 0, working = 0, done = 0, closed = 0, timeouts = 0;
      let totalScore = 0, scoreCount = 0;
      const catMap = {}, bldgMap = {}, workerMap = {};

      for (const t of tickets) {
        if (t.status === 'pending') pending++;
        else if (t.status === 'assigned') assigned++;
        else if (t.status === 'working') working++;
        else if (t.status === 'done') done++;
        else if (t.status === 'closed') closed++;

        const formatted = formatTicket(t, sMap);
        if (formatted.isTimeout) timeouts++;

        if (formatted.rating && formatted.rating.score) {
          totalScore += formatted.rating.score;
          scoreCount++;
        }
        if (t.category) catMap[t.category] = (catMap[t.category] || 0) + 1;
        if (t.building) bldgMap[t.building] = (bldgMap[t.building] || 0) + 1;
        if (t.assignee) {
          if (!workerMap[t.assignee]) workerMap[t.assignee] = { total: 0, closed: 0, working: 0 };
          workerMap[t.assignee].total++;
          if (t.status === 'closed' || t.status === 'done') workerMap[t.assignee].closed++;
          else if (t.status === 'working' || t.status === 'assigned') workerMap[t.assignee].working++;
        }
      }

      const avgScore = scoreCount > 0 ? (totalScore / scoreCount).toFixed(1) : '5.0';
      const finishRate = tickets.length > 0 ? Math.round(((closed + done) / tickets.length) * 100) : 0;

      return ok({
        total: tickets.length,
        pending,
        assigned,
        working,
        done,
        closed,
        timeouts,
        avgScore,
        finishRate,
        catMap,
        bldgMap,
        workerMap,
      });
    }

    return fail('未知 API: ' + path, 404);
  } catch (err) {
    console.error('API Error:', err);
    return fail(err.message || 'Server Error', 500);
  }
}

