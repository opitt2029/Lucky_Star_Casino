import { test, expect } from '@playwright/test'

async function suppressAutoCheckIn(page) {
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
    localStorage.setItem('lucky-star-diamond-guide-dismissed-v1', '1')
    localStorage.setItem('lucky-star-topup-terms-dismissed-v1', '1')
    ;['slot', 'baccarat', 'fishing'].forEach((game) => {
      localStorage.setItem(`lucky-star-game-rule-dismissed:${game}`, '1')
    })
  })
}

test.describe('mobile bottom navigation', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('navigates core player pages and stays hidden on game pages', async ({ page }) => {
    await suppressAutoCheckIn(page)
    await page.goto('/member?mode=login')
    await page.locator('form button[type="submit"]').click()
    await page.waitForURL(/\/games$/)

    await expect(page.getByTestId('mobile-bottom-nav')).toBeVisible()

    await page.getByTestId('mobile-nav-rank').click()
    await expect(page).toHaveURL(/\/rank$/)
    await expect(page.getByTestId('mobile-bottom-nav')).toBeVisible()

    await page.getByTestId('mobile-nav-diamond').click()
    await expect(page).toHaveURL(/\/diamond$/)

    await page.getByTestId('mobile-nav-inventory').click()
    await expect(page).toHaveURL(/\/inventory$/)

    await page.getByTestId('mobile-nav-profile').click()
    await expect(page).toHaveURL(/\/profile$/)

    await page.goto('/game/slot')
    await expect(page.getByTestId('mobile-bottom-nav')).toHaveCount(0)
  })
})
