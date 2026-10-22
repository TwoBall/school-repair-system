# ==========================================
# 学校总务报修管理系统 - Docker 镜像构建
# ==========================================
FROM node:22-bookworm-slim

# 设置工作目录
WORKDIR /app

# 安装编译原生模块所需的构建工具 (better-sqlite3 编译必须的 python3, make, g++) 及 curl
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    curl \
    && rm -rf /var/lib/apt/lists/*

# 复制依赖定义
COPY package*.json ./

# 安装生产依赖并自动编译原生模块
RUN npm install --omit=dev

# 复制工程源码
COPY . .

# 创建持久化数据目录及上传图片目录
RUN mkdir -p /app/data /app/uploads

# 声明持久化卷（数据库和上传照片挂载点）
VOLUME ["/app/data", "/app/uploads"]

# 暴露服务端口
EXPOSE 3000

# 默认环境变量
ENV PORT=3000
ENV NODE_ENV=production
ENV DATA_DIR=/app/data
ENV UPLOAD_DIR=/app/uploads

# 容器健康检查（动态匹配配置的 PORT）
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:${PORT:-3000}/api/health || exit 1

# 启动服务
CMD ["node", "server/index.js"]
