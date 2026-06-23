import { test, expect } from '@playwright/test'

// 凍結所有動畫/轉場：讓游動的魚靜止（可穩定點擊）且不被 onAnimationEnd 自動移除。
const FREEZE_CSS = '*, *::before, *::after { animation: none !important; transition: none !important; }'

test.describe('捕魚機 e2e（mock 模式）', () => {
  // Phase 2：漁場由 DOM 改為 PixiJS canvas，舊的 `.fishing-fish` / `data-fish-id` 選擇器與
  // 「已射擊 N 發」aside 文案已不存在；canvas 內的魚需用座標點擊、且 ticker 非 CSS 動畫無法用
  // FREEZE_CSS 凍結。canvas 版 e2e 留 Phase 4 重寫（改用 canvas 座標點擊取代 DOM 選擇器）。
  test.skip('進場 → 開火 → 收網 → 逐發公平性驗證', async ({ page }) => {
    await page.addInitScript((css) => {
      const inject = () => {
        const style = document.createElement('style')
        style.id = 'e2e-freeze'
        style.textContent = css
        document.head.appendChild(style)
      }
      if (document.head) inject()
      else window.addEventListener('DOMContentLoaded', inject)
    }, FREEZE_CSS)

    // 1) 以 mock 測試帳號登入
    await page.goto('/member?mode=login')
    await page.fill('input[name="username"]', 'test')
    await page.fill('input[name="password"]', 'test1234')
    await page.locator('form button[type="submit"]').click()
    // 登入成功會離開登入頁（表單消失）
    await expect(page.locator('input[name="username"]')).toHaveCount(0)

    // 2) 進入捕魚機（整頁導航；auth 由 localStorage 水合，PrivateRoute 通過）
    await page.goto('/game/fishing')
    const enterBtn = page.getByRole('button', { name: /進場/ })
    await expect(enterBtn).toBeVisible()
    await enterBtn.click()

    // 3) 漁場出現，開火數發
    const arena = page.locator('.fishing-arena')
    await expect(arena).toBeVisible()
    await page.addStyleTag({ content: FREEZE_CSS }) // 對已渲染畫面再保險
    await expect(page.locator('.fishing-fish').first()).toBeVisible()

    for (let i = 0; i < 12; i++) {
      const fish = page.locator('.fishing-fish').first()
      try {
        await fish.click({ timeout: 1000, force: true })
      } catch {
        // 該魚剛被捕獲移除：略過，下一輪取新的 first()
      }
      await page.waitForTimeout(120)
    }
    // 等批次 flush（700ms 間隔）把逐發結果記錄進場次
    await page.waitForTimeout(1500)

    // 本場派彩 metric 應顯示已射擊發數 > 0
    await expect(page.getByText(/已射擊 [1-9]\d* 發/)).toBeVisible()

    // 4) 收網結算
    await page.getByRole('button', { name: '收網結算' }).click()
    await expect(page.getByText('本場結算完成')).toBeVisible()

    // 5) 逐發公平性驗證面板
    await expect(page.getByText('逐發公平性驗證')).toBeVisible()
    const verifyBtn = page.getByRole('button', { name: '驗證', exact: true }).first()
    await expect(verifyBtn).toBeVisible()
    await verifyBtn.click()
    // 驗證成功：該列顯示「✓ 已驗證」
    await expect(page.getByText('✓ 已驗證').first()).toBeVisible()
  })
})
