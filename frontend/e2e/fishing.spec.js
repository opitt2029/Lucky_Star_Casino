import { test, expect } from '@playwright/test'

async function suppressAutoCheckInAndRules(page) {
  await page.addInitScript(() => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date())
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
    const todayKey = `${values.year}-${values.month}-${values.day}`

    localStorage.setItem(
      'lucky-star-checkin-auto-open-v1',
      JSON.stringify({ 'test-player': todayKey })
    )
    localStorage.setItem('lucky-star-game-rule-dismissed:fishing', '1')
  })
}

async function loginWithMockAccount(page) {
  await suppressAutoCheckInAndRules(page)
  await page.goto('/member?mode=login')
  await page.locator('form button[type="submit"]').click()
  await page.waitForURL(/\/games$/)
}

async function fireCanvasBurst(page) {
  const canvas = page.getByTestId('fishing-canvas').locator('canvas')
  await expect(canvas).toBeVisible({ timeout: 30_000 })

  const box = await canvas.boundingBox()
  expect(box).not.toBeNull()

  const points = [
    [0.5, 0.42],
    [0.34, 0.36],
    [0.66, 0.36],
    [0.43, 0.56],
    [0.57, 0.56],
    [0.5, 0.28],
  ]

  for (const [xRatio, yRatio] of points) {
    const x = box.x + box.width * xRatio
    const y = box.y + box.height * yRatio
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.waitForTimeout(140)
    await page.mouse.up()
    await page.waitForTimeout(80)
  }
}

async function numberFromTestId(page, testId) {
  const raw = await page.getByTestId(testId).innerText()
  return Number(raw.replace(/[^0-9.-]/g, '')) || 0
}

test.describe('fishing Pixi canvas e2e (mock mode)', () => {
  test('enters, fires through the canvas engine, settles, and shows results', async ({ page }) => {
    await loginWithMockAccount(page)

    await page.goto('/game/fishing')
    await expect(page.getByTestId('fishing-start')).toBeEnabled({ timeout: 15_000 })
    await page.getByTestId('fishing-start').click()

    await expect(page.getByTestId('fishing-total-shots')).toContainText('0')
    await fireCanvasBurst(page)

    await expect
      .poll(() => numberFromTestId(page, 'fishing-total-shots'), { timeout: 10_000 })
      .toBeGreaterThan(0)

    await expect(page.getByTestId('fishing-settle')).toBeEnabled({ timeout: 10_000 })
    await page.getByTestId('fishing-settle').click()
    await expect(page.getByTestId('fishing-settlement-panel')).toBeVisible({ timeout: 30_000 })
  })
})
