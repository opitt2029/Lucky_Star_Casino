import { describe, test, expect, beforeEach } from 'vitest'
import { mockApi } from './mockApi'

const DB_KEY = 'lucky-star-mock-db-v1'
const PLAYER_ID = 'demo-player'

// 與 mockApi.getTaipeiDateKey 同算法（UTC+8 後取 ISO 日期），確保測試與被測程式對齊台北日界。
const taipei = (date = new Date()) =>
  new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
const dayMs = 24 * 60 * 60 * 1000

function loadDb() {
  return JSON.parse(localStorage.getItem(DB_KEY))
}
function saveDb(db) {
  localStorage.setItem(DB_KEY, JSON.stringify(db))
}

beforeEach(async () => {
  localStorage.clear()
  // 觸發一次任意呼叫以初始化 mock DB（createInitialDb），之後再依測試需求改寫。
  await mockApi.getWallet()
})

describe('mockApi 第三方登入', () => {
  test('綁定後可使用一次第三方登入流程建立 session', async () => {
    await mockApi.startSocialBinding('google')
    await mockApi.logout()

    const start = await mockApi.startSocialLogin('google')
    const ticket = new window.URL(start.authorizationUrl, 'http://localhost').searchParams.get('ticket')
    const session = await mockApi.exchangeSocialLogin(ticket)

    expect(session.accessToken).toContain('mock-access-demo-player')
    expect(session.player.id).toBe('demo-player')
  })

  test('未綁定的 provider 不允許登入', async () => {
    await expect(mockApi.startSocialLogin('apple')).rejects.toThrow('尚未綁定')
  })
})

describe('mockApi 簽到累計（鏡像後端權威）', () => {
  test('checkIn 會把當日寫入 checkinDates，狀態回報本月累計', async () => {
    await mockApi.checkIn()
    const status = await mockApi.getCheckInStatus()

    const today = taipei()
    expect(status.month).toBe(today.slice(0, 7))
    expect(status.signedDates).toContain(today)
    expect(status.monthCheckinDays).toBe(1)
    expect(status.checkedInToday).toBe(true)
  })

  test('上次簽到非昨日 → 連續天數重置為 1', async () => {
    const db = loadDb()
    const user = db.users.find((u) => u.player.id === PLAYER_ID)
    user.player.lastCheckInDate = taipei(new Date(Date.now() - 2 * dayMs))
    user.player.consecutiveCheckInDays = 5
    saveDb(db)

    const result = await mockApi.checkIn()
    expect(result.consecutiveDays).toBe(1)
  })

  test('上次簽到為昨日 → 連續天數 +1', async () => {
    const db = loadDb()
    const user = db.users.find((u) => u.player.id === PLAYER_ID)
    user.player.lastCheckInDate = taipei(new Date(Date.now() - dayMs))
    user.player.consecutiveCheckInDays = 5
    saveDb(db)

    const result = await mockApi.checkIn()
    expect(result.consecutiveDays).toBe(6)
  })

  test('同日重複簽到會丟錯', async () => {
    await mockApi.checkIn()
    await expect(mockApi.checkIn()).rejects.toThrow()
  })
})

describe('mockApi getCheckInStatus 里程碑旗標', () => {
  test('當月累計 10 天 → milestone 10 達標可領、20 未達標', async () => {
    const month = taipei().slice(0, 7)
    const db = loadDb()
    db.checkinDates[PLAYER_ID] = Array.from({ length: 10 }, (_, i) =>
      `${month}-${String(i + 1).padStart(2, '0')}`,
    )
    saveDb(db)

    const status = await mockApi.getCheckInStatus()
    const byDays = Object.fromEntries(status.milestones.map((m) => [m.milestoneDays, m]))

    expect(status.monthCheckinDays).toBe(10)
    expect(byDays[10].reached).toBe(true)
    expect(byDays[10].claimable).toBe(true)
    expect(byDays[20].reached).toBe(false)
    expect(byDays[20].claimable).toBe(false)
  })
})

describe('mockApi claimMonthlyReward', () => {
  function seedMonthDays(count) {
    const month = taipei().slice(0, 7)
    const db = loadDb()
    db.checkinDates[PLAYER_ID] = Array.from({ length: count }, (_, i) =>
      `${month}-${String(i + 1).padStart(2, '0')}`,
    )
    saveDb(db)
  }

  test('達標領取成功 → 入帳並標記 claimed，二次領取丟錯', async () => {
    seedMonthDays(10)
    const before = (await mockApi.getWallet()).balance

    const result = await mockApi.claimMonthlyReward(10)
    expect(result.reward).toBe(2000)
    expect(result.milestoneDays).toBe(10)
    expect(result.wallet.balance).toBe(before + 2000)

    const status = await mockApi.getCheckInStatus()
    const ms10 = status.milestones.find((m) => m.milestoneDays === 10)
    expect(ms10.claimed).toBe(true)
    expect(ms10.claimable).toBe(false)

    await expect(mockApi.claimMonthlyReward(10)).rejects.toThrow()
  })

  test('未達標領取丟錯，且不入帳', async () => {
    seedMonthDays(5)
    const before = (await mockApi.getWallet()).balance

    await expect(mockApi.claimMonthlyReward(10)).rejects.toThrow()
    expect((await mockApi.getWallet()).balance).toBe(before)
  })

  test('無效里程碑丟錯', async () => {
    seedMonthDays(28)
    await expect(mockApi.claimMonthlyReward(15)).rejects.toThrow()
  })
})
