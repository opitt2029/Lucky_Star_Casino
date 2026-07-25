import { expect, test } from '@playwright/test'

/**
 * 全螢幕版面穩定性回歸測試。
 *
 * 守的是同一類 bug：全螢幕容器把高度分配交給「子元素數量 / 內容多寡」，於是玩家
 * 一按下注、一開抽屜，整個版面就重排或被裁掉。三款遊戲各踩過一次不同形狀的它：
 *   · 老虎機   PR #255：機台 grid 宣告 4 列卻有 5 個子元素，1fr 落在裝飾層上
 *   · 百家樂   本次：table 宣告 3 列但狀態列與路紙都 display:none，牌桌掉進 auto 列
 *   · 捕魚機   本次：play-surface 內「height:100% 的舞台卡 + 統計抽屜」總和溢出
 *
 * 因此斷言統一寫成「做完一次真實操作之後，關鍵容器的座標/尺寸必須完全不變」，
 * 而不是去比對某個寫死的像素值——後者會隨美術調整誤報，前者才是真正的不變量。
 */

const VIEWPORTS = [
  { width: 1920, height: 1080, name: '1920x1080' },
  { width: 1366, height: 768, name: '1366x768' },
]

async function login(page) {
  await page.addInitScript(() => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date())
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
    localStorage.setItem(
      'lucky-star-checkin-auto-open-v1',
      JSON.stringify({ 'test-player': `${values.year}-${values.month}-${values.day}` }),
    )
  })
  await page.goto('/member?mode=login')
  await page.locator('form button[type="submit"]').click()
  await page.waitForURL(/\/games$/)
}

/** 量到整數像素即可：亞像素抖動不是版面 bug，四捨五入後仍不同才是。 */
async function boxOf(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
  }, selector)
}

/** 全螢幕容器一旦 scrollHeight > clientHeight，瀏覽器就能把它「捲走」而玩家沒有捲軸捲回來。 */
async function scrollState(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    return { scrollH: el.scrollHeight, clientH: el.clientHeight, scrollTop: el.scrollTop }
  }, selector)
}

/**
 * 進入全螢幕並等到版面真的收斂。
 *
 * 只等 document.fullscreenElement 不夠：那只代表瀏覽器換了模式，React 要下一個
 * render 才會把 `--fullscreen` class 掛上去，中間有一個影格量到的仍是「頁面內」
 * 的舊尺寸。三個條件都成立（模式切了、class 掛上了、容器撐滿視窗）才算收斂。
 */
async function enterFullscreen(page, buttonLocator, surfaceSelector) {
  await buttonLocator.click()
  await expect
    .poll(async () =>
      page.evaluate((sel) => {
        const el = document.querySelector(sel)
        if (!el || document.fullscreenElement !== el) return false
        if (!el.className.includes('--fullscreen')) return false
        const r = el.getBoundingClientRect()
        return Math.round(r.height) === window.innerHeight && Math.round(r.width) === window.innerWidth
      }, surfaceSelector),
    )
    .toBe(true)
}

/**
 * 等某個元素的方框連續兩次取樣都一樣，才算版面收斂。
 *
 * 「class 掛上了 + 容器撐滿視窗」只保證外框就位，裡面還會再排一次：字體換裝、
 * 圖片解碼、Pixi 依容器尺寸重建畫布，都會讓內層在之後幾個影格再動一次。
 * 在那之前取的 before 值是中間態，比對必然失敗——失敗的是測試時機，不是版面。
 */
async function waitForLayoutSettled(page, selector) {
  let previous = null
  await expect
    .poll(
      async () => {
        const current = await boxOf(page, selector)
        const stable = Boolean(current) && JSON.stringify(current) === JSON.stringify(previous)
        previous = current
        return stable
      },
      { intervals: [150, 150, 150, 200, 300, 500] },
    )
    .toBe(true)
}

for (const viewport of VIEWPORTS) {
  test.describe(`全螢幕版面穩定性 @ ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } })

    // 全螢幕是「瀏覽器視窗」層級的狀態，會跨 test 留給下一個 page，讓下一支測試
    // 在一個已經是全螢幕的視窗裡再 requestFullscreen，量到的中間狀態就會飄。
    test.afterEach(async ({ page }) => {
      await page.evaluate(() => document.fullscreenElement && document.exitFullscreen()).catch(() => {})
    })

    test('老虎機：SPIN 一局前後轉輪窗不位移，全螢幕容器不可捲動', async ({ page }) => {
      await login(page)
      await page.goto('/game/slot')
      await page.waitForSelector('.slot-machine')
      await enterFullscreen(page, page.locator('.slot-fullscreen-button'), '.slot-game-surface')
      // 轉輪窗高度是 ResizeObserver 量出來的，要等它量完才有穩定基準值。
      await waitForLayoutSettled(page, '.slot-cabinet')
      const before = await boxOf(page, '.slot-cabinet')
      expect(before).not.toBeNull()
      expect(await scrollState(page, '.slot-game-surface')).toMatchObject({ scrollTop: 0 })

      await page.locator('.slot-spin-button').click()
      // 轉輪演出約 2.6s（含 near-miss 的 +0.9s），等按鈕自己解除 disabled 才算一局結束。
      await expect(page.locator('.slot-spin-button')).toBeEnabled({ timeout: 20_000 })

      expect(await boxOf(page, '.slot-cabinet')).toEqual(before)

      const scroll = await scrollState(page, '.slot-game-surface')
      expect(scroll.scrollTop).toBe(0)
      expect(scroll.scrollH).toBeLessThanOrEqual(scroll.clientH + 1)
    })

    test('百家樂：下注發牌前後牌桌尺寸與列高完全不變', async ({ page }) => {
      await login(page)
      await page.goto('/game/baccarat')
      await page.waitForSelector('.baccarat-table')
      await enterFullscreen(
        page,
        page.locator('.baccarat-table-header button', { hasText: '全螢幕' }).first(),
        '.baccarat-table',
      )

      // 牌桌列高受結算面板高度影響，等它連兩次量測一致才是穩定基準值。
      await waitForLayoutSettled(page, '.baccarat-table-felt')
      const feltBefore = await boxOf(page, '.baccarat-table-felt')
      const rowsBefore = await page.evaluate(
        () => getComputedStyle(document.querySelector('.baccarat-table-felt')).gridTemplateRows,
      )
      expect(feltBefore).not.toBeNull()

      await page.locator('.baccarat-bet-zone').first().click()
      await page.locator('.baccarat-chip-tray button', { hasText: /發牌|下一局/ }).first().click()
      await expect(page.locator('.baccarat-table--settled')).toBeVisible({ timeout: 20_000 })

      // 牌桌是全螢幕的主角：它一動，表頭以下整塊都會跟著跑。
      expect(await boxOf(page, '.baccarat-table-felt')).toEqual(feltBefore)
      expect(
        await page.evaluate(() => getComputedStyle(document.querySelector('.baccarat-table-felt')).gridTemplateRows),
      ).toBe(rowsBefore)
    })

    test('捕魚機：全螢幕容器不可捲動，展開捕獲統計不會把畫面推走', async ({ page }) => {
      await login(page)
      await page.goto('/game/fishing')
      await page.waitForSelector('.fishing-lobby')
      await enterFullscreen(page, page.locator('.fishing-canvas__fullscreen-button').first(), '.fishing-main')

      await page.locator('.fishing-buyin-panel button.red-gold-button').click()
      await expect(page.locator('.fishing-catch-stats-drawer')).toBeVisible({ timeout: 30_000 })

      await waitForLayoutSettled(page, '.fishing-flowbar')
      // Pixi 依容器尺寸建畫布，進場後還會再排一次版；等舞台卡定下來再取基準值。
      await waitForLayoutSettled(page, '.fishing-stage-card')

      const flowbarBefore = await boxOf(page, '.fishing-flowbar')
      const stageBefore = await boxOf(page, '.fishing-stage-card')
      const canvasBefore = await boxOf(page, '.fishing-arena canvas')
      const scrollBefore = await scrollState(page, '.fishing-main')
      expect(scrollBefore.scrollH).toBeLessThanOrEqual(scrollBefore.clientH + 1)

      await page.locator('.fishing-catch-stats-drawer__summary').click()
      await expect(page.locator('.fishing-catch-stats-drawer')).toHaveJSProperty('open', true)

      // 抽屜展開時整個全螢幕面板不得被推走。
      const scrollAfter = await scrollState(page, '.fishing-main')
      expect(scrollAfter.scrollTop).toBe(0)
      expect(scrollAfter.scrollH).toBeLessThanOrEqual(scrollAfter.clientH + 1)
      expect(await boxOf(page, '.fishing-flowbar')).toEqual(flowbarBefore)

      // 展開的內容是往舞台「之上」浮，不是去擠舞台的高度：canvas 一縮，Pixi 就會
      // 重算尺寸讓整批魚跳位，那是同一個 bug 的另一種形狀。
      expect(await boxOf(page, '.fishing-stage-card')).toEqual(stageBefore)
      expect(await boxOf(page, '.fishing-arena canvas')).toEqual(canvasBefore)

      // 浮層本身必須留在視窗內（bottom: 100% 若以錯的定位祖先起算就會飛出畫面）。
      const panel = await boxOf(page, '.fishing-catch-stats-drawer__panel')
      expect(panel.y).toBeGreaterThanOrEqual(0)
      expect(panel.y + panel.h).toBeLessThanOrEqual(viewport.height)
    })
  })
}
