import { afterEach, describe, expect, test, vi } from 'vitest'
import { animateReel, buildReelTrack, nextFrame, paylineRow, visibleRows } from './Reel'

/**
 * 轉輪動畫的兩個不變量：
 *   1. 轉輪一定停在格線上（targetY 必為格高整數倍）——否則會停在半格。
 *   2. 動畫 Promise 一定會結束——否則 SlotMachine 的 phase 永遠停在 'spinning'，
 *      SPIN 按鈕卡在 disabled 的「SPINNING」，玩家整局被鎖死（PR #255 回報的現象）。
 *
 * 第 2 點是這裡的重點：視窗被遮蔽、分頁切到背景時瀏覽器會停掉 requestAnimationFrame，
 * 而 setTimeout 仍會觸發。所以「rAF 完全不觸發」是必須測的真實情境，不是假想。
 */

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

/** 讓 rAF 完全不觸發：等同視窗被遮蔽 / 分頁切到背景。 */
function freezeAnimationFrames() {
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0)
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
}

/** 把 rAF 換成可手動推進的佇列，讓動畫過程完全可控（不依賴 jsdom 的影格時鐘）。 */
function manualAnimationFrames() {
  const queue = []
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => queue.push(cb))
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  return {
    step(timestamp) {
      const cb = queue.shift()
      if (cb) cb(timestamp)
    },
  }
}

describe('buildReelTrack', () => {
  test('targetY 是格高的整數倍，轉輪不會停在半格', () => {
    const symbolHeight = 96
    const track = buildReelTrack({
      symbols: ['A', 'B', 'C'],
      resultSymbol: 'B',
      resultWindow: ['A', 'B', 'C'],
      symbolHeight,
      loops: 5,
      reelIndex: 0,
    })

    // 取絕對值：targetY 是負值，JS 的 -1440 % 96 會得到 -0，與 +0 在 toBe 下不相等
    expect(Math.abs(track.targetY % symbolHeight)).toBe(0)
    // 轉一圈 3 個符號 × 5 圈 = 15 格，再對齊中線列 → 停在第 15 格
    expect(track.targetY).toBe(-15 * symbolHeight)
  })

  test('最終可視窗格的中線就是本局結果符號', () => {
    const track = buildReelTrack({
      symbols: ['A', 'B', 'C'],
      resultSymbol: 'C',
      resultWindow: ['A', 'C', 'B'],
      symbolHeight: 100,
      loops: 6,
      reelIndex: 2,
    })

    const finalWindow = track.items.slice(-visibleRows)
    expect(finalWindow).toHaveLength(visibleRows)
    expect(finalWindow[paylineRow]).toBe('C')
    expect(track.resultSymbol).toBe('C')
  })
})

describe('animateReel', () => {
  test('正常影格流程：跑到 duration 後落在 targetY 並回報完成', async () => {
    const frames = manualAnimationFrames()
    const element = document.createElement('div')
    let settled = null
    const promise = animateReel({
      trackElement: element,
      symbols: ['A', 'B'],
      resultSymbol: 'A',
      symbolHeight: 100,
      duration: 1000,
      targetY: -900,
    }).then((completed) => {
      settled = completed
    })

    // 第一幀的 timestamp 就是起算點；刻意用非 0 值以外的情境另由「起算點為 0」測試覆蓋
    frames.step(1000)
    frames.step(1500)
    expect(settled).toBeNull()

    frames.step(2000)
    await promise

    expect(settled).toBe(true)
    expect(element.style.transform).toBe('translate3d(0, -900px, 0)')
  })

  test('rAF 停擺時由看門狗收尾：轉輪仍落定、Promise 仍結束（不鎖死 SPIN）', async () => {
    vi.useFakeTimers()
    freezeAnimationFrames()
    const element = document.createElement('div')
    let settled = null
    const promise = animateReel({
      trackElement: element,
      symbols: ['A', 'B'],
      resultSymbol: 'A',
      symbolHeight: 100,
      duration: 1800,
      targetY: -1500,
    }).then((completed) => {
      settled = completed
    })

    // 寬限期內不該提早結束，否則正常演出會被砍頭
    await vi.advanceTimersByTimeAsync(1800 + 1100)
    expect(settled).toBeNull()

    await vi.advanceTimersByTimeAsync(200)
    await promise

    expect(settled).toBe(true)
    expect(element.style.transform).toBe('translate3d(0, -1500px, 0)')
  })

  test('第一幀 timestamp 為 0 時不會被當成「尚未起算」而丟掉一幀', async () => {
    const frames = manualAnimationFrames()
    const element = document.createElement('div')
    let settled = null
    const promise = animateReel({
      trackElement: element,
      symbols: ['A', 'B'],
      resultSymbol: 'A',
      symbolHeight: 100,
      duration: 1000,
      targetY: -900,
    }).then((completed) => {
      settled = completed
    })

    frames.step(0)
    frames.step(1000)
    await promise

    // 起算點是第 0 毫秒，所以第 1000 毫秒就該剛好跑完；若把 0 當未起算，這裡還在半路
    expect(settled).toBe(true)
    expect(element.style.transform).toBe('translate3d(0, -900px, 0)')
  })

  test('已中止的 signal 直接回報未完成，不留下待決 Promise', async () => {
    // 用 window.AbortController：專案 ESLint 的 env 沒宣告裸的全域（SlotMachine.jsx 同寫法）
    const controller = new window.AbortController()
    controller.abort()

    await expect(
      animateReel({
        trackElement: document.createElement('div'),
        symbols: ['A'],
        resultSymbol: 'A',
        symbolHeight: 100,
        duration: 1800,
        targetY: -300,
        signal: controller.signal,
      }),
    ).resolves.toBe(false)
  })

  test('沒有 track 元素時立即結束，不會把上游卡在轉動中', async () => {
    await expect(
      animateReel({
        trackElement: null,
        symbols: ['A'],
        resultSymbol: 'A',
        symbolHeight: 100,
        duration: 1800,
        targetY: -300,
      }),
    ).resolves.toBe(false)
  })
})

describe('nextFrame', () => {
  test('rAF 停擺時仍會在逾時後結束', async () => {
    vi.useFakeTimers()
    freezeAnimationFrames()
    let done = false
    const promise = nextFrame(250).then(() => {
      done = true
    })

    await vi.advanceTimersByTimeAsync(240)
    expect(done).toBe(false)

    await vi.advanceTimersByTimeAsync(20)
    await promise
    expect(done).toBe(true)
  })

  test('影格正常時由 rAF 收尾，不必等到逾時', async () => {
    vi.useFakeTimers()
    const frames = manualAnimationFrames()
    let done = false
    const promise = nextFrame(250).then(() => {
      done = true
    })

    frames.step(0)
    frames.step(16)
    await promise

    expect(done).toBe(true)
    // 逾時 timer 必須被清掉，否則會留下懸掛的計時器
    expect(vi.getTimerCount()).toBe(0)
  })
})
