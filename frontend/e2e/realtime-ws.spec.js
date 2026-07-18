import { expect, test } from '@playwright/test'

/**
 * T-084 即時推播（WebSocket/STOMP）端對端驗收——串真後端。
 *
 * 驗證前端 useWebSocket/RealtimeBridge 對真實 notification-service 的完整鏈路：
 *   UI 登入 → SockJS/STOMP 連 gateway /ws（CONNECT 帧帶 JWT）→ CONNECTED
 *   → API 觸發 slot spin → game.result → notification 推播 /user/queue/notifications
 *   → 通知鈴鐺 badge 亮起、通知中心出現「遊戲結果通知」
 *
 * 前置：docker compose 全 healthy（gateway 8080 可達）。
 * 執行：npm run e2e:realws（內含 E2E_REAL_BACKEND=1；未設該旗標時本檔整組 skip，
 *       確保 CI 的 mock e2e（playwright.config.js）永不誤跑需要後端的測項）。
 */

const GATEWAY = process.env.GATEWAY_URL || 'http://localhost:8080'

async function api(method, path, { token, body } = {}) {
  const headers = {}
  if (token) headers['Authorization'] = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${GATEWAY}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => null)
  return { status: res.status, data: json && typeof json === 'object' && 'data' in json ? json.data : json }
}

// 真後端玩家的自動簽到彈窗無法靠 localStorage 預先壓掉（key 含 playerId，登入前未知），
// 出現就關掉（沿用 smoke.spec.js 的作法）。
async function dismissOptionalCheckIn(page) {
  const dialog = page.locator('section[aria-labelledby="daily-checkin-title"]')
  if (!(await dialog.waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false))) {
    return
  }
  await dialog.locator('button').first().click()
  await expect(dialog).toBeHidden()
}

test.describe('T-084 即時推播端對端驗收（真後端）', () => {
  test.skip(process.env.E2E_REAL_BACKEND !== '1', '需要真後端：docker compose up 後以 npm run e2e:realws 執行')

  const stamp = Date.now()
  const cred = {
    username: `t084_${stamp}`,
    email: `t084_${stamp}@realws.test`,
    password: 'realws1234',
    nickname: 'RealWsBot',
  }
  let apiToken

  test.beforeAll(async () => {
    // 走 API 準備玩家與資金：註冊 → 登入拿 token → 等錢包（Kafka 非同步建立）→ 注資。
    // UI 只負責「登入 + 收推播」——這正是 T-084 的驗收邊界。
    const reg = await api('POST', '/api/v1/auth/register', { body: cred })
    expect(reg.status, '註冊玩家').toBe(201)

    const login = await api('POST', '/api/v1/auth/login', {
      body: { username: cred.username, password: cred.password },
    })
    expect(login.status, 'API 登入').toBe(200)
    apiToken = login.data.accessToken

    let walletReady = false
    for (let i = 0; i < 20; i++) {
      const r = await api('GET', '/api/v1/wallet/balance', { token: apiToken })
      if (r.status === 200) { walletReady = true; break }
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    expect(walletReady, '錢包於 20s 內建立').toBe(true)

    const aid = await api('POST', '/api/v1/wallet/bankruptcy-aid', { token: apiToken })
    expect(aid.status, '注資 1000').toBe(200)
  })

  test('UI 登入 → STOMP CONNECTED → spin 觸發 → 通知中心收到遊戲結果推播', async ({ page }) => {
    // 1) UI 登入（表單預填 mock 帳密，需整欄改填真後端玩家）
    await page.goto('/member?mode=login')
    await page.locator('input[name="username"]').fill(cred.username)
    await page.locator('input[name="password"]').fill(cred.password)

    // 登入成功 → token 進 redux → useWebSocket 開始連線；先掛好 WS 攔截再送出表單
    const wsPromise = page.waitForEvent('websocket', { timeout: 20_000 })
    await page.locator('form button[type="submit"]').click()
    await expect(page).toHaveURL(/\/games$/)

    // 2) 斷言 SockJS websocket transport 建立 + 收到 STOMP CONNECTED 帧（連線鑑權成功的硬證據）
    const ws = await wsPromise
    expect(ws.url(), 'SockJS 端點走 gateway /ws').toContain('/ws')
    await ws.waitForEvent('framereceived', {
      predicate: (frame) => String(frame.payload).includes('CONNECTED'),
      timeout: 15_000,
    })

    await dismissOptionalCheckIn(page)

    // 3) API 觸發下注（每局 spin 後端都會發 game.result → 推播到本玩家私人佇列）
    const spin = await api('POST', '/api/v1/game/slot/spin', { token: apiToken, body: { bet: 100 } })
    expect(spin.status, 'slot spin').toBe(200)

    // 4) 推播到達 UI：鈴鐺 badge 亮起（redux gameSlice.notifications 進資料）
    const bell = page.locator('button[aria-label="通知中心"]')
    await expect(bell.locator('span'), '通知 badge 亮起').toBeVisible()

    // 5) 打開通知中心，確認 GAME_RESULT 被 toNotification 正規化為「遊戲結果通知」
    await bell.click()
    await expect(page.getByText('遊戲結果通知').first()).toBeVisible()
  })
})
