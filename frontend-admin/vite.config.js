import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{js,jsx}'],
  },
  server: {
    // 5174：與玩家端 5173 並行開發不衝突
    port: 5174,
    // 後台 API 走 dev proxy 轉發 gateway（8080），瀏覽器視角是同源請求，
    // 不需要把 5174 加進 gateway 的 CORS_ALLOWED_ORIGINS 白名單。
    // 注意：SPA 自身路由不使用 /admin 前綴（見 App.jsx），故不會與此 proxy 撞路徑。
    proxy: {
      '/admin': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
})
