import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        worker: resolve(import.meta.dirname, 'worker.html'),
        admin: resolve(import.meta.dirname, 'admin.html'),
      },
    },
  },
  server: {
    port: 5173,
    // 后端是 Cloudflare Pages Functions，仓库里没有 3000 端口的服务。
    // 要联调得另开一个终端跑 wrangler，再把 /api 代理过去：
    //   npx wrangler pages dev --port 8788
    // 端口不一致时用 VITE_API_TARGET=http://localhost:xxxx npm run dev 覆盖。
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://localhost:8788',
        changeOrigin: true,
      },
    },
  },
});
