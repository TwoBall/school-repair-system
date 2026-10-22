require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const multer = require('multer');

const db = require('./db');
const { sendWebhook } = require('./notify');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.JWT_SECRET || 'repair-system-secret-salt-2026';

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// 中间件配置
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 静态资源挂载
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(PUBLIC_DIR));

// 文件上传配置 (Multer)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const rand = crypto.randomBytes(6).toString('hex');
    cb(null, `bx-${Date.now()}-${rand}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 最大 20MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('仅支持上传图片文件'));
    }
  },
});

// 响应助手
const ok = (res, data = null, msg = 'ok') => res.json({ ok: true, msg, data });
const fail = (res, msg = 'error', status = 400) => res.status(status).json({ ok: false, msg });

// Token 工具
function createToken(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET_KEY).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  const expected = crypto.createHmac('sha256', SECRET_KEY).update(data).digest('base64url');
  if (sig !== expected) return null;
  try {
    const json = JSON.parse(Buffer.from(data, 'base64url').toString('utf-8'));
    if (json.exp && json.exp < Date.now()) return null;
    return json;
  } catch (e) {
    return null;
  }
}

// 身份认证鉴权中间件
function authAdmin(req, res, next) {
  const settings = db.getSettings();
  const adminPwd = settings.admin_password || 'admin888';

  const keyHeader = req.headers['x-admin-key'] || req.query.key || (req.body && req.body.key);
  const authHeader = req.headers['authorization'];

  if (keyHeader && keyHeader === adminPwd) {
    req.user = { role: 'admin' };
    return next();
  }

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    const payload = verifyToken(token);
    if (payload && payload.role === 'admin') {
      req.user = payload;
      return next();
    }
  }

  return fail(res, '总务处管理员未授权或口令错误', 401);
}

function authWorker(req, res, next) {
  const settings = db.getSettings();
  const workerCommonKey = settings.worker_common_key || 'worker888';

  const keyHeader = req.headers['x-worker-key'] || req.query.key || (req.body && req.body.key);
  const authHeader = req.headers['authorization'];

  // 支持通用口令快捷验证（兼容旧版本）
  if (keyHeader && keyHeader === workerCommonKey) {
    req.user = { role: 'worker', name: req.body.name || req.query.name || '维修师傅' };
    return next();
  }

  // 支持独立 Token
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    const payload = verifyToken(token);
    if (payload && (payload.role === 'worker' || payload.role === 'admin')) {
      req.user = payload;
      return next();
    }
  }

  // 支持查询是否是管理员操作（管理员拥有师傅全部操作权限）
  if (keyHeader && keyHeader === settings.admin_password) {
    req.user = { role: 'admin', name: '总务处代办' };
    return next();
  }

  return fail(res, '维修组身份未授权或登录已过期', 401);
}

// 生成新单号
function generateTicketId() {
  const d = new Date();
  const p = (v) => (v < 10 ? '0' : '') + v;
  const day = '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
  const count = db.countTodayTickets(day);
  const seq = String(count + 1).padStart(3, '0');
  const rand = String(Math.floor(Math.random() * 90) + 10);
  return 'BX' + day + seq + rand;
}

// ----------------- 公共与系统接口 -----------------
app.get('/api/health', (req, res) => {
  ok(res, { status: 'healthy', time: Date.now() });
});

app.get('/api/config', (req, res) => {
  const settings = db.getSettings();
  const buildings = db.getBuildings();
  const categories = db.getCategories();
  const workers = db.getWorkers();

  ok(res, {
    schoolName: settings.school_name || '学校总务报修服务中心',
    buildings: buildings.map((b) => b.name),
    categories: categories.map((c) => c.name),
    workers: workers.map((w) => ({ id: w.id, name: w.name, skill: w.skill, phone: w.phone })),
    sla: {
      pendingHours: parseFloat(settings.sla_pending_hours) || 4,
      acceptHours: parseFloat(settings.sla_accept_hours) || 8,
      finishHours: parseFloat(settings.sla_finish_hours) || 24,
    },
  });
});

// 登录接口 (管理员 or 师傅)
app.post('/api/auth/login', (req, res) => {
  const { role, username, password, key } = req.body || {};
  const settings = db.getSettings();

  if (role === 'admin') {
    const adminPwd = settings.admin_password || 'admin888';
    if (key === adminPwd || password === adminPwd) {
      const token = createToken({ role: 'admin', name: '总务处管理', exp: Date.now() + 7 * 86400000 });
      return ok(res, { token, role: 'admin', name: '总务处' });
    }
    return fail(res, '管理员口令不正确');
  }

  if (role === 'worker') {
    // 师傅独立登录或通用口令
    if (key && key === (settings.worker_common_key || 'worker888')) {
      const token = createToken({ role: 'worker', name: req.body.name || '维修师傅', exp: Date.now() + 7 * 86400000 });
      return ok(res, { token, role: 'worker', name: req.body.name || '维修师傅' });
    }

    if (!username || !password) {
      return fail(res, '请输入工号/手机号及密码');
    }

    const worker = db.getWorkerByUsername(username);
    if (!worker || worker.password !== password) {
      return fail(res, '工号或密码不正确');
    }
    if (!worker.active) {
      return fail(res, '该师傅账号已被停用，请联系总务处');
    }

    const token = createToken({
      role: 'worker',
      workerId: worker.id,
      name: worker.name,
      username: worker.username,
      exp: Date.now() + 7 * 86400000,
    });
    return ok(res, { token, role: 'worker', workerId: worker.id, name: worker.name, phone: worker.phone });
  }

  return fail(res, '未知登录角色');
});

// 师傅修改自己的密码
app.post('/api/auth/change-password', authWorker, (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 6) {
    return fail(res, '新密码长度不能少于 6 位');
  }
  if (!req.user.workerId) {
    return fail(res, '当前通过通用口令登录，无法修改个体账号密码');
  }
  const worker = db.getWorkerById(req.user.workerId);
  if (!worker || worker.password !== oldPassword) {
    return fail(res, '原密码不正确');
  }
  db.updateWorker(worker.id, { password: newPassword });
  return ok(res, null, '密码修改成功');
});

// 单图/多图上传接口
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return fail(res, '未检测到上传文件');
  }
  const fileUrl = `/uploads/${req.file.filename}`;
  return ok(res, { url: fileUrl, filename: req.file.filename });
});

// ----------------- 工单操作接口 -----------------

// 获取工单列表 (支持报修人、师傅、管理员多维度筛选)
app.get('/api/tickets', (req, res) => {
  const { phone, assignee, status, search, urgency, building, category, limit } = req.query;
  const list = db.getTickets({
    phone,
    assignee,
    status,
    search,
    urgency,
    building,
    category,
    limit: parseInt(limit, 10) || 500,
  });
  return ok(res, list);
});

// 获取工单详情
app.get('/api/tickets/:id', (req, res) => {
  const ticket = db.getTicketById(req.params.id);
  if (!ticket) return fail(res, '工单不存在', 404);
  return ok(res, ticket);
});

// 创建报修单
app.post('/api/tickets', async (req, res) => {
  try {
    const { building, room, category, urgency, desc, reporter, phone, identity, photos } = req.body;

    if (!room || !String(room).trim()) return fail(res, '请填写楼层/房间号');
    if (!desc || !String(desc).trim()) return fail(res, '请填写故障描述');
    if (!reporter || !String(reporter).trim()) return fail(res, '请填写联系人姓名');
    if (!phone || !/^1\d{10}$/.test(String(phone).trim())) return fail(res, '请填写正确的11位手机号');

    const cleanPhone = String(phone).trim();
    const now = Date.now();

    // 防刷限制：同一手机号 5 分钟内最多提交 3 次
    const recentTickets = db.getTickets({ phone: cleanPhone, limit: 10 });
    const in5Min = recentTickets.filter((t) => now - t.createdAt < 5 * 60 * 1000);
    if (in5Min.length >= 3) {
      return fail(res, '提交过于频繁，请稍后再试');
    }

    const d = new Date();
    const p = (v) => (v < 10 ? '0' : '') + v;
    const day = '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
    const id = generateTicketId();

    // 格式化照片数组（支持文件链接或 base64）
    const cleanPhotos = Array.isArray(photos) ? photos.slice(0, 5) : [];

    const timeline = [
      { t: now, by: reporter, action: '提交报修', note: '' },
      { t: now, by: '系统', action: '系统受理', note: '报修单已录入，等待总务处派工' },
    ];

    const newTicket = db.createTicket({
      id,
      day,
      createdAt: now,
      building: building || '教学楼A栋',
      room: String(room).trim(),
      category: category || '水电照明',
      urgency: urgency || '普通',
      desc: String(desc).trim(),
      reporter: String(reporter).trim(),
      phone: cleanPhone,
      identity: identity || '学生',
      photos: cleanPhotos,
      status: 'pending',
      assignee: null,
      timeline,
      rating: null,
      completedAt: null,
      closedAt: null,
      result: '',
      finishPhotos: [],
    });

    // 触发 Webhook 新报修通知
    sendWebhook(db.getSettings(), 'ticket_create', newTicket).catch(() => {});

    return ok(res, newTicket);
  } catch (err) {
    return fail(res, err.message || '提交报修失败');
  }
});

// 总务处：派工
app.post('/api/tickets/:id/assign', authAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { worker, note } = req.body;
    if (!worker) return fail(res, '请选择指派的维修师傅');

    const ticket = db.getTicketById(id);
    if (!ticket) return fail(res, '工单不存在', 404);

    const now = Date.now();
    const tl = ticket.timeline || [];
    tl.push({ t: now, by: '总务处', action: '派单给 ' + worker, note: note || '' });
    tl.push({ t: now, by: '系统', action: '派工通知', note: '工作提醒已同步至 ' + worker });

    const updated = db.updateTicket(id, {
      status: 'assigned',
      assignee: worker,
      timeline: tl,
    });

    // 触发派工通知
    sendWebhook(db.getSettings(), 'ticket_assign', {
      ...updated,
      note,
    }).catch(() => {});

    return ok(res, updated);
  } catch (err) {
    return fail(res, err.message || '派工失败');
  }
});

// 总务处：驳回
app.post('/api/tickets/:id/reject', authAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { note } = req.body;
    const ticket = db.getTicketById(id);
    if (!ticket) return fail(res, '工单不存在', 404);

    const now = Date.now();
    const tl = ticket.timeline || [];
    tl.push({ t: now, by: '总务处', action: '驳回申请', note: note || '不在维修范围或重复报修' });

    const updated = db.updateTicket(id, {
      status: 'rejected',
      timeline: tl,
    });

    return ok(res, updated);
  } catch (err) {
    return fail(res, err.message || '驳回失败');
  }
});

// 总务处：强制完成
app.post('/api/tickets/:id/force-done', authAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { note } = req.body;
    const ticket = db.getTicketById(id);
    if (!ticket) return fail(res, '工单不存在', 404);

    const now = Date.now();
    const tl = ticket.timeline || [];
    tl.push({ t: now, by: '总务处', action: '强制完工', note: note || '总务处直接核实验收通过' });

    const updated = db.updateTicket(id, {
      status: 'done',
      completedAt: now,
      result: ticket.result || '总务处确认完成',
      timeline: tl,
    });

    return ok(res, updated);
  } catch (err) {
    return fail(res, err.message || '操作失败');
  }
});

// 维修师傅：接单
app.post('/api/tickets/:id/accept', authWorker, async (req, res) => {
  try {
    const { id } = req.params;
    const ticket = db.getTicketById(id);
    if (!ticket) return fail(res, '工单不存在', 404);
    if (ticket.status !== 'assigned') return fail(res, '该工单当前不可接单（状态非已派工）');

    const workerName = req.user.name || ticket.assignee || '维修师傅';
    const now = Date.now();
    const tl = ticket.timeline || [];
    tl.push({ t: now, by: workerName, action: '接单并到场', note: '师傅已接单，正前往现场排查' });

    const updated = db.updateTicket(id, {
      status: 'working',
      timeline: tl,
    });

    // 触发接单通知
    sendWebhook(db.getSettings(), 'ticket_accept', updated).catch(() => {});

    return ok(res, updated);
  } catch (err) {
    return fail(res, err.message || '接单失败');
  }
});

// 维修师傅：完工
app.post('/api/tickets/:id/finish', authWorker, async (req, res) => {
  try {
    const { id } = req.params;
    const { result, photos } = req.body;
    if (!result || !String(result).trim()) return fail(res, '请填写维修处理结果');

    const ticket = db.getTicketById(id);
    if (!ticket) return fail(res, '工单不存在', 404);

    const workerName = req.user.name || ticket.assignee || '维修师傅';
    const now = Date.now();
    const tl = ticket.timeline || [];
    const cleanResult = String(result).trim();
    const cleanPhotos = Array.isArray(photos) ? photos.slice(0, 5) : [];

    tl.push({ t: now, by: workerName, action: '维修完成，等待验收', note: cleanResult });
    tl.push({ t: now, by: '系统', action: '完工提醒', note: '已通知报修人进行现场验收与评分' });

    const updated = db.updateTicket(id, {
      status: 'done',
      completedAt: now,
      result: cleanResult,
      finishPhotos: cleanPhotos,
      timeline: tl,
    });

    // 触发完工通知
    sendWebhook(db.getSettings(), 'ticket_finish', updated).catch(() => {});

    return ok(res, updated);
  } catch (err) {
    return fail(res, err.message || '完工提交失败');
  }
});

// 报修人：验收评分
app.post('/api/tickets/:id/rate', async (req, res) => {
  try {
    const { id } = req.params;
    const { phone, score, comment } = req.body;
    const ticket = db.getTicketById(id);
    if (!ticket) return fail(res, '工单不存在', 404);
    if (ticket.status !== 'done') return fail(res, '该工单当前不可评价（尚未完工）');

    if (phone && ticket.phone !== String(phone).trim()) {
      return fail(res, '填写的手机号与原报修人不符');
    }

    const sc = Math.max(1, Math.min(5, parseInt(score, 10) || 5));
    const comm = String(comment || '').trim() || '满意，师傅处理及时！';
    const now = Date.now();
    const tl = ticket.timeline || [];
    tl.push({ t: now, by: ticket.reporter, action: '验收评价', note: `评分：${sc}星 | ${comm}` });

    const updated = db.updateTicket(id, {
      status: 'closed',
      closedAt: now,
      rating: { score: sc, comment: comm },
      timeline: tl,
    });

    // 触发评价结单通知
    sendWebhook(db.getSettings(), 'ticket_rate', {
      ...updated,
      score: sc,
      comment: comm,
    }).catch(() => {});

    return ok(res, updated);
  } catch (err) {
    return fail(res, err.message || '评价失败');
  }
});

// 报修人：加急催单
app.post('/api/tickets/:id/remind', async (req, res) => {
  try {
    const { id } = req.params;
    const { phone, note } = req.body;
    const ticket = db.getTicketById(id);
    if (!ticket) return fail(res, '工单不存在', 404);

    if (ticket.status === 'closed' || ticket.status === 'rejected') {
      return fail(res, '该工单已结单或已驳回，无需催单');
    }

    const now = Date.now();
    // 防刷：10分钟内最多催单1次
    if (ticket.lastRemindAt && now - ticket.lastRemindAt < 10 * 60 * 1000) {
      const waitMins = Math.ceil((10 * 60 * 1000 - (now - ticket.lastRemindAt)) / 60000);
      return fail(res, `催单过于频繁，请在 ${waitMins} 分钟后再试`);
    }

    const updated = db.recordRemind(id, note || '加急催单，现场急需使用！');

    // 发送加急催单 Webhook
    sendWebhook(db.getSettings(), 'ticket_remind', {
      ...updated,
      note: note || '急需处理，请尽快安排检修！',
      statusText: { pending: '待受理', assigned: '已派工', working: '维修中' }[ticket.status] || ticket.status,
    }).catch(() => {});

    return ok(res, updated, '催单提醒已送达负责人！');
  } catch (err) {
    return fail(res, err.message || '催单失败');
  }
});

// ----------------- 工单留言沟通板 -----------------
app.get('/api/tickets/:id/comments', (req, res) => {
  const comments = db.getComments(req.params.id);
  return ok(res, comments);
});

app.post('/api/tickets/:id/comments', async (req, res) => {
  try {
    const { id } = req.params;
    const { senderRole, senderName, content } = req.body;
    if (!content || !String(content).trim()) return fail(res, '留言内容不能为空');

    const ticket = db.getTicketById(id);
    if (!ticket) return fail(res, '工单不存在', 404);

    const cleanContent = String(content).trim();
    const name = String(senderName || '用户').trim();
    const role = senderRole || 'reporter';

    const comment = db.addComment(id, role, name, cleanContent);

    // 发送 Webhook 留言提醒
    sendWebhook(db.getSettings(), 'ticket_comment', {
      ...ticket,
      senderName: name,
      senderRole: role === 'reporter' ? '报修人' : role === 'worker' ? '维修师傅' : '总务处',
      content: cleanContent,
    }).catch(() => {});

    return ok(res, comment);
  } catch (err) {
    return fail(res, err.message || '发表留言失败');
  }
});

// ----------------- 总务处后台基础管理 -----------------

// 1. 师傅管理
app.get('/api/admin/workers', authAdmin, (req, res) => {
  const workers = db.getWorkers(true);
  return ok(res, workers);
});

app.post('/api/admin/workers', authAdmin, (req, res) => {
  try {
    const { name, phone, skill, username, password } = req.body;
    if (!name || !phone) return fail(res, '姓名与手机号不能为空');
    const worker = db.createWorker({ name, phone, skill, username: username || phone, password: password || 'worker888' });
    return ok(res, worker);
  } catch (err) {
    return fail(res, err.message || '添加师傅失败');
  }
});

app.put('/api/admin/workers/:id', authAdmin, (req, res) => {
  try {
    const updated = db.updateWorker(req.params.id, req.body);
    return ok(res, updated);
  } catch (err) {
    return fail(res, err.message || '更新师傅失败');
  }
});

app.delete('/api/admin/workers/:id', authAdmin, (req, res) => {
  db.deleteWorker(req.params.id);
  return ok(res, true);
});

// 2. 楼栋管理
app.get('/api/admin/buildings', authAdmin, (req, res) => {
  const list = db.getBuildings(true);
  return ok(res, list);
});

app.post('/api/admin/buildings', authAdmin, (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return fail(res, '楼栋名称不能为空');
    const b = db.addBuilding(name);
    return ok(res, b);
  } catch (err) {
    return fail(res, err.message || '添加楼栋失败');
  }
});

app.put('/api/admin/buildings/:id', authAdmin, (req, res) => {
  try {
    const b = db.updateBuilding(req.params.id, req.body);
    return ok(res, b);
  } catch (err) {
    return fail(res, err.message || '修改楼栋失败');
  }
});

app.delete('/api/admin/buildings/:id', authAdmin, (req, res) => {
  db.deleteBuilding(req.params.id);
  return ok(res, true);
});

// 3. 分类管理
app.get('/api/admin/categories', authAdmin, (req, res) => {
  const list = db.getCategories(true);
  return ok(res, list);
});

app.post('/api/admin/categories', authAdmin, (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return fail(res, '分类名称不能为空');
    const c = db.addCategory(name);
    return ok(res, c);
  } catch (err) {
    return fail(res, err.message || '添加分类失败');
  }
});

app.put('/api/admin/categories/:id', authAdmin, (req, res) => {
  try {
    const c = db.updateCategory(req.params.id, req.body);
    return ok(res, c);
  } catch (err) {
    return fail(res, err.message || '修改分类失败');
  }
});

app.delete('/api/admin/categories/:id', authAdmin, (req, res) => {
  db.deleteCategory(req.params.id);
  return ok(res, true);
});

// 4. 系统设置与 Webhook
app.get('/api/admin/settings', authAdmin, (req, res) => {
  const s = db.getSettings();
  return ok(res, {
    school_name: s.school_name || '学校总务报修服务中心',
    sla_pending_hours: s.sla_pending_hours || '4',
    sla_accept_hours: s.sla_accept_hours || '8',
    sla_finish_hours: s.sla_finish_hours || '24',
    webhook_type: s.webhook_type || 'none',
    webhook_url: s.webhook_url || '',
    webhook_secret: s.webhook_secret || '',
    has_admin_pwd: !!s.admin_password,
    worker_common_key: s.worker_common_key || 'worker888',
  });
});

app.post('/api/admin/settings', authAdmin, (req, res) => {
  try {
    const data = req.body || {};
    const toSave = {};

    if (data.school_name) toSave.school_name = data.school_name;
    if (data.sla_pending_hours) toSave.sla_pending_hours = data.sla_pending_hours;
    if (data.sla_accept_hours) toSave.sla_accept_hours = data.sla_accept_hours;
    if (data.sla_finish_hours) toSave.sla_finish_hours = data.sla_finish_hours;
    if (data.webhook_type) toSave.webhook_type = data.webhook_type;
    if (data.webhook_url !== undefined) toSave.webhook_url = data.webhook_url;
    if (data.webhook_secret !== undefined) toSave.webhook_secret = data.webhook_secret;
    if (data.worker_common_key) toSave.worker_common_key = data.worker_common_key;
    if (data.admin_password && data.admin_password.trim()) {
      toSave.admin_password = data.admin_password.trim();
    }

    const updated = db.updateSettings(toSave);
    return ok(res, updated, '系统设置已更新');
  } catch (err) {
    return fail(res, err.message || '保存设置失败');
  }
});

// 测试 Webhook 发送
app.post('/api/admin/settings/test-webhook', authAdmin, async (req, res) => {
  try {
    const { webhook_type, webhook_url, webhook_secret } = req.body;
    const testConfig = {
      webhook_type: webhook_type || 'none',
      webhook_url: webhook_url || '',
      webhook_secret: webhook_secret || '',
    };
    if (!testConfig.webhook_url) {
      return fail(res, '请先填写 Webhook 推送地址');
    }
    const result = await sendWebhook(testConfig, 'test', {});
    if (result.ok) {
      return ok(res, result.res, 'Webhook 测试消息已成功发出！');
    } else {
      return fail(res, 'Webhook 发送未成功：' + (result.error || JSON.stringify(result.res)));
    }
  } catch (err) {
    return fail(res, 'Webhook 测试异常：' + err.message);
  }
});

// 统计报表数据接口
app.get('/api/stats/dashboard', authAdmin, (req, res) => {
  const stats = db.getStats();
  return ok(res, stats);
});

// ----------------- 云开发函数向前兼容适配接口 -----------------
// 支持通过 /api/ticket 以 action 形式调用，完全无缝兼容原有云函数调用格式
app.post('/api/ticket', async (req, res) => {
  const event = req.body || {};
  const { action } = event;
  const settings = db.getSettings();

  try {
    if (action === 'listAll') {
      if (event.key !== settings.admin_password) throw new Error('口令不正确');
      const tickets = db.getTickets({ limit: 500 });
      return ok(res, tickets);
    }
    if (action === 'listMine') {
      const tickets = db.getTickets({ phone: event.phone, limit: 100 });
      return ok(res, tickets);
    }
    if (action === 'workerList') {
      const tickets = db.getTickets({ assignee: event.name, limit: 200 });
      return ok(res, tickets);
    }
    if (action === 'detail') {
      const t = db.getTicketById(event.id);
      if (!t) throw new Error('工单不存在');
      return ok(res, t);
    }
    if (action === 'create') {
      const { building, room, category, urgency, desc, reporter, phone, identity, photos } = event;
      const d = new Date();
      const p = (v) => (v < 10 ? '0' : '') + v;
      const day = '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
      const id = generateTicketId();
      const now = Date.now();
      const doc = db.createTicket({
        id,
        day,
        createdAt: now,
        building: building || '教学楼A栋',
        room,
        category: category || '水电照明',
        urgency: urgency || '普通',
        desc,
        reporter,
        phone,
        identity: identity || '学生',
        photos: photos || [],
        status: 'pending',
        assignee: null,
        timeline: [
          { t: now, by: reporter, action: '提交报修', note: '' },
          { t: now, by: '系统', action: '系统受理', note: '报修单已录入' },
        ],
        rating: null,
        completedAt: null,
        closedAt: null,
        result: '',
        finishPhotos: [],
      });
      sendWebhook(settings, 'ticket_create', doc).catch(() => {});
      return ok(res, doc);
    }
    if (action === 'assign') {
      if (event.key !== settings.admin_password) throw new Error('口令不正确');
      const t = db.getTicketById(event.id);
      if (!t) throw new Error('工单不存在');
      const now = Date.now();
      const tl = t.timeline || [];
      tl.push({ t: now, by: '总务处', action: '派单给 ' + event.worker, note: event.note || '' });
      const updated = db.updateTicket(event.id, {
        status: 'assigned',
        assignee: event.worker,
        timeline: tl,
      });
      sendWebhook(settings, 'ticket_assign', { ...updated, note: event.note }).catch(() => {});
      return ok(res, true);
    }
    if (action === 'reject') {
      if (event.key !== settings.admin_password) throw new Error('口令不正确');
      const t = db.getTicketById(event.id);
      if (!t) throw new Error('工单不存在');
      const tl = t.timeline || [];
      tl.push({ t: Date.now(), by: '总务处', action: '驳回申请', note: event.note || '不在维修范围' });
      db.updateTicket(event.id, { status: 'rejected', timeline: tl });
      return ok(res, true);
    }
    if (action === 'forceDone') {
      if (event.key !== settings.admin_password) throw new Error('口令不正确');
      const t = db.getTicketById(event.id);
      if (!t) throw new Error('工单不存在');
      const tl = t.timeline || [];
      tl.push({ t: Date.now(), by: '总务处', action: '强制完成', note: '' });
      db.updateTicket(event.id, { status: 'done', completedAt: Date.now(), result: '总务处确认完成', timeline: tl });
      return ok(res, true);
    }
    if (action === 'accept') {
      const t = db.getTicketById(event.id);
      if (!t) throw new Error('工单不存在');
      const tl = t.timeline || [];
      tl.push({ t: Date.now(), by: t.assignee || '维修师傅', action: '接单并到场', note: '' });
      db.updateTicket(event.id, { status: 'working', timeline: tl });
      sendWebhook(settings, 'ticket_accept', t).catch(() => {});
      return ok(res, true);
    }
    if (action === 'finish') {
      const t = db.getTicketById(event.id);
      if (!t) throw new Error('工单不存在');
      const tl = t.timeline || [];
      tl.push({ t: Date.now(), by: t.assignee || '维修师傅', action: '维修完成，等待验收', note: event.result });
      const updated = db.updateTicket(event.id, {
        status: 'done',
        completedAt: Date.now(),
        result: event.result,
        finishPhotos: event.photos || [],
        timeline: tl,
      });
      sendWebhook(settings, 'ticket_finish', updated).catch(() => {});
      return ok(res, true);
    }
    if (action === 'rate') {
      const t = db.getTicketById(event.id);
      if (!t) throw new Error('工单不存在');
      const tl = t.timeline || [];
      tl.push({ t: Date.now(), by: t.reporter, action: '验收评价', note: event.comment || '满意' });
      const score = Math.max(1, Math.min(5, parseInt(event.score, 10) || 5));
      const updated = db.updateTicket(event.id, {
        status: 'closed',
        closedAt: Date.now(),
        rating: { score, comment: event.comment || '满意' },
        timeline: tl,
      });
      sendWebhook(settings, 'ticket_rate', { ...updated, score, comment: event.comment }).catch(() => {});
      return ok(res, true);
    }

    return fail(res, '未知 action: ' + action);
  } catch (e) {
    return fail(res, e.message || '服务异常');
  }
});

// SPA 兜底：所有非 /api 路由返回 index.html
app.get('*', (req, res) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) {
    return res.status(404).json({ ok: false, msg: 'Not found' });
  }
  const indexPath = path.join(PUBLIC_DIR, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.send('总务报修系统正在启动中，前端资源加载中...');
  }
});

// 启动监听
app.listen(PORT, '0.0.0.0', () => {
  console.log(`===============================================`);
  console.log(`🚀 学校总务报修管理系统 (本地Docker版) 已启动`);
  console.log(`📡 服务监听地址: http://0.0.0.0:${PORT}`);
  console.log(`📁 数据目录: ${DATA_DIR}`);
  console.log(`🖼️ 图片目录: ${UPLOAD_DIR}`);
  console.log(`===============================================`);
});

