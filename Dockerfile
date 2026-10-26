# ========================================================
# Stage 1: 构建阶段 (编译前端并安装生产依赖)
# ========================================================
FROM node:20-slim AS builder

WORKDIR /app

# 替换为国内镜像源（阿里云/清华源），大幅加速国内服务器构建速度
RUN if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
      sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list.d/debian.sources; \
    elif [ -f /etc/apt/sources.list ]; then \
      sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list; \
    fi && \
    apt-get update && apt-get install -y --no-install-recommends \
      python3 \
      make \
      g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json ./

# 配置 npm 使用国内淘宝镜像源加速下载
RUN npm config set registry https://registry.npmmirror.com && \
    npm install

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

# 替换国内源加速 tzdata 安装
RUN if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
      sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list.d/debian.sources; \
    elif [ -f /etc/apt/sources.list ]; then \
      sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list; \
    fi && \
    apt-get update && apt-get install -y --no-install-recommends tzdata \
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
