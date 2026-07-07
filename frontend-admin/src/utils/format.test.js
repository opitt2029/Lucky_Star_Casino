import { describe, expect, it } from 'vitest'
import { daysAgo, fmtDateTime, fmtInt, fmtPercent, isoDate } from './format'

describe('fmtInt', () => {
  it('千分位格式化', () => {
    expect(fmtInt(1234567)).toBe('1,234,567')
    expect(fmtInt(0)).toBe('0')
  })

  it('null / undefined 顯示占位符', () => {
    expect(fmtInt(null)).toBe('-')
    expect(fmtInt(undefined)).toBe('-')
  })
})

describe('fmtDateTime', () => {
  it('裁切 LocalDateTime 字串到分鐘精度、不經 Date 解析', () => {
    expect(fmtDateTime('2026-07-07T12:34:56')).toBe('2026-07-07 12:34')
  })

  it('空值顯示占位符', () => {
    expect(fmtDateTime(null)).toBe('-')
    expect(fmtDateTime('')).toBe('-')
  })
})

describe('fmtPercent', () => {
  it('0~1 比率轉百分比（兩位小數）', () => {
    expect(fmtPercent(0.9375)).toBe('93.75%')
    expect(fmtPercent(1)).toBe('100.00%')
    expect(fmtPercent(0)).toBe('0.00%')
  })

  it('null / undefined 顯示占位符', () => {
    expect(fmtPercent(null)).toBe('-')
    expect(fmtPercent(undefined)).toBe('-')
  })
})

describe('isoDate', () => {
  it('回傳本地時區的 YYYY-MM-DD（不受 UTC 位移影響）', () => {
    // 本地時間午夜後 1 分鐘：若誤用 toISOString（UTC）在 UTC+8 會回前一天
    const d = new Date(2026, 6, 7, 0, 1, 0)
    expect(isoDate(d)).toBe('2026-07-07')
  })
})

describe('daysAgo', () => {
  it('回推 n 天', () => {
    const now = new Date()
    const past = daysAgo(6)
    const diffDays = Math.round((now - past) / 86400000)
    expect(diffDays).toBe(6)
  })
})
