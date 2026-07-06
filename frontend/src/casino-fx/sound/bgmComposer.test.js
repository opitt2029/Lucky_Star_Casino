import { describe, test, expect, vi, afterEach } from 'vitest'
import { computeStepEvents, bgmComposer } from './bgmComposer'
import { BGM_THEMES } from './bgmThemes'
import { BGM_INSTRUMENTS, createAmbience } from './bgmInstruments'
import { soundEngine } from './SoundEngine'

// 固定種子的 LCG：讓含 prob/humanize 的輸出可重現
function seededRng(seed) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

describe('bgmThemes 編曲資料完整性', () => {
  const themeNames = Object.keys(BGM_THEMES)

  test('涵蓋四個主題', () => {
    expect(themeNames.sort()).toEqual(['baccarat', 'boss', 'fishing', 'slot'])
  })

  test.each(themeNames)('%s：和弦進行長度 === bars、逐小節樂句長度 === bars', (name) => {
    const theme = BGM_THEMES[name]
    expect(theme.progression).toHaveLength(theme.bars)
    for (const track of Object.values(theme.tracks)) {
      if (track.bars) expect(track.bars).toHaveLength(theme.bars)
    }
  })

  test.each(themeNames)('%s：全小節全步掃描，每個事件都能解析出合法樂器/頻率/音量', (name) => {
    const theme = BGM_THEMES[name]
    const rng = () => 0 // prob 音符必觸發（rng >= prob 才略過），掃到所有音符
    for (let bar = 0; bar < theme.bars; bar += 1) {
      for (let step = 0; step < 16; step += 1) {
        for (const event of computeStepEvents(theme, bar, step, 2, rng)) {
          expect(BGM_INSTRUMENTS[event.instrument]).toBeTypeOf('function')
          expect(event.volume).toBeGreaterThan(0)
          expect(event.durationBeats).toBeGreaterThan(0)
          if (event.freq != null) {
            expect(Number.isFinite(event.freq)).toBe(true)
            expect(event.freq).toBeGreaterThan(0)
          }
          if (event.freqs != null) {
            expect(event.freqs.length).toBeGreaterThan(0)
            event.freqs.forEach((f) => {
              expect(Number.isFinite(f)).toBe(true)
              expect(f).toBeGreaterThan(0)
            })
          }
          // swing 只允許出現在反拍，且為步長的小比例
          if (step % 2 === 0) expect(event.swing).toBe(0)
          else expect(event.swing).toBe(theme.swing ?? 0)
          expect(event.swing).toBeLessThan(1)
        }
      }
    }
  })
})

describe('computeStepEvents intensity 分層', () => {
  const slot = BGM_THEMES.slot
  const tracksAt = (intensity) => {
    const names = new Set()
    for (let bar = 0; bar < slot.bars; bar += 1) {
      for (let step = 0; step < 16; step += 1) {
        computeStepEvents(slot, bar, step, intensity, () => 0).forEach((e) => names.add(e.track))
      }
    }
    return names
  }

  test('intensity 0 只剩基底層（無 melody / sparkle）', () => {
    const names = tracksAt(0)
    expect(names.has('melody')).toBe(false)
    expect(names.has('sparkle')).toBe(false)
    expect(names.has('pad')).toBe(true)
    expect(names.has('bass')).toBe(true)
  })

  test('intensity 1 加入 melody、intensity 2 才加入 sparkle', () => {
    expect(tracksAt(1).has('melody')).toBe(true)
    expect(tracksAt(1).has('sparkle')).toBe(false)
    expect(tracksAt(2).has('sparkle')).toBe(true)
  })

  test('相同 rng 種子 → 輸出完全一致（可重現）', () => {
    const a = computeStepEvents(BGM_THEMES.fishing, 0, 3, 2, seededRng(42))
    const b = computeStepEvents(BGM_THEMES.fishing, 0, 3, 2, seededRng(42))
    expect(a).toEqual(b)
  })
})

describe('bgmComposer 狀態機（jsdom 無 AudioContext，ctx=null 不可丟例外）', () => {
  afterEach(() => {
    bgmComposer.stop()
  })

  test('ctx 未就緒時 start/tick/stop 皆安全', () => {
    expect(() => {
      bgmComposer.start('slot')
      bgmComposer.tick()
      bgmComposer.stop()
    }).not.toThrow()
  })

  test('start 換主題會建立新 session；未知主題等同停止', () => {
    bgmComposer.start('slot')
    expect(bgmComposer.session?.name).toBe('slot')
    bgmComposer.start('boss')
    expect(bgmComposer.session?.name).toBe('boss')
    bgmComposer.start('no-such-theme')
    expect(bgmComposer.session).toBeNull()
  })

  test('setIntensity 夾在 0~2', () => {
    bgmComposer.setIntensity(5)
    expect(bgmComposer.intensity).toBe(2)
    bgmComposer.setIntensity(-3)
    expect(bgmComposer.intensity).toBe(0)
    bgmComposer.setIntensity(1)
    expect(bgmComposer.intensity).toBe(1)
  })
})

describe('bgmComposer.tick 排程整合（mock AudioContext）', () => {
  afterEach(() => {
    bgmComposer.stop()
    soundEngine.ctx = null
    soundEngine.bgmGain = null
  })

  test('ctx running 時 tick 會建立 themeGain＋ambience 並排入音符、不丟例外', () => {
    const created = []
    const param = () => ({
      value: 0,
      setValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
      setTargetAtTime: vi.fn(),
    })
    const node = () => {
      const n = {
        type: '', buffer: null, loop: false,
        gain: param(), frequency: param(), detune: param(), Q: { value: 0 },
        connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(),
      }
      created.push(n)
      return n
    }
    const ctx = {
      state: 'running',
      sampleRate: 48000,
      currentTime: 1,
      createBuffer: (channels, length, sampleRate) => ({ sampleRate, getChannelData: () => new Float32Array(length) }),
      createGain: node,
      createBufferSource: node,
      createBiquadFilter: node,
      createOscillator: node,
    }
    soundEngine.ctx = ctx
    soundEngine.bgmGain = node()

    bgmComposer.start('slot')
    expect(() => bgmComposer.tick()).not.toThrow()

    const session = bgmComposer.session
    expect(session.themeGain).not.toBeNull()
    expect(session.themeGain.connect).toHaveBeenCalledWith(soundEngine.bgmGain)
    expect(session.ambience).not.toBeNull()
    // lookahead 0.3s / 步長(96bpm 16 分音符 ≈ 0.156s) → 至少排進 1 步、指標前進
    expect(session.nextTime).toBeGreaterThan(ctx.currentTime)
    // 有實際音符節點被啟動（pad/bass/kick 任一）
    expect(created.some((n) => n.start.mock.calls.length > 0)).toBe(true)
  })
})

describe('createAmbience 長駐節點清理（防洩漏守門）', () => {
  function mockParam() {
    return { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), setTargetAtTime: vi.fn() }
  }
  function mockNode() {
    return {
      type: '', buffer: null, loop: false,
      gain: mockParam(), frequency: mockParam(), detune: mockParam(), Q: { value: 0 },
      connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(),
    }
  }
  function mockCtx() {
    return {
      sampleRate: 48000,
      currentTime: 0,
      createBuffer: (channels, length, sampleRate) => ({ sampleRate, getChannelData: () => new Float32Array(length) }),
      createGain: mockNode,
      createBufferSource: mockNode,
      createBiquadFilter: mockNode,
      createOscillator: mockNode,
    }
  }

  test('dispose 會停掉噪音源/LFO 並在淡出後 disconnect master', () => {
    vi.useFakeTimers()
    const ctx = mockCtx()
    const dest = mockNode()
    const spies = []
    const origSource = ctx.createBufferSource
    const origOsc = ctx.createOscillator
    ctx.createBufferSource = () => {
      const n = origSource()
      spies.push(n)
      return n
    }
    ctx.createOscillator = () => {
      const n = origOsc()
      spies.push(n)
      return n
    }

    const ambience = createAmbience(ctx, dest, [
      { filterType: 'lowpass', freq: 400, gain: 0.03, lfoRate: 0.07 },
    ])
    const master = ambience.gain
    ambience.dispose(0.5)

    spies.forEach((node) => expect(node.stop).toHaveBeenCalled())
    expect(master.gain.setTargetAtTime).toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(master.disconnect).toHaveBeenCalled()
    vi.useRealTimers()
  })
})
