// BGM 編曲排程器（singleton）：把 bgmThemes 的宣告式編曲即時排進 Web Audio 時間軸。
// 沿用原 useBgm 的 lookahead 模式（setInterval 只負責「往前排 0.3 秒」，實際時序
// 由 AudioContext 時鐘掌握，不受 JS timer 抖動影響），並在其上加三件事：
//   1. 多音軌 + 和弦進行 + swing + 音量人性化 → 聽起來是「音樂」而非節拍器
//   2. intensity（0~2）：遊戲張力高時（轉輪中/發牌中）疊入 minIntensity 較高的音軌，
//      下一個排程步（≤0.3 秒內）生效，音符自我終結所以增減層都是乾淨的
//   3. 主題切換 crossfade：舊主題 themeGain 淡出後斷線，新主題淡入（fishing→boss 不再硬切）
//
// 節點生命週期：音符節點全部自我終結（見 bgmInstruments.js）；長駐的只有
// 每個 session 的 themeGain 與 ambience 迴圈，兩者都由本模組持有並在
// stop()/crossfade 時淡出→ dispose → disconnect，不洩漏。
import { soundEngine } from './SoundEngine'
import { BGM_INSTRUMENTS, createAmbience } from './bgmInstruments'
import { BGM_THEMES } from './bgmThemes'
import { noteFreq, degreeToMidi, chordToneMidi, chordFreqs } from './musicTheory'

const LOOKAHEAD_MS = 120
const SCHEDULE_AHEAD_SEC = 0.3
const CROSSFADE_SEC = 0.8

/**
 * 解讀某一步（bar, step）在指定 intensity 下要發出的音符事件。純函式，供單元測試。
 * @returns [{ track, instrument, volume, swing(步長比例), durationBeats, pitch, freq?, freqs?, attack?, release?, cutoff? }]
 */
export function computeStepEvents(theme, barIndex, stepIndex, intensity, rng = Math.random) {
  const events = []
  const chordSpec = theme.progression[barIndex % theme.progression.length]
  for (const [trackName, track] of Object.entries(theme.tracks)) {
    if (intensity < (track.minIntensity ?? 0)) continue
    const barPattern = track.bars ? track.bars[barIndex % track.bars.length] : null
    const notes = [
      ...(track.every?.[stepIndex] ?? []),
      ...((barPattern && barPattern[stepIndex]) || []),
    ]
    for (const note of notes) {
      if (note.prob != null && rng() >= note.prob) continue
      const event = {
        track: trackName,
        instrument: note.inst ?? track.inst,
        // 音量人性化：±10% 隨機，避免機械感
        volume: (note.vol ?? 0.3) * (0.9 + rng() * 0.2),
        // swing 只加在反拍（奇數 16 分音符），值為步長的比例
        swing: stepIndex % 2 === 1 ? theme.swing ?? 0 : 0,
        durationBeats: note.dur ?? 0.5,
        pitch: note.pitch ?? 1,
      }
      if (note.attack != null) event.attack = note.attack
      if (note.release != null) event.release = note.release
      if (note.cutoff != null) event.cutoff = note.cutoff
      if (note.deg === 'all') {
        event.freqs = chordFreqs(chordSpec, note.oct ?? 0)
      } else if (note.deg != null) {
        const midi = track.mode === 'scale'
          ? degreeToMidi(theme.root, theme.scale, note.deg) + (note.oct ?? 0) * 12
          : chordToneMidi(chordSpec, note.deg, note.oct ?? 0)
        event.freq = noteFreq(midi)
      }
      events.push(event)
    }
  }
  return events
}

class BgmComposer {
  constructor() {
    this.session = null // { name, theme, step, bar, nextTime, themeGain, ambience }
    this.timer = null
    this.intensity = 1
    this.rng = Math.random
  }

  start(themeName) {
    if (this.session?.name === themeName) return
    const theme = BGM_THEMES[themeName]
    if (!theme) {
      this.stop()
      return
    }
    this.fadeOutSession(CROSSFADE_SEC)
    this.session = { name: themeName, theme, step: 0, bar: 0, nextTime: 0, themeGain: null, ambience: null }
    if (!this.timer) {
      this.timer = window.setInterval(() => this.tick(), LOOKAHEAD_MS)
    }
  }

  stop() {
    this.fadeOutSession(CROSSFADE_SEC * 0.6)
    this.session = null
    if (this.timer) {
      window.clearInterval(this.timer)
      this.timer = null
    }
  }

  /** 0=極簡（只剩基底層）、1=一般、2=高潮疊層；下一個排程步生效 */
  setIntensity(level) {
    this.intensity = Math.max(0, Math.min(2, Math.round(level)))
  }

  // 舊 session 淡出並清理長駐節點（crossfade / 停止共用路徑）
  fadeOutSession(fadeSeconds) {
    const old = this.session
    if (!old) return
    const ctx = soundEngine.ctx
    if (old.themeGain && ctx) {
      const gainNode = old.themeGain
      gainNode.gain.setTargetAtTime(0.0001, ctx.currentTime, fadeSeconds / 3)
      window.setTimeout(() => {
        try {
          gainNode.disconnect()
        } catch {
          // ignore
        }
      }, (fadeSeconds + 0.4) * 1000)
    }
    old.ambience?.dispose(fadeSeconds)
    this.session = null
  }

  // AudioContext 就緒後才建立本 session 的 gain / ambience（首次手勢前 ctx 是 null）
  ensureSessionNodes(ctx) {
    const session = this.session
    if (!session || session.themeGain) return
    const themeGain = ctx.createGain()
    themeGain.gain.setValueAtTime(0.0001, ctx.currentTime)
    themeGain.gain.setTargetAtTime(1, ctx.currentTime, CROSSFADE_SEC / 3) // 淡入
    themeGain.connect(soundEngine.bgmGain)
    session.themeGain = themeGain
    if (session.theme.ambience?.length) {
      session.ambience = createAmbience(ctx, themeGain, session.theme.ambience)
      session.ambience.fadeIn(1.5)
    }
  }

  tick() {
    const session = this.session
    if (!session) return
    const ctx = soundEngine.ctx
    if (!ctx || ctx.state !== 'running' || !soundEngine.getSettings().bgmEnabled) return
    this.ensureSessionNodes(ctx)

    const theme = session.theme
    const stepDuration = 60 / theme.bpm / 4 // 16 分音符
    const beatSeconds = 60 / theme.bpm
    if (session.nextTime < ctx.currentTime) {
      session.nextTime = ctx.currentTime + 0.05
    }
    while (session.nextTime < ctx.currentTime + SCHEDULE_AHEAD_SEC) {
      const events = computeStepEvents(theme, session.bar, session.step, this.intensity, this.rng)
      for (const event of events) {
        const recipe = BGM_INSTRUMENTS[event.instrument]
        if (!recipe) continue
        try {
          recipe(ctx, session.themeGain, {
            when: session.nextTime + event.swing * stepDuration,
            duration: event.durationBeats * beatSeconds,
            volume: event.volume,
            pitch: event.pitch,
            freq: event.freq,
            freqs: event.freqs,
            attack: event.attack,
            release: event.release,
            cutoff: event.cutoff,
          })
        } catch {
          // 單一音符失敗不可中斷排程
        }
      }
      session.nextTime += stepDuration
      session.step += 1
      if (session.step >= 16) {
        session.step = 0
        session.bar = (session.bar + 1) % theme.bars
      }
    }
  }
}

export const bgmComposer = new BgmComposer()
