-- Cloudflare D1 数据库初始化表结构定义
-- 可在 Cloudflare 控制台 D1 界面中直接执行，系统也已内置首次访问自动建表功能

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
