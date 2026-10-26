/**
 * 学校总务报修管理系统 - Node.js / Docker 生产环境入口服务
 * 
 * 核心功能：
 * 1. 静态资源托管：提供前端 dist 目录静态页面（/、/worker、/admin）
 * 2. 边缘网关适配：将 /api/* 请求桥接到 functions/api/[[route]].js
 * 3. 驱动兼容层：
 *    - DB: 基于 better-sqlite3 实现 Cloudflare D1 规范
 *    - PHOTOS: 基于本地磁盘目录实现 Cloudflare R2 规范
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { onRequest } from './functions/api/[[route]].js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ------------------- 配置项 -------------------
const PORT = parseInt(process.env.PORT, 10) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, 'data');
const STATIC_DIR = process.env.STATIC_DIR || path.resolve(__dirname, 'dist');
const ASSETS_DIR = path.resolve(__dirname, 'assets');

// 确保数据存储目录存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
const DB_PATH = path.join(DATA_DIR, 'school-repair.db');
const PHOTOS_DIR = path.join(DATA_DIR, 'photos');
if (!fs.existsSync(PHOTOS_DIR)) {
  fs.mkdirSync(PHOTOS_DIR, { recursive: true });
}

// ------------------- 1. Cloudflare D1 (SQLite) 驱动兼容层 -------------------
function createD1(dbPath) {
  const sqlite = new Database(dbPath);
  // 启用 WAL 模式提高并发性能
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');

  function createStatement(sql, initialArgs = []) {
    let boundArgs = initialArgs;

    return {
      bind(...args) {
        return createStatement(sql, args);
      },
      async first(col) {
        const stmt = sqlite.prepare(sql);
        const row = stmt.get(...boundArgs);
        if (!row) return null;
        if (typeof col === 'string') return row[col];
        return row;
      },
      async all() {
        const stmt = sqlite.prepare(sql);
        const results = stmt.all(...boundArgs);
        return { results: results || [] };
      },
      async run() {
        const stmt = sqlite.prepare(sql);
        const info = stmt.run(...boundArgs);
        return {
          changes: info.changes,
          meta: { changes: info.changes, last_row_id: info.lastInsertRowid },
        };
      },
      _runSync() {
        return sqlite.prepare(sql).run(...boundArgs);
      },
    };
  }

  return {
    async exec(sql) {
      sqlite.exec(sql);
    },
    prepare(sql) {
      return createStatement(sql);
    },
    async batch(stmts) {
      const runTx = sqlite.transaction((list) => {
        for (const s of list) {
          if (s && typeof s._runSync === 'function') {
            s._runSync();
          } else if (s && typeof s.run === 'function') {
            s.run();
          }
        }
      });
      runTx(stmts);
    },
    close() {
      sqlite.close();
    },
  };
}

// ------------------- 2. Cloudflare R2 (本地照片) 驱动兼容层 -------------------
function createR2(photosDir) {
  const MIME_MAP = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
  };

  return {
    async put(fileKey, streamOrBuffer) {
      const destPath = path.join(photosDir, fileKey);
      if (streamOrBuffer && typeof streamOrBuffer.getReader === 'function') {
        // Web ReadableStream
        const out = fs.createWriteStream(destPath);
        await pipeline(Readable.fromWeb(streamOrBuffer), out);
      } else if (Buffer.isBuffer(streamOrBuffer)) {
        await fs.promises.writeFile(destPath, streamOrBuffer);
      } else if (streamOrBuffer instanceof ArrayBuffer) {
        await fs.promises.writeFile(destPath, Buffer.from(streamOrBuffer));
      } else {
        const out = fs.createWriteStream(destPath);
        await pipeline(streamOrBuffer, out);
      }
    },
    async get(fileKey) {
      const filePath = path.join(photosDir, fileKey);
      if (!fs.existsSync(filePath)) return null;
      const stat = await fs.promises.stat(filePath);
      const ext = path.extname(fileKey).toLowerCase();
      const mime = MIME_MAP[ext] || 'application/octet-stream';
      return {
        body: Readable.toWeb(fs.createReadStream(filePath)),
        httpEtag: `"${Math.floor(stat.mtimeMs)}-${stat.size}"`,
        writeHttpMetadata(headers) {
          headers.set('content-type', mime);
        },
      };
    },
  };
}

// 初始化驱动实例
const d1Db = createD1(DB_PATH);
const r2Photos = createR2(PHOTOS_DIR);

const cfEnv = {
  DB: d1Db,
  D1: d1Db,
  PHOTOS: r2Photos,
  BUCKET: r2Photos,
  R2: r2Photos,
  JWT_SECRET: process.env.JWT_SECRET || '',
};

// ------------------- 3. 静态文件 MIME 与处理器 -------------------
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

async function serveStaticFile(filePath, res) {
  try {
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) return false;

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stat.size,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    });
    fs.createReadStream(filePath).pipe(res);
    return true;
  } catch {
    return false;
  }
}

// ------------------- 4. HTTP 主服务 -------------------
const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = urlObj.pathname;

  // 1. API 路由分发 -> Cloudflare Pages Functions
  if (pathname.startsWith('/api/')) {
    try {
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (v === undefined) continue;
        if (Array.isArray(v)) {
          for (const item of v) headers.append(k, item);
        } else {
          headers.set(k, v);
        }
      }

      const reqInit = {
        method: req.method,
        headers,
      };

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        reqInit.body = Readable.toWeb(req);
        reqInit.duplex = 'half';
      }

      const webReq = new Request(urlObj.toString(), reqInit);
      const waitUntil = (promise) => Promise.resolve(promise).catch((err) => console.error('[waitUntil error]', err));

      const webRes = await onRequest({
        request: webReq,
        env: cfEnv,
        waitUntil,
      });

      res.statusCode = webRes.status;
      for (const [k, v] of webRes.headers.entries()) {
        res.setHeader(k, v);
      }

      if (webRes.body) {
        Readable.fromWeb(webRes.body).pipe(res);
      } else {
        res.end();
      }
      return;
    } catch (err) {
      console.error('[API Gateway Error]', err);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, msg: '服务器内部错误: ' + (err.message || '') }));
      return;
    }
  }

  // 2. 静态页面与资源路由
  // 页面入口映射
  let targetFile = null;
  if (pathname === '/' || pathname === '/index.html') {
    targetFile = path.join(STATIC_DIR, 'index.html');
  } else if (pathname === '/worker' || pathname === '/worker/' || pathname === '/worker.html') {
    targetFile = path.join(STATIC_DIR, 'worker.html');
  } else if (pathname === '/admin' || pathname === '/admin/' || pathname === '/admin.html') {
    targetFile = path.join(STATIC_DIR, 'admin.html');
  } else if (pathname.startsWith('/assets/qr/')) {
    // 兼容二维码资源路径
    targetFile = path.join(ASSETS_DIR, 'qr', pathname.replace('/assets/qr/', ''));
  } else {
    // 其它静态资源（如 /assets/*.js /assets/*.css）
    targetFile = path.join(STATIC_DIR, pathname);
  }

  const served = await serveStaticFile(targetFile, res);
  if (!served) {
    // 404 处理
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
  }
});

// 优雅停机
const gracefulShutdown = () => {
  console.log('\n[Server] 正在停止服务...');
  server.close(() => {
    d1Db.close();
    console.log('[Server] 数据库已关闭，服务已退出。');
    process.exit(0);
  });
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

server.listen(PORT, HOST, () => {
  console.log(`====================================================`);
  console.log(` 学校总务报修管理系统 (Docker / Node.js 独立服务) `);
  console.log(`====================================================`);
  console.log(`服务监听地址: http://${HOST}:${PORT}`);
  console.log(`  - 师生报修端:   http://localhost:${PORT}/`);
  console.log(`  - 师傅工作台:   http://localhost:${PORT}/worker`);
  console.log(`  - 总务处后台:   http://localhost:${PORT}/admin`);
  console.log(`数据存储目录: ${DATA_DIR}`);
  console.log(`  - 数据库文件: ${DB_PATH}`);
  console.log(`  - 照片存储目录: ${PHOTOS_DIR}`);
  console.log(`====================================================`);
});
