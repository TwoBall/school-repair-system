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
CREATE TABLE IF NOT EXISTS tickets (id TEXT PRIMARY KEY, day TEXT, createdAt INTEGER, building TEXT, room TEXT, category TEXT, urgency TEXT, desc TEXT, reporter TEXT, phone TEXT, identity TEXT, photos TEXT, status TEXT, assignee TEXT, timeline TEXT, rating TEXT, completedAt INTEGER, closedAt INTEGER, result TEXT, finishPhotos TEXT, lastRemindAt INTEGER DEFAULT 0, remindCount INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS ticket_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, ticketId TEXT NOT NULL, senderRole TEXT NOT NULL, senderName TEXT NOT NULL, content TEXT NOT NULL, createdAt INTEGER NOT NULL);
`;

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
    schemaChecked = true;
  } catch (e) {
    console.error('ensureSchema error:', e);
  }
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

  // 默认楼栋
  const buildings = ['教学楼A栋', '教学楼B栋', '教学楼C栋', '实验楼', '图书馆', '行政楼', '食堂', '体育馆', '学生公寓1栋', '学生公寓2栋', '学生公寓3栋', '学生公寓4栋', '教师公寓'];
  buildings.forEach((b, i) => {
    stmts.push(db.prepare('INSERT INTO buildings (name, sortOrder, active) VALUES (?, ?, 1)').bind(b, i + 1));
  });

  // 默认分类
  const categories = ['水电照明', '门窗家具', '空调风扇', '给排水/卫浴', '多媒体设备', '墙面地面', '电梯设施', '其他'];
  categories.forEach((c, i) => {
    stmts.push(db.prepare('INSERT INTO categories (name, sortOrder, active) VALUES (?, ?, 1)').bind(c, i + 1));
  });

  await db.batch(stmts);
}

// ------------------- 身份鉴权与 Token -------------------
async function createToken(payload, secret = 'cf-repair-key-2026') {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const data = btoa(JSON.stringify(payload));
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(`${header}.${data}`));
  const sig = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return `${header}.${data}.${sig}`;
}

async function verifyToken(token, secret = 'cf-repair-key-2026') {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(atob(parts[1]));
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
    const payload = await verifyToken(authHeader.slice(7).trim());
    if (payload && payload.role === 'admin') return true;
  }

  const keyHeader = request.headers.get('x-admin-key');
  if (keyHeader && keyHeader === adminPwd) return true;

  return false;
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
    isTimeout,
    timeoutReason,
  };
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
      text = `### ✅ 维修已完工，等待验收\n\n- **工单编号**：${data.id}\n- **地点**：${data.building} ${data.room}\n- **维修人员**：${data.assignee}\n- **处理结果**：${data.result}\n- **完工时间**：${timeStr}`;
    } else if (eventType === 'ticket_rate') {
      title = `⭐ 报修已评价结单`;
      text = `### ⭐ 报修工单已验收结单\n\n- **工单编号**：${data.id}\n- **评价得分**：${'⭐'.repeat(data.score || 5)} (${data.score}分)\n- **评价反馈**：${data.comment || '满意'}`;
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
          const token = await createToken({ role: 'admin', name: '总务处管理员', exp: Date.now() + 7 * 86400000 });
          return ok({ token, role: 'admin', name: '总务处' });
        }
        return fail('管理员口令不正确');
      }

      if (role === 'worker') {
        const workerCommonKey = sMap.worker_common_key || 'worker888';
        if (key === workerCommonKey) {
          const token = await createToken({ role: 'worker', name: body.name || '维修师傅', exp: Date.now() + 7 * 86400000 });
          return ok({ token, role: 'worker', name: body.name || '维修师傅' });
        }

        const worker = await db.prepare('SELECT * FROM workers WHERE username = ? OR phone = ?').bind(username, username).first();
        if (!worker || worker.password !== password) {
          return fail('师傅工号或密码不正确');
        }
        if (!worker.active) return fail('该师傅账号已停用');

        const token = await createToken({ role: 'worker', workerId: worker.id, name: worker.name, username: worker.username, exp: Date.now() + 7 * 86400000 });
        return ok({ token, role: 'worker', workerId: worker.id, name: worker.name, phone: worker.phone });
      }

      return fail('未知角色');
    }

    // 3. 图片文件上传 (支持 Cloudflare R2，未配置 R2 时自动转换为 base64 存入)
    if (path === '/api/upload' && method === 'POST') {
      const formData = await request.formData();
      const file = formData.get('file');
      if (!file) return fail('未检测到上传文件');

      const ext = file.name ? file.name.substring(file.name.lastIndexOf('.')) : '.jpg';
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
        const base64Str = btoa(String.fromCharCode(...new Uint8Array(arrayBuf)));
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

      let sql = 'SELECT * FROM tickets WHERE 1=1';
      const params = [];
      if (phone) { sql += ' AND phone = ?'; params.push(phone); }
      if (assignee) { sql += ' AND assignee = ?'; params.push(assignee); }
      if (status && status !== 'all') { sql += ' AND status = ?'; params.push(status); }
      if (urgency && urgency !== 'all') { sql += ' AND urgency = ?'; params.push(urgency); }
      if (building && building !== 'all') { sql += ' AND building = ?'; params.push(building); }
      if (category && category !== 'all') { sql += ' AND category = ?'; params.push(category); }
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

      return ok(rows.map((r) => formatTicket(r, sMap)));
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
      return ok(formatted);
    }

    if (path === '/api/tickets' && method === 'POST') {
      const body = await request.json();
      const { building, room, category, urgency, desc, reporter, phone, identity, photos } = body;
      if (!room || !desc || !reporter || !phone) return fail('请填写必填项');

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

      await db.prepare(`
        INSERT INTO tickets (id, day, createdAt, building, room, category, urgency, desc, reporter, phone, identity, photos, status, assignee, timeline, rating, completedAt, closedAt, result, finishPhotos, lastRemindAt, remindCount)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?, NULL, NULL, NULL, '', '[]', 0, 0)
      `).bind(id, day, now, building || '教学楼A栋', room, category || '水电照明', urgency || '普通', desc, reporter, phone, identity || '学生', JSON.stringify(photos || []), JSON.stringify(timeline)).run();

      const created = await db.prepare('SELECT * FROM tickets WHERE id = ?').bind(id).first();

      // 发送通知
      const sRows = (await db.prepare('SELECT key, value FROM settings').all()).results || [];
      const sMap = {};
      sRows.forEach((r) => (sMap[r.key] = r.value));
      sendWebhook(sMap, 'ticket_create', formatTicket(created, sMap)).catch(() => {});

      return ok(formatTicket(created, sMap));
    }

    // 派工
    if (path.endsWith('/assign') && method === 'POST') {
      const id = path.split('/')[3];
      const body = await request.json();
      const t = await db.prepare('SELECT * FROM tickets WHERE id = ?').bind(id).first();
      if (!t) return fail('工单不存在', 404);

      let tl = [];
      try { tl = JSON.parse(t.timeline || '[]'); } catch (e) {}
      const now = Date.now();
      tl.push({ t: now, by: '总务处', action: '派单给 ' + body.worker, note: body.note || '' });

      await db.prepare('UPDATE tickets SET status = ?, assignee = ?, timeline = ? WHERE id = ?')
        .bind('assigned', body.worker, JSON.stringify(tl), id).run();

      const updated = await db.prepare('SELECT * FROM tickets WHERE id = ?').bind(id).first();
      const sRows = (await db.prepare('SELECT key, value FROM settings').all()).results || [];
      const sMap = {};
      sRows.forEach((r) => (sMap[r.key] = r.value));
      sendWebhook(sMap, 'ticket_assign', { ...formatTicket(updated, sMap), note: body.note }).catch(() => {});
      return ok(formatTicket(updated, sMap));
    }

    // 师傅接单
    if (path.endsWith('/accept') && method === 'POST') {
      const id = path.split('/')[3];
      const t = await db.prepare('SELECT * FROM tickets WHERE id = ?').bind(id).first();
      if (!t) return fail('工单不存在', 404);

      let tl = [];
      try { tl = JSON.parse(t.timeline || '[]'); } catch (e) {}
      tl.push({ t: Date.now(), by: t.assignee || '维修师傅', action: '接单并到场', note: '师傅已接单到场' });

      await db.prepare('UPDATE tickets SET status = ?, timeline = ? WHERE id = ?')
        .bind('working', JSON.stringify(tl), id).run();

      return ok(true);
    }

    // 完工
    if (path.endsWith('/finish') && method === 'POST') {
      const id = path.split('/')[3];
      const body = await request.json();
      const t = await db.prepare('SELECT * FROM tickets WHERE id = ?').bind(id).first();
      if (!t) return fail('工单不存在', 404);

      let tl = [];
      try { tl = JSON.parse(t.timeline || '[]'); } catch (e) {}
      const now = Date.now();
      tl.push({ t: now, by: t.assignee || '维修师傅', action: '维修完成，等待验收', note: body.result });

      await db.prepare('UPDATE tickets SET status = ?, completedAt = ?, result = ?, finishPhotos = ?, timeline = ? WHERE id = ?')
        .bind('done', now, body.result, JSON.stringify(body.photos || []), JSON.stringify(tl), id).run();

      const updated = await db.prepare('SELECT * FROM tickets WHERE id = ?').bind(id).first();
      const sRows = (await db.prepare('SELECT key, value FROM settings').all()).results || [];
      const sMap = {};
      sRows.forEach((r) => (sMap[r.key] = r.value));
      sendWebhook(sMap, 'ticket_finish', formatTicket(updated, sMap)).catch(() => {});
      return ok(true);
    }

    // 催单
    if (path.endsWith('/remind') && method === 'POST') {
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
      tl.push({ t: now, by: t.reporter, action: `第 ${count} 次催单`, note: body.note || '加急催办' });

      await db.prepare('UPDATE tickets SET lastRemindAt = ?, remindCount = ?, timeline = ? WHERE id = ?')
        .bind(now, count, JSON.stringify(tl), id).run();

      const sRows = (await db.prepare('SELECT key, value FROM settings').all()).results || [];
      const sMap = {};
      sRows.forEach((r) => (sMap[r.key] = r.value));
      sendWebhook(sMap, 'ticket_remind', { ...t, remindCount: count, note: body.note }).catch(() => {});
      return ok(null, '催单提醒已发出！');
    }

    // 验收评价
    if (path.endsWith('/rate') && method === 'POST') {
      const id = path.split('/')[3];
      const body = await request.json();
      const t = await db.prepare('SELECT * FROM tickets WHERE id = ?').bind(id).first();
      if (!t) return fail('工单不存在', 404);

      const now = Date.now();
      let tl = [];
      try { tl = JSON.parse(t.timeline || '[]'); } catch (e) {}
      tl.push({ t: now, by: t.reporter, action: '验收评价', note: `评分：${body.score}星 | ${body.comment}` });

      const ratingObj = { score: body.score || 5, comment: body.comment || '满意' };
      await db.prepare('UPDATE tickets SET status = ?, closedAt = ?, rating = ?, timeline = ? WHERE id = ?')
        .bind('closed', now, JSON.stringify(ratingObj), JSON.stringify(tl), id).run();

      const sRows = (await db.prepare('SELECT key, value FROM settings').all()).results || [];
      const sMap = {};
      sRows.forEach((r) => (sMap[r.key] = r.value));
      sendWebhook(sMap, 'ticket_rate', { ...t, score: body.score, comment: body.comment }).catch(() => {});
      return ok(true);
    }

    // 留言
    if (path.endsWith('/comments')) {
      const id = path.split('/')[3];
      if (method === 'GET') {
        const rows = (await db.prepare('SELECT * FROM ticket_comments WHERE ticketId = ? ORDER BY createdAt ASC').bind(id).all()).results || [];
        return ok(rows);
      }
      if (method === 'POST') {
        const body = await request.json();
        const r = await db.prepare('INSERT INTO ticket_comments (ticketId, senderRole, senderName, content, createdAt) VALUES (?, ?, ?, ?, ?)')
          .bind(id, body.senderRole, body.senderName, body.content, Date.now()).run();
        return ok(r);
      }
    }

    // 5. 后台管理接口 (师傅/楼栋/分类/设置)
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
      if (body.password) {
        await db.prepare('UPDATE workers SET password = ? WHERE id = ?').bind(body.password, id).run();
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
        await db.prepare('INSERT INTO buildings (name, sortOrder, active) VALUES (?, 10, 1)').bind(body.name).run();
        return ok(true);
      }
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
        await db.prepare('INSERT INTO categories (name, sortOrder, active) VALUES (?, 10, 1)').bind(body.name).run();
        return ok(true);
      }
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
        return ok(sMap);
      }
      if (method === 'POST') {
        const body = await request.json();
        const stmts = [];
        for (const [k, v] of Object.entries(body)) {
          stmts.push(db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(k, String(v)));
        }
        await db.batch(stmts);
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
      const tickets = (await db.prepare('SELECT * FROM tickets').all()).results || [];
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

