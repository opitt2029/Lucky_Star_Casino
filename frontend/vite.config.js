import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  define: {
    global: 'globalThis',
  },
  // Vitest 單元測試設定（e2e 的 Playwright 走 npm run e2e，與此分開）
  test: {
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{js,jsx}'],
  },
  server: {
    port: 5173,
    fs: {
      // mockApi.js import repo 根 contracts/*.json（玩法契約單一來源，Phase 5）；
      // dev server 預設只允許讀專案根內檔案，需放行 ../contracts。
      // 注意：自訂 allow 會覆蓋預設值，故要把自身根目錄 '.' 一併列入。
      allow: ['.', '../contracts'],
    },
    proxy: {
      // 經 dev proxy 的請求對瀏覽器是同源，但瀏覽器仍會帶 Origin header（POST 一律帶）；
      // 原樣轉發會讓 gateway 的 CORS 白名單（只認 5173/5174）誤判為跨源請求而 403。
      // 剝掉 Origin → gateway 視為一般非 CORS 請求放行；任何 dev/e2e port（如 realws 5318）都通用。
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => proxyReq.removeHeader('origin'))
        },
      },
      '/ws': {
        target: 'ws://localhost:8080',
        ws: true,
        changeOrigin: true,
        configure: (proxy) => {
          // WS upgrade 走 proxyReqWs（proxyReq 只涵蓋一般 HTTP，如 SockJS /ws/info）
          proxy.on('proxyReq', (proxyReq) => proxyReq.removeHeader('origin'))
          proxy.on('proxyReqWs', (proxyReq) => proxyReq.removeHeader('origin'))
        },
      },
    },
  },
})
