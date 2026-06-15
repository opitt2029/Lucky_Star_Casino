import { defineConfig, devices } from '@playwright/test'

// 捕魚機前端 e2e：以 mock 模式啟動 dev server（--mode mock 載入 .env.mock.local），
// 全程不需後端。執行：npm run e2e
const PORT = 5317
const BASE_URL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run dev -- --mode mock --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
