// @ts-check
import { defineConfig } from '@playwright/test';

/**
 * Playwright 設定檔
 * 文件：https://playwright.dev/docs/test-configuration
 *
 * 本專案 gateway 是後端 API（非網頁 UI），所以範例用 API testing。
 * baseURL 指向 gateway（8080），測試裡用相對路徑即可。
 */
export default defineConfig({
  // 測試檔放這個資料夾
  testDir: './tests/e2e',

  // 每個測試最長 30 秒
  timeout: 30 * 1000,

  // 全部測試平行跑（加速）
  fullyParallel: true,

  // CI 上禁止留 test.only（避免漏跑），失敗自動重試 2 次
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,

  // 測試報告：HTML（跑完用 `npx playwright show-report` 看）
  reporter: 'html',

  use: {
    // 所有 request 的基底網址；可用 BASE_URL 環境變數覆蓋
    baseURL: process.env.BASE_URL || 'http://localhost:8080',

    // 失敗時保留追蹤檔，方便除錯
    trace: 'on-first-retry',
  },
});
