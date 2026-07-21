import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { configureStore } from '@reduxjs/toolkit'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../../../services/fairnessApi', () => ({
  fairnessApi: {
    isMock: true,
    slotRound: vi.fn(async () => ({
      roundId: 'R1',
      game: 'slot',
      bet: 100,
      serverSeedHash: 'a'.repeat(64),
      clientSeed: 'cs',
    })),
    slotSettle: vi.fn(async () => ({
      roundId: 'R1',
      grid: [['🍒', '🍋', '🔔'], ['🍒', '🍒', '🍒'], ['⭐', '7️⃣', '🍋']],
      bet: 100,
      multiplier: 5,
      payout: 500,
      winningCells: [[1, 0], [1, 1], [1, 2]],
      serverSeed: 'seed',
      serverSeedHash: 'a'.repeat(64),
      clientSeed: 'cs',
      nonce: 0,
    })),
    verifyRound: vi.fn(async () => ({
      roundId: 'R1',
      commitmentValid: true,
      resultMatches: true,
      valid: true,
      recomputed: { multiplier: 5 },
      stored: { multiplier: 5 },
      usedProvidedSeed: false,
      message: 'ok',
    })),
  },
}))

import SlotFairPanel from './SlotFairPanel'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function makeStore(balance) {
  return configureStore({
    reducer: { wallet: (state = { balance }, action) => (action.type === 'wallet/setBalance' ? { balance: action.payload.balance } : state) },
  })
}

let container
let root
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
})
afterEach(() => {
  if (root) act(() => root.unmount())
  root = null
  container.remove()
  vi.clearAllMocks()
})

function render(balance = 100000) {
  root = createRoot(container)
  act(() => {
    root.render(
      <Provider store={makeStore(balance)}>
        <SlotFairPanel />
      </Provider>,
    )
  })
}

async function clickText(text) {
  const btn = [...container.querySelectorAll('button')].find((b) => b.textContent.includes(text))
  await act(async () => {
    btn.click()
    await Promise.resolve()
  })
}

describe('SlotFairPanel', () => {
  test('承諾後顯示 serverSeedHash 與鎖定的 serverSeed', async () => {
    render()
    await clickText('鎖定本局')
    const { fairnessApi } = await import('../../../services/fairnessApi')
    expect(fairnessApi.slotRound).toHaveBeenCalledOnce()
    expect(container.textContent).toContain('a'.repeat(64))
    expect(container.textContent).toContain('尚未揭露')
  })

  test('餘額不足時擋下下注、顯示星幣不足、不呼叫 slotRound', async () => {
    render(10)
    await clickText('鎖定本局')
    const { fairnessApi } = await import('../../../services/fairnessApi')
    expect(fairnessApi.slotRound).not.toHaveBeenCalled()
    expect(container.textContent).toContain('星幣不足')
  })
})
