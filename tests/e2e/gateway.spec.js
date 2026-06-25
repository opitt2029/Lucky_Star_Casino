// @ts-check
import { test, expect } from '@playwright/test';

/**
 * Gateway 範例測試（API testing）
 *
 * 前置：先把完整服務拓撲跑起來（見 DEPLOY.md），gateway 監聽 8080。
 * 跑法：npx playwright test
 *
 * `request` 是 Playwright 內建的 API 測試 fixture，不開瀏覽器，
 * 直接發 HTTP 請求 —— 適合測後端 gateway。
 */

test.describe('Gateway 健康檢查', () => {
  // /actuator/health 在 gateway 白名單內，免 JWT 即可打
  test('GET /actuator/health 應回 200 且 status=UP', async ({ request }) => {
    const res = await request.get('/actuator/health');

    // 1. HTTP 狀態碼應為 200
    expect(res.status()).toBe(200);

    // 2. 回傳 JSON 的 status 欄位應為 "UP"
    const body = await res.json();
    expect(body.status).toBe('UP');
  });
});

test.describe('Gateway JWT 守門', () => {
  // 沒帶 token 打受保護路由，應被擋（401）
  test('未帶 JWT 打受保護路由應回 401', async ({ request }) => {
    // /api/v1/wallet/** 需要 JWT；不帶 token 應被 gateway 擋下
    const res = await request.get('/api/v1/wallet/balance');

    expect(res.status()).toBe(401);
  });
});
