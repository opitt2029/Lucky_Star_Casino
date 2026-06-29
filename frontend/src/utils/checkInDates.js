// 簽到日期相關的單一工具來源（取代過去散落在 AppShell/Profile/CheckIn 三份重複的 helper）。
// 後端權威：實際「哪幾天簽到」由 GET /api/v1/wallet/checkin/status 提供，這裡只放純函式。

// 連續簽到天數里程碑（每日簽到的額外加碼，與「月度累計」獎勵獨立）。
// 對齊後端 CheckinService.calculateReward 與 mockApi.checkInMilestoneBonuses。
const DAILY_CHECKIN_REWARD = 100
const CONSECUTIVE_MILESTONE_BONUSES = {
  7: 1000,
  14: 2000,
  21: 3000,
  30: 5000,
}

/** 台北（Asia/Taipei）日界的 yyyy-MM-dd。後端一律以台北時區判日，前端顯示須一致。 */
export function getTaipeiDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${value.year}-${value.month}-${value.day}`
}

/** 某年月（yyyy-MM）的天數。 */
export function getMonthDays(monthKey) {
  const [year, month] = monthKey.split('-').map(Number)
  return new Date(year, month, 0).getDate()
}

/** 連續簽到第 N 天可得的星幣（含每日基礎 + 里程碑加碼）。 */
export function calculateDailyCheckInReward(consecutiveDays) {
  return DAILY_CHECKIN_REWARD + (CONSECUTIVE_MILESTONE_BONUSES[consecutiveDays] || 0)
}
