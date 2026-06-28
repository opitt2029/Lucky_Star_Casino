import { expect, test } from '@playwright/test'

async function dismissOptionalCheckIn(page) {
  const dialog = page.getByRole('dialog', { name: /簽到|獎勵/ })
  if (!(await dialog.isVisible().catch(() => false))) {
    return
  }

  const laterButton = dialog.getByRole('button', { name: /稍後|關閉|取消/ })
  if (await laterButton.count()) {
    await laterButton.first().click()
  }
}

test.describe('player site smoke', () => {
  test('logs in with mock API and navigates core player pages', async ({ page }) => {
    await page.goto('/member?mode=login')

    await expect(page.getByRole('heading', { name: '登入會員' })).toBeVisible()
    await expect(page.locator('input[name="username"]')).toHaveValue('test')

    await page.locator('form button[type="submit"]').click()
    await expect(page).toHaveURL(/\/games$/)
    await dismissOptionalCheckIn(page)

    await expect(page.getByRole('heading', { name: '遊戲大全' })).toBeVisible()
    await expect(page.getByText('目前星幣')).toBeVisible()

    await page.getByRole('link', { name: '鑽石錢包' }).click()
    await expect(page).toHaveURL(/\/diamond$/)
    await expect(page.getByRole('heading', { name: '鑽石錢包' })).toBeVisible()

    await page.getByRole('link', { name: '遊戲紀錄' }).click()
    await expect(page).toHaveURL(/\/game-history$/)
    await expect(page.getByRole('heading', { name: '遊戲紀錄' })).toBeVisible()
  })
})
