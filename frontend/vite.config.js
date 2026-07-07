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
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:8080',
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
