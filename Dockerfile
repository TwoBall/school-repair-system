# ========================================================
# Stage 1: 构建阶段 (编译前端并安装生产依赖)
# ========================================================
FROM node:20-slim AS builder

WORKDIR /app

# 安装构建原生模块 (better-sqlite3) 所需的基础工具
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json ./

# 安装全量依赖（包含 vite 等构建工具）
RUN npm install

COPY . .

# 执行 Vite 构建生成 dist 目录，并移除开发依赖只保留生产运行时模块
RUN npm run build && npm prune --omit=dev

# ========================================================
# Stage 2: 生产运行阶段 (精简运行时镜像)
# ========================================================
FROM node:20-slim AS runner

WORKDIR /app

# 设置时区及运行环境变量
ENV TZ=Asia/Shanghai \
    NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    DATA_DIR=/app/data \
    STATIC_DIR=/app/dist

# 安装时区支持，创建数据挂载目录
RUN apt-get update && apt-get install -y --no-install-recommends tzdata \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app/data

# 复制前端编译产物与生产依赖
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules

# 复制服务端运行代码与资源
COPY package.json server.js ./
COPY functions ./functions
COPY assets ./assets

# 持久化数据卷（包含数据库 school-repair.db 与 photos 目录）
VOLUME ["/app/data"]

EXPOSE 8080

CMD ["node", "server.js"]

