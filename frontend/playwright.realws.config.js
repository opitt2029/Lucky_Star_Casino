import { defineConfig, devices } from '@playwright/test'

// T-084 即時推播端對端驗收：以 realws 模式（.env.realws：關 mock、開 WS）啟動 dev server，
// 串真後端（docker compose 拓樸，gateway 8080）。與預設 playwright.config.js（mock、免後端）
// 分開成獨立 config，避免 CI 的 mock e2e 誤跑到需要後端的測項。
// 執行：E2E_REAL_BACKEND=1 npx playwright test -c playwright.realws.config.js（或 npm run e2e:realws）
const PORT = 5318
const BASE_URL = `http://localhost:${PORT}`

// 選用本 config 即代表「我要跑真後端驗收」——旗標在此補上，免裝 cross-env
// （Windows cmd 不吃 `VAR=1 cmd` 前綴）。預設 config（mock e2e）沒有這行，spec 照樣整組 skip。
process.env.E2E_REAL_BACKEND = process.env.E2E_REAL_BACKEND ?? '1'

export default defineConfig({
  testDir: './e2e',
  testMatch: 'realtime-ws.spec.js',
  timeout: 90_000,
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
    command: `npm run dev -- --mode realws --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
