import { useEffect, useRef } from 'react'
import { soundEngine } from './SoundEngine'

// 程式化 BGM：用 lookahead 排程器把節奏 pattern 排進 Web Audio 時間軸。
// 之後若改用真實音樂檔，只需把 useBgm 內部換成 <audio> 播放即可，呼叫端不變。
//
// pattern 定義：bpm + 每小節 16 步，每步是 [{ sfx, pitch, volume }] 陣列。
const THEMES = {
  // 老虎機：輕快霓虹脈衝。
  slot: {
    bpm: 96,
    steps: buildSteps({
      0: [{ sfx: 'drum', pitch: 1.6, volume: 0.16 }],
      4: [{ sfx: 'chip', pitch: 0.7, volume: 0.2 }],
      8: [{ sfx: 'drum', pitch: 1.6, volume: 0.12 }],
      12: [{ sfx: 'chip', pitch: 0.84, volume: 0.18 }],
    }),
  },
  // 百家樂：沉穩貴氣的低脈動。
  baccarat: {
    bpm: 72,
    steps: buildSteps({
      0: [{ sfx: 'drum', pitch: 0.9, volume: 0.14 }],
      8: [{ sfx: 'coin', pitch: 0.5, volume: 0.06 }],
      10: [{ sfx: 'drum', pitch: 1.1, volume: 0.08 }],
    }),
  },
  // 捕魚機：深海慢脈動 + 偶發氣泡感。
  fishing: {
    bpm: 80,
    steps: buildSteps({
      0: [{ sfx: 'drum', pitch: 0.7, volume: 0.16 }],
      6: [{ sfx: 'coin', pitch: 0.42, volume: 0.05 }],
      8: [{ sfx: 'drum', pitch: 0.78, volume: 0.1 }],
      14: [{ sfx: 'coin', pitch: 0.36, volume: 0.04 }],
    }),
  },
  // Boss 降臨：中式大鼓 + 嗩吶，節奏性極強，瞬間拉滿注意力。
  boss: {
    bpm: 132,
    steps: buildSteps({
      0: [{ sfx: 'drum', pitch: 1, volume: 0.5 }],
      2: [{ sfx: 'drum', pitch: 1, volume: 0.26 }],
      4: [{ sfx: 'drum', pitch: 1.24, volume: 0.42 }],
      6: [{ sfx: 'drum', pitch: 1, volume: 0.26 }],
      8: [{ sfx: 'drum', pitch: 1, volume: 0.5 }, { sfx: 'suona', pitch: 1, volume: 0.5 }],
      10: [{ sfx: 'drum', pitch: 1, volume: 0.26 }],
      12: [{ sfx: 'drum', pitch: 1.24, volume: 0.42 }, { sfx: 'suona', pitch: 1.34, volume: 0.4 }],
      14: [{ sfx: 'drum', pitch: 1.5, volume: 0.3 }],
    }),
  },
}

function buildSteps(map) {
  return Array.from({ length: 16 }, (_, i) => map[i] || [])
}

const LOOKAHEAD_MS = 120
const SCHEDULE_AHEAD_SEC = 0.3

/**
 * 播放指定主題 BGM；theme 為 null/undefined 時靜音。
 * @param {string|null} theme  'slot' | 'baccarat' | 'fishing' | 'boss' | null
 * @param {boolean} active     頁面層的總開關（離開頁面記得停）
 */
export function useBgm(theme, active = true) {
  const stateRef = useRef({ step: 0, nextTime: 0 })

  useEffect(() => {
    const pattern = theme ? THEMES[theme] : null
    if (!pattern || !active) return undefined

    stateRef.current = { step: 0, nextTime: 0 }
    const stepDuration = 60 / pattern.bpm / 4 // 16 分音符

    const timer = window.setInterval(() => {
      const ctx = soundEngine.ctx
      if (!ctx || ctx.state !== 'running' || !soundEngine.getSettings().bgmEnabled) return

      const state = stateRef.current
      if (state.nextTime < ctx.currentTime) {
        state.nextTime = ctx.currentTime + 0.05
      }
      while (state.nextTime < ctx.currentTime + SCHEDULE_AHEAD_SEC) {
        for (const note of pattern.steps[state.step]) {
          soundEngine.playBgmNote(note.sfx, { pitch: note.pitch, volume: note.volume, when: state.nextTime })
        }
        state.nextTime += stepDuration
        state.step = (state.step + 1) % 16
      }
    }, LOOKAHEAD_MS)

    return () => window.clearInterval(timer)
  }, [theme, active])
}
