import { expect, test } from '@playwright/test'

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

    localStorage.setItem('lucky-star-checkin-auto-open-v1', JSON.stringify({ 'test-player': todayKey }))
  })
}

async function dismissOptionalCheckIn(page) {
  const dialog = page.locator('section[aria-labelledby="daily-checkin-title"]')
  if (!(await dialog.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false))) {
    return
  }

  await dialog.locator('button').first().click()
  await expect(dialog).toBeHidden()
}

test.describe('player site smoke', () => {
  test('logs in with mock API and navigates core player pages', async ({ page }) => {
    await suppressAutoCheckIn(page)
    await page.goto('/member?mode=login')

    await expect(page.getByRole('heading', { name: '登入會員' })).toBeVisible()
    await expect(page.locator('input[name="username"]')).toHaveValue('test')

    await page.locator('form button[type="submit"]').click()
    await expect(page).toHaveURL(/\/games$/)

    await expect(page.getByRole('heading', { name: '遊戲大全' })).toBeVisible()
    await expect(page.getByText('目前星幣')).toBeVisible()
    await dismissOptionalCheckIn(page)

    await page.goto('/profile')
    await expect(page.locator('.route-fallback')).toBeHidden()
    await expect(page.getByTestId('profile-unlock-gate')).toBeVisible()
    await expect(page.locator('input[name="nickname"]')).toHaveCount(0)
    await page.getByTestId('profile-gate-password').fill('123')
    await page.getByTestId('profile-gate-unlock').click()
    await expect(page.getByTestId('profile-unlock-gate')).toBeHidden()
    await expect(page.locator('input[name="nickname"]')).toBeVisible()
    await expect(page.getByText('王**')).toBeVisible()
    await expect(page.getByText('19**-**-**')).toBeVisible()
    await expect(page.getByText('100%')).toBeVisible()
    await expect(page.getByTestId('profile-game-summary')).toBeVisible()
    await expect(page.getByTestId('profile-game-summary')).toContainText('Game Journey')

    await expect(page.getByText('不公開')).toBeVisible()
    await expect(page.getByText('已設定').first()).toBeVisible()
    await page.getByTestId('profile-settings-open').click()
    await expect(page.getByTestId('profile-settings-password')).toHaveCount(0)
    await expect(page.getByTestId('profile-settings-gender')).toBeVisible()
    await page.getByTestId('profile-settings-gender').click()
    await expect(page.getByTestId('profile-settings-gender-option-MALE')).toBeVisible()
    await expect(page.getByTestId('profile-settings-gender-option-FEMALE')).toBeVisible()
    await expect(page.getByTestId('profile-settings-gender-option-PREFER_NOT_TO_SAY')).toBeVisible()
    await page.mouse.click(20, 20)
    await expect(page.getByTestId('profile-settings-gender-option-MALE')).toBeHidden()
    await page.getByTestId('profile-settings-gender').click()
    await page.getByTestId('profile-settings-gender-option-FEMALE').click()
    await page.getByTestId('profile-settings-payment').click()
    await page.getByTestId('profile-settings-payment-option-ASK_EVERY_TIME').click()
    await page.getByTestId('profile-settings-address').fill('台北市測試路 123 號')
    await page.getByTestId('profile-settings-save').click()
    await expect(page.getByTestId('profile-notice')).toContainText('基本資訊設定已更新')
    await expect(page.getByText('已設定').first()).toBeVisible()
    await page.getByRole('link', { name: '鑽石錢包' }).click()
    await expect(page).toHaveURL(/\/diamond$/)
    await expect(page.getByRole('heading', { name: '鑽石錢包' })).toBeVisible()

    await page.getByRole('link', { name: '交易/遊戲紀錄' }).click()
    await expect(page).toHaveURL(/\/records$/)
    await expect(page.getByRole('heading', { name: /\u4ea4\u6613\s*\/\s*\u904a\u6232\u7d00\u9304/ })).toBeVisible()
  })
})
