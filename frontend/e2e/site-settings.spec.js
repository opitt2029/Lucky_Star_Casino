import { expect, test } from '@playwright/test'

// 網站設定面板（SiteSettings.jsx，commit 327c7cf）：
// 驗證開關儲存到 localStorage、重新整理後讀回、且開關會實際作用到消費端（CoinRain）。
// 設定為純前端偏好（sitePreferences + SoundEngine 皆存 localStorage），無後端 API。

const PREFERENCES_KEY = 'lucky-star-site-preferences-v1'
const SOUND_KEY = 'lucky-star-sound-settings-v1'

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

async function loginToGames(page) {
  await page.goto('/member?mode=login')
  await page.locator('form button[type="submit"]').click()
  await expect(page).toHaveURL(/\/games$/)
  await dismissOptionalCheckIn(page)
}

async function openSettings(page) {
  await page.getByRole('button', { name: '開啟設定' }).click()
  await expect(page.getByRole('heading', { name: '網站設定' })).toBeVisible()
}

// 自訂開關的原生 checkbox 被裝飾用 span 蓋住，check()/uncheck() 點不到，改點整列 label。
function toggleRow(page, label) {
  return page.locator('label.site-settings__toggle-row', { hasText: label })
}

async function setToggle(page, label, target) {
  const checkbox = page.getByLabel(label)
  if ((await checkbox.isChecked()) !== target) {
    await toggleRow(page, label).click()
  }
  if (target) {
    await expect(checkbox).toBeChecked()
  } else {
    await expect(checkbox).not.toBeChecked()
  }
}

test.describe('site settings panel', () => {
  test('saves toggles to localStorage, applies them, and restores after reload', async ({ page }) => {
    await suppressAutoCheckIn(page)
    await loginToGames(page)

    // 預設：背景金幣雨存在
    await expect(page.locator('.coin-rain')).toHaveCount(1)

    await openSettings(page)

    // 關閉全網公告與網站背景效果
    await setToggle(page, '全網公告效果', false)
    await setToggle(page, '網站背景效果', false)

    // 消費端立即反應：金幣雨從 DOM 移除
    await expect(page.locator('.coin-rain')).toHaveCount(0)

    // 音量調到 30%
    await page.locator('.site-settings__range').fill('30')
    await expect(page.locator('.site-settings__volume strong')).toHaveText('30%')

    // localStorage 已寫入
    const prefs = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)),
      PREFERENCES_KEY,
    )
    expect(prefs).toMatchObject({ announcementsEnabled: false, backgroundEffectsEnabled: false })

    const sound = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), SOUND_KEY)
    expect(sound.volume).toBeCloseTo(0.3, 5)

    // 重新整理後：設定讀回、開關維持關閉、金幣雨不再渲染
    await page.reload()
    await expect(page).toHaveURL(/\/games$/)
    await dismissOptionalCheckIn(page)
    await expect(page.locator('.coin-rain')).toHaveCount(0)

    await openSettings(page)
    await expect(page.getByLabel('全網公告效果')).not.toBeChecked()
    await expect(page.getByLabel('網站背景效果')).not.toBeChecked()
    await expect(page.locator('.site-settings__volume strong')).toHaveText('30%')

    // 重新打開：背景效果開回來，金幣雨回到畫面
    await setToggle(page, '網站背景效果', true)
    await expect(page.locator('.coin-rain')).toHaveCount(1)

    // ESC 關閉面板
    await page.keyboard.press('Escape')
    await expect(page.getByRole('heading', { name: '網站設定' })).toBeHidden()
  })
})
