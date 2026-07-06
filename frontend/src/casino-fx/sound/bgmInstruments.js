// BGM 專用樂器配方庫：與 sfx.js 同一簽名慣例 (ctx, dest, opts)，但為「被排程的音樂音符」
// 設計——支援 duration（秒）、attack/release 包絡，音量刻意壓低（BGM 是底、SFX 是主角）。
//
// 節點生命週期原則：每個音符的 Oscillator/BufferSource 都 start(when) / stop(結束點)
// 自我終結，Web Audio 會自動回收——不留長駐節點、不會洩漏。
// 唯一例外是 createAmbience() 的環境音迴圈（loop 噪音源＋LFO），
// 它是長駐的，由 bgmComposer 持有 handle 並在 stop/crossfade 時 dispose。

let cachedNoise = null

function noiseBuffer(ctx) {
  if (cachedNoise && cachedNoise.sampleRate === ctx.sampleRate) return cachedNoise
  const length = ctx.sampleRate * 2 // 2 秒白噪音，loop 起來聽不出接縫
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1
  cachedNoise = buffer
  return buffer
}

// ---- 和聲 / 旋律樂器 ----

// 和弦墊（pad）：每個和弦音 2 顆微失諧震盪器 → 共用 lowpass → 慢 attack/release。
// 失諧（detune ±6 cents）讓聲音「變寬變暖」，lowpass 砍高頻避免鋸齒波刺耳。
function pad(ctx, dest, { freqs = [], when, duration = 2, volume = 1, attack = 0.5, release = 1.2, cutoff = 1100 }) {
  if (!freqs.length) return
  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.setValueAtTime(cutoff, when)
  const gain = ctx.createGain()
  // 音量除以聲部數開根號：和弦音越多總能量越大，不壓的話 5 音和弦會蓋過旋律
  const peak = Math.max((0.055 * volume) / Math.sqrt(freqs.length), 0.0002)
  gain.gain.setValueAtTime(0.0001, when)
  gain.gain.exponentialRampToValueAtTime(peak, when + attack)
  gain.gain.setValueAtTime(peak, when + Math.max(duration, attack))
  gain.gain.exponentialRampToValueAtTime(0.0001, when + Math.max(duration, attack) + release)
  filter.connect(gain)
  gain.connect(dest)
  const stopAt = when + Math.max(duration, attack) + release + 0.1
  freqs.forEach((freq) => {
    ;[
      { type: 'sawtooth', detune: -6 },
      { type: 'triangle', detune: 6 },
    ].forEach(({ type, detune }) => {
      const osc = ctx.createOscillator()
      osc.type = type
      osc.frequency.setValueAtTime(freq, when)
      osc.detune.setValueAtTime(detune, when)
      osc.connect(filter)
      osc.start(when)
      osc.stop(stopAt)
    })
  })
}

// 低音撥弦：sine 主體 + lowpass 濾波包絡（開頭亮、迅速悶掉 = 撥弦的「啵」感）
function bassPluck(ctx, dest, { freq, when, duration = 0.5, volume = 1 }) {
  const osc = ctx.createOscillator()
  osc.type = 'triangle'
  osc.frequency.setValueAtTime(freq, when)
  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.setValueAtTime(680, when)
  filter.frequency.exponentialRampToValueAtTime(140, when + Math.min(duration, 0.6))
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.0001, when)
  gain.gain.exponentialRampToValueAtTime(0.22 * volume, when + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, when + duration + 0.15)
  osc.connect(filter)
  filter.connect(gain)
  gain.connect(dest)
  osc.start(when)
  osc.stop(when + duration + 0.25)
}

// 撥弦主奏（古箏/柳琴感）：三角波快速衰減 + 高八度泛音，slot 旋律用
function pluckLead(ctx, dest, { freq, when, duration = 0.3, volume = 1 }) {
  const decay = Math.min(Math.max(duration, 0.22), 0.9)
  const make = (f, peak) => {
    const osc = ctx.createOscillator()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(f, when)
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, when)
    gain.gain.exponentialRampToValueAtTime(peak, when + 0.008)
    gain.gain.exponentialRampToValueAtTime(0.0001, when + decay)
    osc.connect(gain)
    gain.connect(dest)
    osc.start(when)
    osc.stop(when + decay + 0.1)
  }
  make(freq, 0.11 * volume)
  make(freq * 2, 0.035 * volume)
}

// 柔音主奏（顫音琴感）：純 sine 慢衰減 + 一點高泛音，百家樂 lounge 動機用
function softLead(ctx, dest, { freq, when, duration = 0.8, volume = 1 }) {
  const decay = Math.min(Math.max(duration, 0.6), 2.4)
  const make = (f, peak) => {
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(f, when)
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, when)
    gain.gain.exponentialRampToValueAtTime(peak, when + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, when + decay)
    osc.connect(gain)
    gain.connect(dest)
    osc.start(when)
    osc.stop(when + decay + 0.1)
  }
  make(freq, 0.09 * volume)
  make(freq * 4, 0.012 * volume)
}

// 號角（嗩吶感、可指定音高版）：雙微失諧鋸齒波 + 尾音微升，Boss 樂句用
function horn(ctx, dest, { freq, when, duration = 0.5, volume = 1 }) {
  const decay = Math.min(Math.max(duration, 0.35), 1.2)
  ;[0, 4].forEach((detune, i) => {
    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(freq, when)
    osc.frequency.exponentialRampToValueAtTime(freq * 1.03, when + decay)
    osc.detune.setValueAtTime(detune, when)
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, when)
    gain.gain.exponentialRampToValueAtTime((i === 0 ? 0.09 : 0.05) * volume, when + 0.03)
    gain.gain.exponentialRampToValueAtTime(0.0001, when + decay)
    osc.connect(gain)
    gain.connect(dest)
    osc.start(when)
    osc.stop(when + decay + 0.1)
  })
}

// ---- 打擊樂 ----

// 大鼓/太鼓：低頻下滑 sine + 低通噪音（沿用 sfx drum 的做法，音量再收斂）
function kick(ctx, dest, { when, volume = 1, pitch = 1 }) {
  const osc = ctx.createOscillator()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(120 * pitch, when)
  osc.frequency.exponentialRampToValueAtTime(Math.max(44 * pitch, 1), when + 0.24)
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.0001, when)
  gain.gain.exponentialRampToValueAtTime(0.3 * volume, when + 0.005)
  gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.28)
  osc.connect(gain)
  gain.connect(dest)
  osc.start(when)
  osc.stop(when + 0.35)
  noiseHit(ctx, dest, { when, decay: 0.05, peak: 0.06 * volume, filterType: 'lowpass', freq: 650 })
}

// 刷鼓沙沙（brush）：極短高通噪音，lounge 的「氣聲」節奏
function brushHat(ctx, dest, { when, volume = 1, pitch = 1 }) {
  noiseHit(ctx, dest, { when, decay: 0.06, peak: 0.05 * volume, filterType: 'highpass', freq: 5800 * pitch })
}

// Ride 鈸：帶殘響感的中高頻噪音，intensity 2 才進來的「推進層」
function ride(ctx, dest, { when, volume = 1, pitch = 1 }) {
  noiseHit(ctx, dest, { when, decay: 0.4, peak: 0.035 * volume, filterType: 'bandpass', freq: 5200 * pitch, q: 1.4 })
}

// 沙鈴：更短更高，slot 的反拍律動
function shaker(ctx, dest, { when, volume = 1, pitch = 1 }) {
  noiseHit(ctx, dest, { when, decay: 0.035, peak: 0.045 * volume, filterType: 'bandpass', freq: 7800 * pitch, q: 1.2 })
}

// 氣泡：短促上滑 sine 「啵」，捕魚機氛圍點綴
function bubble(ctx, dest, { when, volume = 1, pitch = 1 }) {
  const osc = ctx.createOscillator()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(280 * pitch, when)
  osc.frequency.exponentialRampToValueAtTime(920 * pitch, when + 0.14)
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.0001, when)
  gain.gain.exponentialRampToValueAtTime(0.07 * volume, when + 0.015)
  gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.18)
  osc.connect(gain)
  gain.connect(dest)
  osc.start(when)
  osc.stop(when + 0.25)
}

// 內部共用：短噪音打擊（同 sfx.js noiseHit，但 BGM 音量域，不與 sfx 共享避免耦合）
function noiseHit(ctx, dest, { when, decay = 0.1, peak = 0.05, filterType = 'bandpass', freq = 2400, q = 1 }) {
  const src = ctx.createBufferSource()
  src.buffer = noiseBuffer(ctx)
  const filter = ctx.createBiquadFilter()
  filter.type = filterType
  filter.frequency.setValueAtTime(freq, when)
  filter.Q.value = q
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(Math.max(peak, 0.0002), when)
  gain.gain.exponentialRampToValueAtTime(0.0001, when + decay)
  src.connect(filter)
  filter.connect(gain)
  gain.connect(dest)
  src.start(when)
  src.stop(when + decay + 0.05)
}

export const BGM_INSTRUMENTS = {
  pad,
  bassPluck,
  pluckLead,
  softLead,
  horn,
  kick,
  brushHat,
  ride,
  shaker,
  bubble,
}

// ---- 環境音（長駐迴圈）----
// layers: [{ filterType, freq, q, gain, lfoRate, lfoDepth }]
// 原理：loop 白噪音 → 濾波塑形（低通=室內底噪/海水、帶通=人聲低鳴）→
// 慢速 LFO（0.05~0.3Hz）調製音量，讓底噪「呼吸」而不是死平一片。
// 回傳 handle：master gain（供淡入）與 dispose()（淡出→停源→斷線，防節點洩漏）。
export function createAmbience(ctx, dest, layers = []) {
  const master = ctx.createGain()
  master.gain.value = 0 // 由呼叫端 fadeIn，避免爆音
  master.connect(dest)
  const sources = []
  layers.forEach((layer) => {
    const src = ctx.createBufferSource()
    src.buffer = noiseBuffer(ctx)
    src.loop = true
    const filter = ctx.createBiquadFilter()
    filter.type = layer.filterType ?? 'lowpass'
    filter.frequency.value = layer.freq ?? 400
    filter.Q.value = layer.q ?? 0.8
    const gain = ctx.createGain()
    gain.gain.value = layer.gain ?? 0.03
    const lfo = ctx.createOscillator()
    lfo.type = 'sine'
    lfo.frequency.value = layer.lfoRate ?? 0.08
    const lfoDepth = ctx.createGain()
    lfoDepth.gain.value = (layer.gain ?? 0.03) * (layer.lfoDepth ?? 0.5)
    lfo.connect(lfoDepth)
    lfoDepth.connect(gain.gain)
    src.connect(filter)
    filter.connect(gain)
    gain.connect(master)
    src.start()
    lfo.start()
    sources.push(src, lfo)
  })
  let disposed = false
  return {
    gain: master,
    fadeIn(seconds = 1.5) {
      master.gain.setTargetAtTime(1, ctx.currentTime, seconds / 3)
    },
    dispose(fadeSeconds = 0.8) {
      if (disposed) return
      disposed = true
      master.gain.setTargetAtTime(0.0001, ctx.currentTime, fadeSeconds / 3)
      const stopAt = ctx.currentTime + fadeSeconds + 0.2
      sources.forEach((node) => {
        try {
          node.stop(stopAt)
        } catch {
          // 已停止的節點重複 stop 會丟例外，忽略
        }
      })
      window.setTimeout(() => {
        try {
          master.disconnect()
        } catch {
          // ignore
        }
      }, (fadeSeconds + 0.4) * 1000)
    },
  }
}
