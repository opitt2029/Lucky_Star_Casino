import { describe, expect, it } from 'vitest'
import { extractError } from './adminApi'

// extractError 是所有頁面錯誤顯示的共同入口，各分支都要有明確訊息。
// （元件/hook 層不做 render 測試：與玩家端一致只測純邏輯，未引入 @testing-library）
describe('extractError', () => {
  it('無 response（連線失敗）', () => {
    expect(extractError({})).toBe('無法連線到伺服器')
  })

  it('401 → 帳密錯誤', () => {
    expect(extractError({ response: { status: 401 } })).toBe('帳號或密碼錯誤')
  })

  it('403 → 權限不足', () => {
    expect(extractError({ response: { status: 403 } })).toContain('權限不足')
  })

  it('優先取後端 message', () => {
    const err = { response: { status: 409, data: { message: 'item_code 已存在' } } }
    expect(extractError(err)).toBe('item_code 已存在')
  })

  it('其次取 ProblemDetail 的 detail（如 502 member service unavailable）', () => {
    const err = { response: { status: 502, data: { detail: '無法連線 member-service' } } }
    expect(extractError(err)).toBe('無法連線 member-service')
  })

  it('都沒有時退回 HTTP 狀態碼', () => {
    expect(extractError({ response: { status: 500, data: {} } })).toBe('請求失敗（HTTP 500）')
  })
})
