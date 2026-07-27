import { expect, test } from '@playwright/test'

async function suppressGamePopups(page) {
  await page.addInitScript(() => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date())
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
    const todayKey = `${values.year}-${values.month}-${values.day}`

    localStorage.setItem('lucky-star-checkin-auto-open-v1', JSON.stringify({ 'test-player': todayKey }))
    localStorage.setItem('lucky-star-game-rule-dismissed:slot', '1')
  })
}

async function login(page) {
  await suppressGamePopups(page)
  await page.goto('/member?mode=login')
  await page.locator('form button[type="submit"]').click()
  await expect(page).toHaveURL(/\/games$/)
}

test.describe('slot leave guard', () => {
  test('prevents browser unload while a slot round is in progress', async ({ page }) => {
    await login(page)
    await page.goto('/game/slot')
    await page.waitForSelector('.slot-machine')

    await page.locator('.slot-spin-button').click()
    await expect(page.locator('.slot-spin-button')).toBeDisabled()

    const unload = await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true })
      const allowed = window.dispatchEvent(event)
      return { prevented: !allowed, returnValue: event.returnValue }
    })

    expect(unload.prevented).toBe(true)
  })
})