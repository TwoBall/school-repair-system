const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'repair.db');
const db = new Database(DB_PATH);

// 开启 WAL 模式以获得最高读写性能和稳定性
db.pragma('journal_mode = WAL');

// 初始化数据表结构
function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS workers (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      skill TEXT,
      phone TEXT,
      active INTEGER DEFAULT 1,
      createdAt INTEGER
    );

    CREATE TABLE IF NOT EXISTS buildings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      sortOrder INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      sortOrder INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS tickets (
      id TEXT PRIMARY KEY,
      day TEXT,
      createdAt INTEGER,
      building TEXT,
      room TEXT,
      category TEXT,
      urgency TEXT,
      desc TEXT,
      reporter TEXT,
      phone TEXT,
      identity TEXT,
      photos TEXT,
      status TEXT,
      assignee TEXT,
      timeline TEXT,
      rating TEXT,
      completedAt INTEGER,
      closedAt INTEGER,
      result TEXT,
      finishPhotos TEXT,
      lastRemindAt INTEGER DEFAULT 0,
      remindCount INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS ticket_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticketId TEXT NOT NULL,
      senderRole TEXT NOT NULL,
      senderName TEXT NOT NULL,
      content TEXT NOT NULL,
      createdAt INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tickets_phone ON tickets(phone);
    CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
    CREATE INDEX IF NOT EXISTS idx_tickets_assignee ON tickets(assignee);
    CREATE INDEX IF NOT EXISTS idx_tickets_createdAt ON tickets(createdAt);
    CREATE INDEX IF NOT EXISTS idx_comments_ticketId ON ticket_comments(ticketId);
  `);

  seedDefaults();
}

// 写入系统默认配置与预置数据
function seedDefaults() {
  // 1. 系统设置
  const defaultSettings = [
    { key: 'admin_password', value: process.env.ADMIN_KEY || 'admin888' },
    { key: 'worker_common_key', value: process.env.WORKER_KEY || 'worker888' },
    { key: 'sla_pending_hours', value: '4' },
    { key: 'sla_accept_hours', value: '8' },
    { key: 'sla_finish_hours', value: '24' },
    { key: 'webhook_type', value: 'none' },
    { key: 'webhook_url', value: '' },
    { key: 'webhook_secret', value: '' },
    { key: 'school_name', value: '学校总务报修服务中心' },
  ];

  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const s of defaultSettings) {
    insertSetting.run(s.key, s.value);
  }

  // 2. 预设维修师傅
  const workerCount = db.prepare('SELECT count(*) as c FROM workers').get().c;
  if (workerCount === 0) {
    const defaultWorkers = [
      { id: 'w1', username: '13800000001', password: 'worker888', name: '张建国', skill: '水电照明、给排水', phone: '13800000001', active: 1, createdAt: Date.now() },
      { id: 'w2', username: '13800000002', password: 'worker888', name: '李国强', skill: '门窗家具、墙面地面', phone: '13800000002', active: 1, createdAt: Date.now() },
      { id: 'w3', username: '13800000003', password: 'worker888', name: '王海',   skill: '空调电器、多媒体设备', phone: '13800000003', active: 1, createdAt: Date.now() },
      { id: 'w4', username: '13800000004', password: 'worker888', name: '赵永发', skill: '综合维修、电梯设施', phone: '13800000004', active: 1, createdAt: Date.now() },
    ];
    const insWorker = db.prepare('INSERT INTO workers (id, username, password, name, skill, phone, active, createdAt) VALUES (@id, @username, @password, @name, @skill, @phone, @active, @createdAt)');
    for (const w of defaultWorkers) {
      insWorker.run(w);
    }
  }

  // 3. 预设楼栋
  const bldgCount = db.prepare('SELECT count(*) as c FROM buildings').get().c;
  if (bldgCount === 0) {
    const defaultBuildings = [
      '教学楼A栋', '教学楼B栋', '教学楼C栋', '实验楼', '图书馆', '行政楼',
      '食堂', '体育馆', '学生公寓1栋', '学生公寓2栋', '学生公寓3栋', '学生公寓4栋', '教师公寓'
    ];
    const insBldg = db.prepare('INSERT INTO buildings (name, sortOrder, active) VALUES (?, ?, 1)');
    defaultBuildings.forEach((b, idx) => insBldg.run(b, idx + 1));
  }

  // 4. 预设分类
  const catCount = db.prepare('SELECT count(*) as c FROM categories').get().c;
  if (catCount === 0) {
    const defaultCategories = [
      '水电照明', '门窗家具', '空调风扇', '给排水/卫浴', '多媒体设备', '墙面地面', '电梯设施', '其他'
    ];
    const insCat = db.prepare('INSERT INTO categories (name, sortOrder, active) VALUES (?, ?, 1)');
    defaultCategories.forEach((c, idx) => insCat.run(c, idx + 1));
  }

  // 5. 初始示例工单（如果库中没有任何工单）
  const ticketCount = db.prepare('SELECT count(*) as c FROM tickets').get().c;
  if (ticketCount === 0) {
    seedInitialTickets();
  }
}

function seedInitialTickets() {
  const now = Date.now(), D = 86400000, H = 3600000;
  const workers = db.prepare('SELECT * FROM workers').all();
  const demo = [
    { d: 0.2, b: '教学楼A栋', r: '305教室', c: '水电照明', u: '较急', p: '王同学', ph: '13900001111', who: '学生', desc: '教室第三排日光灯管闪烁不亮，晚自习影响视力。' },
    { d: 0.8, b: '学生公寓2栋', r: '412寝室', c: '给排水/卫浴', u: '紧急', p: '李婷', ph: '13900002222', who: '学生', desc: '洗手间水龙头漏水严重，水流不止，地面积水。' },
    { d: 1.5, b: '实验楼', r: '3楼化学实验室', c: '门窗家具', u: '普通', p: '刘老师', ph: '13900003333', who: '教职工', desc: '实验台抽屉滑轨脱落，无法正常推入开启。' },
    { d: 2.2, b: '图书馆', r: '2楼自习区', c: '空调风扇', u: '普通', p: '陈老师', ph: '13900004444', who: '教职工', desc: '自习区空调制冷效果差，室外机噪音偏大。' },
    { d: 3.5, b: '食堂', r: '一楼就餐区', c: '墙面地面', u: '较急', p: '赵师傅', ph: '13900005555', who: '职工', desc: '就餐区通道地砖松动翘起，师生经过容易绊倒。' },
    { d: 4.8, b: '教学楼B栋', r: '201教室', c: '多媒体设备', u: '较急', p: '孙老师', ph: '13900006666', who: '教职工', desc: '多媒体主投影仪无法开机，指示灯红灯闪烁。' },
    { d: 6.0, b: '学生公寓1栋', r: '107寝室', c: '门窗家具', u: '普通', p: '周敏', ph: '13900007777', who: '学生', desc: '宿舍衣柜门合页脱落断裂，柜门倾斜关不上。' },
    { d: 8.5, b: '行政楼', r: '4楼第一会议室', c: '空调风扇', u: '普通', p: '吴主任', ph: '13900008888', who: '教职工', desc: '会议室壁挂空调遥控接收器失灵，面板按键无响应。' },
    { d: 11.2, b: '教学楼C栋', r: '5楼北侧走廊', c: '水电照明', u: '紧急', p: '安保值班室', ph: '13900009999', who: '职工', desc: '走廊应急疏散指示灯不亮，存在消防安全隐患。' },
    { d: 15.0, b: '体育馆', r: '器材管理室', c: '其他', u: '普通', p: '郑老师', ph: '13900010000', who: '教职工', desc: '器材室双开铁门锁芯生锈卡死，钥匙拧不动。' }
  ];

  const insTicket = db.prepare(`
    INSERT INTO tickets (
      id, day, createdAt, building, room, category, urgency, desc, reporter, phone, identity,
      photos, status, assignee, timeline, rating, completedAt, closedAt, result, finishPhotos
    ) VALUES (
      @id, @day, @createdAt, @building, @room, @category, @urgency, @desc, @reporter, @phone, @identity,
      @photos, @status, @assignee, @timeline, @rating, @completedAt, @closedAt, @result, @finishPhotos
    )
  `);

  for (let i = 0; i < demo.length; i++) {
    const x = demo[i];
    const t0 = now - Math.round(x.d * D);
    const dObj = new Date(t0);
    const p = (v) => (v < 10 ? '0' : '') + v;
    const day = '' + dObj.getFullYear() + p(dObj.getMonth() + 1) + p(dObj.getDate());
    const id = 'BX' + day + String(i + 1).padStart(3, '0') + String(Math.floor(Math.random() * 90) + 10);

    const w = workers[i % workers.length];
    let st = 'pending';
    let assignee = null;
    let doneAt = null;
    let closeAt = null;
    let rating = null;

    if (i === 0) {
      st = 'pending';
    } else if (i === 1) {
      st = 'assigned';
      assignee = w.name;
    } else if (i === 2 || i === 6) {
      st = 'working';
      assignee = w.name;
    } else if (i === 3) {
      st = 'done';
      assignee = w.name;
      doneAt = t0 + 20 * H;
    } else {
      st = 'closed';
      assignee = w.name;
      doneAt = t0 + 26 * H;
      closeAt = doneAt + 5 * H;
      rating = {
        score: [5, 4, 5, 4, 5, 5][i % 6],
        comment: ['响应迅速，师傅当场修好', '师傅服务态度好，卫生清理干净', '处理专业，效率高', '配件已更换，测试运转正常', '晚上报修也能赶来，很给力'][i % 5],
      };
    }

    const tl = [
      { t: t0, by: x.p, action: '提交报修', note: '' },
      { t: t0, by: '系统', action: '系统受理', note: '已录入系统，等待总务处派单' },
    ];
    if (assignee) {
      tl.push({ t: t0 + 1.5 * H, by: '总务处', action: '派单给 ' + assignee, note: '请优先核实配件情况' });
      tl.push({ t: t0 + 1.5 * H, by: '系统', action: '派工通知', note: '已发送工作通知至维修师傅' });
    }
    if (st === 'working' || st === 'done' || st === 'closed') {
      tl.push({ t: t0 + 3 * H, by: assignee, action: '接单并到场', note: '已携带专用工具到场勘查' });
    }
    if (doneAt) {
      tl.push({ t: doneAt, by: assignee, action: '维修完成，等待验收', note: '已排查检修并现场试机测试正常' });
      tl.push({ t: doneAt, by: '系统', action: '完工提醒', note: '已提醒报修人核实验收' });
    }
    if (closeAt && rating) {
      tl.push({ t: closeAt, by: x.p, action: '验收评价', note: rating.comment });
    }

    insTicket.run({
      id,
      day,
      createdAt: t0,
      building: x.b,
      room: x.r,
      category: x.c,
      urgency: x.u,
      desc: x.desc,
      reporter: x.p,
      phone: x.ph,
      identity: x.who,
      photos: JSON.stringify([]),
      status: st,
      assignee,
      timeline: JSON.stringify(tl),
      rating: rating ? JSON.stringify(rating) : null,
      completedAt: doneAt,
      closedAt: closeAt,
      result: doneAt ? '已排查检修并现场试机测试正常' : '',
      finishPhotos: JSON.stringify([]),
    });
  }
}

// ----------------- 设置相关 -----------------
function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const map = {};
  rows.forEach((r) => (map[r.key] = r.value));
  return map;
}

function updateSettings(settingsObj) {
  const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const tx = db.transaction((data) => {
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined) {
        stmt.run(k, String(v));
      }
    }
  });
  tx(settingsObj);
  return getSettings();
}

// ----------------- 师傅管理 -----------------
function getWorkers(includeInactive = false) {
  const sql = includeInactive
    ? 'SELECT id, username, name, skill, phone, active, createdAt FROM workers ORDER BY createdAt ASC'
    : 'SELECT id, username, name, skill, phone, active, createdAt FROM workers WHERE active = 1 ORDER BY createdAt ASC';
  return db.prepare(sql).all();
}

function getWorkerById(id) {
  return db.prepare('SELECT * FROM workers WHERE id = ?').get(id);
}

function getWorkerByUsername(username) {
  return db.prepare('SELECT * FROM workers WHERE username = ? OR phone = ?').get(username, username);
}

function createWorker({ name, skill, phone, username, password }) {
  const id = 'w_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const uname = username || phone;
  const pwd = password || 'worker888';
  db.prepare(`
    INSERT INTO workers (id, username, password, name, skill, phone, active, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?)
  `).run(id, uname, pwd, name, skill || '', phone || '', Date.now());
  return getWorkerById(id);
}

function updateWorker(id, { name, skill, phone, username, password, active }) {
  const current = getWorkerById(id);
  if (!current) throw new Error('维修人员不存在');
  const uname = username !== undefined ? username : current.username;
  const pwd = password ? password : current.password;
  const n = name !== undefined ? name : current.name;
  const s = skill !== undefined ? skill : current.skill;
  const p = phone !== undefined ? phone : current.phone;
  const act = active !== undefined ? (active ? 1 : 0) : current.active;

  db.prepare(`
    UPDATE workers
    SET username = ?, password = ?, name = ?, skill = ?, phone = ?, active = ?
    WHERE id = ?
  `).run(uname, pwd, n, s, p, act, id);
  return getWorkerById(id);
}

function deleteWorker(id) {
  // 软删除或直接删除
  db.prepare('DELETE FROM workers WHERE id = ?').run(id);
  return true;
}

// ----------------- 楼栋与分类 -----------------
function getBuildings(includeInactive = false) {
  const sql = includeInactive
    ? 'SELECT * FROM buildings ORDER BY sortOrder ASC, id ASC'
    : 'SELECT * FROM buildings WHERE active = 1 ORDER BY sortOrder ASC, id ASC';
  return db.prepare(sql).all();
}

function addBuilding(name) {
  const exists = db.prepare('SELECT id FROM buildings WHERE name = ?').get(name);
  if (exists) throw new Error('楼栋名称已存在');
  const max = db.prepare('SELECT MAX(sortOrder) as m FROM buildings').get().m || 0;
  const r = db.prepare('INSERT INTO buildings (name, sortOrder, active) VALUES (?, ?, 1)').run(name, max + 1);
  return { id: r.lastInsertRowid, name, sortOrder: max + 1, active: 1 };
}

function updateBuilding(id, { name, sortOrder, active }) {
  const current = db.prepare('SELECT * FROM buildings WHERE id = ?').get(id);
  if (!current) throw new Error('楼栋不存在');
  db.prepare('UPDATE buildings SET name = ?, sortOrder = ?, active = ? WHERE id = ?').run(
    name !== undefined ? name : current.name,
    sortOrder !== undefined ? sortOrder : current.sortOrder,
    active !== undefined ? (active ? 1 : 0) : current.active,
    id
  );
  return db.prepare('SELECT * FROM buildings WHERE id = ?').get(id);
}

function deleteBuilding(id) {
  db.prepare('DELETE FROM buildings WHERE id = ?').run(id);
  return true;
}

function getCategories(includeInactive = false) {
  const sql = includeInactive
    ? 'SELECT * FROM categories ORDER BY sortOrder ASC, id ASC'
    : 'SELECT * FROM categories WHERE active = 1 ORDER BY sortOrder ASC, id ASC';
  return db.prepare(sql).all();
}

function addCategory(name) {
  const exists = db.prepare('SELECT id FROM categories WHERE name = ?').get(name);
  if (exists) throw new Error('分类名称已存在');
  const max = db.prepare('SELECT MAX(sortOrder) as m FROM categories').get().m || 0;
  const r = db.prepare('INSERT INTO categories (name, sortOrder, active) VALUES (?, ?, 1)').run(name, max + 1);
  return { id: r.lastInsertRowid, name, sortOrder: max + 1, active: 1 };
}

function updateCategory(id, { name, sortOrder, active }) {
  const current = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
  if (!current) throw new Error('分类不存在');
  db.prepare('UPDATE categories SET name = ?, sortOrder = ?, active = ? WHERE id = ?').run(
    name !== undefined ? name : current.name,
    sortOrder !== undefined ? sortOrder : current.sortOrder,
    active !== undefined ? (active ? 1 : 0) : current.active,
    id
  );
  return db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
}

function deleteCategory(id) {
  db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  return true;
}

// ----------------- 工单相关 -----------------
function parseJsonSafe(str, fallback) {
  if (!str) return fallback;
  try {
    return JSON.parse(str);
  } catch (e) {
    return fallback;
  }
}

function formatTicket(t, settings = null) {
  if (!t) return null;
  const now = Date.now();
  const ticket = {
    ...t,
    photos: parseJsonSafe(t.photos, []),
    timeline: parseJsonSafe(t.timeline, []),
    rating: parseJsonSafe(t.rating, null),
    finishPhotos: parseJsonSafe(t.finishPhotos, []),
  };

  // 计算 SLA 超时状态
  if (!settings) settings = getSettings();
  const pendingHours = parseFloat(settings.sla_pending_hours) || 4;
  const acceptHours = parseFloat(settings.sla_accept_hours) || 8;
  const finishHours = parseFloat(settings.sla_finish_hours) || 24;

  let isTimeout = false;
  let timeoutReason = '';

  if (ticket.status === 'pending') {
    const limitH = ticket.urgency === '紧急' ? Math.min(2, pendingHours) : pendingHours;
    if (now - ticket.createdAt > limitH * 3600000) {
      isTimeout = true;
      const overH = Math.round(((now - ticket.createdAt - limitH * 3600000) / 3600000) * 10) / 10;
      timeoutReason = `超期待受理 (${overH}h)`;
    }
  } else if (ticket.status === 'assigned') {
    // 找出最后一次派工时间
    let assignTime = ticket.createdAt;
    for (let i = ticket.timeline.length - 1; i >= 0; i--) {
      if (ticket.timeline[i].action && ticket.timeline[i].action.includes('派单')) {
        assignTime = ticket.timeline[i].t;
        break;
      }
    }
    if (now - assignTime > acceptHours * 3600000) {
      isTimeout = true;
      const overH = Math.round(((now - assignTime - acceptHours * 3600000) / 3600000) * 10) / 10;
      timeoutReason = `超时未接单 (${overH}h)`;
    }
  } else if (ticket.status === 'working') {
    let workTime = ticket.createdAt;
    for (let i = ticket.timeline.length - 1; i >= 0; i--) {
      if (ticket.timeline[i].action && ticket.timeline[i].action.includes('接单')) {
        workTime = ticket.timeline[i].t;
        break;
      }
    }
    if (now - workTime > finishHours * 3600000) {
      isTimeout = true;
      const overH = Math.round(((now - workTime - finishHours * 3600000) / 3600000) * 10) / 10;
      timeoutReason = `超时未完工 (${overH}h)`;
    }
  }

  ticket.isTimeout = isTimeout;
  ticket.timeoutReason = timeoutReason;
  return ticket;
}

function countTodayTickets(day) {
  return db.prepare('SELECT count(*) as c FROM tickets WHERE day = ?').get(day).c;
}

function createTicket(data) {
  const stmt = db.prepare(`
    INSERT INTO tickets (
      id, day, createdAt, building, room, category, urgency, desc, reporter, phone, identity,
      photos, status, assignee, timeline, rating, completedAt, closedAt, result, finishPhotos,
      lastRemindAt, remindCount
    ) VALUES (
      @id, @day, @createdAt, @building, @room, @category, @urgency, @desc, @reporter, @phone, @identity,
      @photos, @status, @assignee, @timeline, @rating, @completedAt, @closedAt, @result, @finishPhotos,
      @lastRemindAt, @remindCount
    )
  `);

  const doc = {
    ...data,
    photos: JSON.stringify(data.photos || []),
    timeline: JSON.stringify(data.timeline || []),
    rating: data.rating ? JSON.stringify(data.rating) : null,
    finishPhotos: JSON.stringify(data.finishPhotos || []),
    lastRemindAt: 0,
    remindCount: 0,
  };

  stmt.run(doc);
  return getTicketById(data.id);
}

function getTicketById(id) {
  const row = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
  if (!row) return null;
  const t = formatTicket(row);
  t.comments = getComments(id);
  return t;
}

function getTickets({ phone, assignee, status, search, urgency, building, category, limit = 500 }) {
  let sql = 'SELECT * FROM tickets WHERE 1=1';
  const params = [];

  if (phone) {
    sql += ' AND phone = ?';
    params.push(phone);
  }
  if (assignee) {
    sql += ' AND assignee = ?';
    params.push(assignee);
  }
  if (status && status !== 'all') {
    sql += ' AND status = ?';
    params.push(status);
  }
  if (urgency && urgency !== 'all') {
    sql += ' AND urgency = ?';
    params.push(urgency);
  }
  if (building && building !== 'all') {
    sql += ' AND building = ?';
    params.push(building);
  }
  if (category && category !== 'all') {
    sql += ' AND category = ?';
    params.push(category);
  }
  if (search) {
    sql += ' AND (id LIKE ? OR desc LIKE ? OR room LIKE ? OR reporter LIKE ? OR assignee LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s, s, s);
  }

  sql += ' ORDER BY createdAt DESC LIMIT ?';
  params.push(limit);

  const rows = db.prepare(sql).all(...params);
  const settings = getSettings();
  return rows.map((r) => formatTicket(r, settings));
}

function updateTicket(id, fields) {
  const sets = [];
  const params = [];

  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = ?`);
    if (k === 'photos' || k === 'timeline' || k === 'rating' || k === 'finishPhotos') {
      params.push(v ? JSON.stringify(v) : null);
    } else {
      params.push(v);
    }
  }

  if (sets.length === 0) return getTicketById(id);

  params.push(id);
  db.prepare(`UPDATE tickets SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return getTicketById(id);
}

function addTimeline(id, entry) {
  const row = db.prepare('SELECT timeline FROM tickets WHERE id = ?').get(id);
  if (!row) return false;
  const tl = parseJsonSafe(row.timeline, []);
  tl.push(entry);
  db.prepare('UPDATE tickets SET timeline = ? WHERE id = ?').run(JSON.stringify(tl), id);
  return true;
}

function recordRemind(id, note) {
  const t = getTicketById(id);
  if (!t) return null;
  const now = Date.now();
  const count = (t.remindCount || 0) + 1;

  addTimeline(id, {
    t: now,
    by: t.reporter,
    action: `第 ${count} 次催单`,
    note: note || '急需处理，请尽快安排检修！',
  });

  db.prepare('UPDATE tickets SET lastRemindAt = ?, remindCount = ? WHERE id = ?').run(now, count, id);
  return getTicketById(id);
}

// ----------------- 工单留言 -----------------
function getComments(ticketId) {
  return db.prepare('SELECT * FROM ticket_comments WHERE ticketId = ? ORDER BY createdAt ASC').all(ticketId);
}

function addComment(ticketId, senderRole, senderName, content) {
  const r = db.prepare(`
    INSERT INTO ticket_comments (ticketId, senderRole, senderName, content, createdAt)
    VALUES (?, ?, ?, ?, ?)
  `).run(ticketId, senderRole, senderName, content, Date.now());
  return db.prepare('SELECT * FROM ticket_comments WHERE id = ?').get(r.lastInsertRowid);
}

// ----------------- 统计大屏 -----------------
function getStats() {
  const tickets = getTickets({ limit: 10000 });
  const total = tickets.length;
  let pending = 0, assigned = 0, working = 0, done = 0, closed = 0, rejected = 0;
  let timeouts = 0;
  let totalScore = 0, scoreCount = 0;

  const catMap = {};
  const bldgMap = {};
  const workerMap = {};

  for (const t of tickets) {
    if (t.status === 'pending') pending++;
    else if (t.status === 'assigned') assigned++;
    else if (t.status === 'working') working++;
    else if (t.status === 'done') done++;
    else if (t.status === 'closed') closed++;
    else if (t.status === 'rejected') rejected++;

    if (t.isTimeout) timeouts++;

    if (t.rating && t.rating.score) {
      totalScore += t.rating.score;
      scoreCount++;
    }

    if (t.category) {
      catMap[t.category] = (catMap[t.category] || 0) + 1;
    }
    if (t.building) {
      bldgMap[t.building] = (bldgMap[t.building] || 0) + 1;
    }
    if (t.assignee) {
      if (!workerMap[t.assignee]) {
        workerMap[t.assignee] = { total: 0, closed: 0, working: 0 };
      }
      workerMap[t.assignee].total++;
      if (t.status === 'closed' || t.status === 'done') workerMap[t.assignee].closed++;
      else if (t.status === 'working' || t.status === 'assigned') workerMap[t.assignee].working++;
    }
  }

  const avgScore = scoreCount > 0 ? (totalScore / scoreCount).toFixed(1) : '5.0';
  const finishRate = total > 0 ? Math.round(((closed + done) / total) * 100) : 0;

  return {
    total,
    pending,
    assigned,
    working,
    done,
    closed,
    rejected,
    timeouts,
    avgScore,
    scoreCount,
    finishRate,
    catMap,
    bldgMap,
    workerMap,
  };
}

// 初始化运行建表
initSchema();

module.exports = {
  db,
  getSettings,
  updateSettings,
  getWorkers,
  getWorkerById,
  getWorkerByUsername,
  createWorker,
  updateWorker,
  deleteWorker,
  getBuildings,
  addBuilding,
  updateBuilding,
  deleteBuilding,
  getCategories,
  addCategory,
  updateCategory,
  deleteCategory,
  getTickets,
  getTicketById,
  countTodayTickets,
  createTicket,
  updateTicket,
  addTimeline,
  recordRemind,
  getComments,
  addComment,
  getStats,
};

