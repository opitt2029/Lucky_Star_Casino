import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import SlotMachine from './SlotMachine'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/**
 * AGENTS.md 雷區 13：視覺鎖必須綁在真實流程上。
 *
 * 老虎機的「轉動中」鎖是由轉輪動畫的 Promise 解除的，而動畫跑在 requestAnimationFrame
 * 上——視窗被別的視窗遮蔽、或分頁切到背景時，瀏覽器會停掉 rAF。這裡把 rAF 完全凍結，
 * 驗證這種情況下 SPIN 仍會解鎖（PR #255 回報的「永久卡在 SPINNING」）。
 */

const RESULT_GRID = [
  ['🍒', '🍋', '🔔'],
  ['⭐', '⭐', '⭐'],
  ['🔔', '🍒', '🍋'],
]

let container
let root

function render(props = {}) {
  root = createRoot(container)
  act(() => {
    root.render(<SlotMachine symbolHeight={100} {...props} />)
  })
}

function spinButton() {
  return container.querySelector('.slot-spin-button')
}

beforeEach(() => {
  // 這版 jsdom 沒有實作 matchMedia，而 getResponsiveSymbolHeight 用它挑格高。
  // 回報「都不符合」＝桌機斷點，與元件在桌機瀏覽器的行為一致。
  if (!window.matchMedia) {
    window.matchMedia = (query) => ({
      matches: false,
      media: query,
      addEventListener() {},
      removeEventListener() {},
    })
  }
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(() => {
  if (root) act(() => root.unmount())
  root = null
  container.remove()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('SlotMachine 視覺鎖', () => {
  test('餘額不足（canSpin=false）時 SPIN 不可按，且標示星幣不足', () => {
    render({ canSpin: false })

    expect(spinButton().disabled).toBe(true)
    expect(spinButton().textContent).toContain('星幣不足')
  })

  test('rAF 停擺時仍會結算並解除轉動鎖，不會永久卡在 SPINNING', async () => {
    vi.useFakeTimers()
    // 凍結影格：等同視窗被遮蔽 / 分頁切到背景
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0)
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})

    const onSpin = vi.fn().mockResolvedValue({ game: 'slot', grid: RESULT_GRID, payout: 0, bet: 100 })
    const onSettled = vi.fn()
    const onSpinComplete = vi.fn()

    render({ onSpin, onSettled, onSpinComplete })

    await act(async () => {
      spinButton().click()
    })

    expect(onSpin).toHaveBeenCalledTimes(1)
    expect(spinButton().disabled).toBe(true)
    expect(spinButton().textContent).toContain('SPINNING')

    // 最慢的第三輪是 2600ms，看門狗再寬限 1200ms；多推進一些確保全部收尾
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000)
    })

    expect(onSettled).toHaveBeenCalledTimes(1)
    expect(onSpinComplete).toHaveBeenCalledTimes(1)
    expect(spinButton().disabled).toBe(false)
    expect(spinButton().textContent).toContain('SPIN')
  })

  test('下注被擋（onSpin 拋錯）時也必須解除視覺鎖', async () => {
    vi.useFakeTimers()
    const onSpin = vi.fn().mockRejectedValue(new Error('星幣不足'))
    const onSpinComplete = vi.fn()

    render({ onSpin, onSpinComplete })

    await act(async () => {
      spinButton().click()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })

    expect(onSpinComplete).toHaveBeenCalledTimes(1)
    expect(spinButton().disabled).toBe(false)
  })
})
