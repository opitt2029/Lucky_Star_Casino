// 音效合成配方庫（Web Audio 程式化合成，零音檔、零版權依賴）。
// 每個配方簽名：(ctx, destination, { pitch = 1, volume = 1, when = ctx.currentTime }) => void
// pitch 供「連擊音調漸升」使用（combo pitch ramp）：play(id, { pitch: 1 + combo * 0.04 })。

let cachedNoiseBuffer = null

function noiseBuffer(ctx) {
  if (cachedNoiseBuffer && cachedNoiseBuffer.sampleRate === ctx.sampleRate) return cachedNoiseBuffer
  const length = ctx.sampleRate
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1
  cachedNoiseBuffer = buffer
  return buffer
}

function tone(ctx, dest, { type = 'sine', freq, freqEnd, start, attack = 0.004, decay = 0.18, peak = 0.5 }) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, start)
  if (freqEnd && freqEnd !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 1), start + decay)
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), start + attack)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + attack + decay)
  osc.connect(gain)
  gain.connect(dest)
  osc.start(start)
  osc.stop(start + attack + decay + 0.05)
}

function noiseHit(ctx, dest, { start, decay = 0.12, peak = 0.4, filterType = 'bandpass', freq = 2400, q = 1 }) {
  const src = ctx.createBufferSource()
  src.buffer = noiseBuffer(ctx)
  const filter = ctx.createBiquadFilter()
  filter.type = filterType
  filter.frequency.setValueAtTime(freq, start)
  filter.Q.value = q
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(peak, start)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + decay)
  src.connect(filter)
  filter.connect(gain)
  gain.connect(dest)
  src.start(start)
  src.stop(start + decay + 0.05)
}

// ---- 金幣 / 派彩 ----

// 金幣落袋「叮鈴」：高頻三角波 + 泛音，LDW 的主力音（任何 payout > 0 都播，讓大腦記住「有進帳」）。
function coin(ctx, dest, { pitch = 1, volume = 1, when }) {
  const base = 1860 * pitch
  tone(ctx, dest, { type: 'triangle', freq: base, start: when, decay: 0.16, peak: 0.32 * volume })
  tone(ctx, dest, { type: 'sine', freq: base * 1.52, start: when + 0.012, decay: 0.22, peak: 0.2 * volume })
  tone(ctx, dest, { type: 'sine', freq: base * 2.96, start: when + 0.03, decay: 0.3, peak: 0.08 * volume })
}

// 一連串金幣傾瀉（中獎回收、金幣雨配音）。
function coinPour(ctx, dest, { pitch = 1, volume = 1, when }) {
  for (let i = 0; i < 9; i += 1) {
    const jitter = (i * 0.046) + Math.random() * 0.02
    coin(ctx, dest, { pitch: pitch * (0.92 + Math.random() * 0.22), volume: volume * 0.7, when: when + jitter })
  }
}

// 贏錢 fanfare 三級：小贏（短琶音）→ 大贏（上行琶音+金幣）→ 爆機（雙八度長琶音+鑼）。
const ARPEGGIO = [523.25, 659.25, 783.99, 1046.5] // C5 E5 G5 C6
function winSmall(ctx, dest, { pitch = 1, volume = 1, when }) {
  ARPEGGIO.slice(0, 3).forEach((freq, i) => {
    tone(ctx, dest, { type: 'square', freq: freq * pitch, start: when + i * 0.07, decay: 0.16, peak: 0.13 * volume })
    tone(ctx, dest, { type: 'triangle', freq: freq * pitch * 2, start: when + i * 0.07, decay: 0.2, peak: 0.08 * volume })
  })
  coin(ctx, dest, { pitch, volume: volume * 0.8, when: when + 0.2 })
}
function winBig(ctx, dest, { pitch = 1, volume = 1, when }) {
  ARPEGGIO.forEach((freq, i) => {
    tone(ctx, dest, { type: 'square', freq: freq * pitch, start: when + i * 0.085, decay: 0.3, peak: 0.16 * volume })
    tone(ctx, dest, { type: 'triangle', freq: freq * pitch * 2, start: when + i * 0.085, decay: 0.34, peak: 0.1 * volume })
  })
  coinPour(ctx, dest, { pitch, volume, when: when + 0.3 })
}
function winEpic(ctx, dest, { pitch = 1, volume = 1, when }) {
  // 鑼聲（低頻 + 長殘響感）開場
  tone(ctx, dest, { type: 'sine', freq: 196 * pitch, freqEnd: 180 * pitch, start: when, decay: 1.4, peak: 0.4 * volume })
  noiseHit(ctx, dest, { start: when, decay: 0.9, peak: 0.16 * volume, filterType: 'lowpass', freq: 900 })
  const run = [...ARPEGGIO, ...ARPEGGIO.map((f) => f * 2)]
  run.forEach((freq, i) => {
    tone(ctx, dest, { type: 'square', freq: freq * pitch, start: when + 0.16 + i * 0.075, decay: 0.32, peak: 0.15 * volume })
  })
  coinPour(ctx, dest, { pitch, volume, when: when + 0.5 })
  coinPour(ctx, dest, { pitch: pitch * 1.18, volume: volume * 0.9, when: when + 0.95 })
}

// ---- 捕魚機 ----

// 炮台射擊：重低音方波 + 低通掃頻，講求打擊感與後座力。
function shoot(ctx, dest, { pitch = 1, volume = 1, when }) {
  tone(ctx, dest, { type: 'square', freq: 170 * pitch, freqEnd: 52 * pitch, start: when, decay: 0.14, peak: 0.34 * volume })
  noiseHit(ctx, dest, { start: when, decay: 0.07, peak: 0.18 * volume, filterType: 'highpass', freq: 3200 })
}

// 子彈命中魚隻：「黏著感」噪音脈衝 + 中頻啵聲。
function hit(ctx, dest, { pitch = 1, volume = 1, when }) {
  noiseHit(ctx, dest, { start: when, decay: 0.09, peak: 0.26 * volume, filterType: 'bandpass', freq: 1500 * pitch, q: 2.2 })
  tone(ctx, dest, { type: 'sine', freq: 420 * pitch, freqEnd: 250 * pitch, start: when, decay: 0.1, peak: 0.2 * volume })
}

// 暴擊命中：比 hit 更尖銳清脆的爆音 + 上揚金屬泛音，強化「打中要害、扣更多血」的打擊爽快感。
function crit(ctx, dest, { pitch = 1, volume = 1, when }) {
  noiseHit(ctx, dest, { start: when, decay: 0.06, peak: 0.3 * volume, filterType: 'bandpass', freq: 3400 * pitch, q: 3 })
  tone(ctx, dest, { type: 'square', freq: 880 * pitch, freqEnd: 1760 * pitch, start: when, decay: 0.12, peak: 0.18 * volume })
  tone(ctx, dest, { type: 'triangle', freq: 1320 * pitch, freqEnd: 2640 * pitch, start: when + 0.025, decay: 0.14, peak: 0.12 * volume })
}

// 漁網展開（命中瞬間的網罩演出）。
function net(ctx, dest, { pitch = 1, volume = 1, when }) {
  noiseHit(ctx, dest, { start: when, decay: 0.2, peak: 0.14 * volume, filterType: 'highpass', freq: 2400 })
  tone(ctx, dest, { type: 'triangle', freq: 980 * pitch, freqEnd: 1480 * pitch, start: when, decay: 0.18, peak: 0.1 * volume })
}

// 魚被捕獲（中小魚死亡）：上揚短滑音 + 金幣。
function fishCaught(ctx, dest, { pitch = 1, volume = 1, when }) {
  tone(ctx, dest, { type: 'triangle', freq: 600 * pitch, freqEnd: 1180 * pitch, start: when, decay: 0.2, peak: 0.22 * volume })
  coin(ctx, dest, { pitch, volume: volume * 0.85, when: when + 0.1 })
}

// 高倍魚逃跑（near-miss 惋惜音）：短促下滑音，刺激「下次一定行」。
function fishEscape(ctx, dest, { pitch = 1, volume = 1, when }) {
  tone(ctx, dest, { type: 'sine', freq: 660 * pitch, freqEnd: 320 * pitch, start: when, decay: 0.34, peak: 0.2 * volume })
  noiseHit(ctx, dest, { start: when + 0.06, decay: 0.22, peak: 0.06 * volume, filterType: 'bandpass', freq: 800 })
}

// Boss 警報：雙音調交替（窒息感前奏，配合 BGM 切換）。
function bossAlarm(ctx, dest, { pitch = 1, volume = 1, when }) {
  for (let i = 0; i < 4; i += 1) {
    const freq = (i % 2 === 0 ? 740 : 588) * pitch
    tone(ctx, dest, { type: 'sawtooth', freq, start: when + i * 0.21, decay: 0.18, peak: 0.18 * volume })
  }
  tone(ctx, dest, { type: 'sine', freq: 98 * pitch, start: when, decay: 0.9, peak: 0.22 * volume })
}

// 目標鎖定。
function lockOn(ctx, dest, { pitch = 1, volume = 1, when }) {
  tone(ctx, dest, { type: 'square', freq: 1320 * pitch, start: when, decay: 0.05, peak: 0.12 * volume })
  tone(ctx, dest, { type: 'square', freq: 1760 * pitch, start: when + 0.07, decay: 0.07, peak: 0.12 * volume })
}

// ---- 老虎機 ----

// 拉霸啟動（機械咔噠 + 上行滑音）。
function leverPull(ctx, dest, { pitch = 1, volume = 1, when }) {
  noiseHit(ctx, dest, { start: when, decay: 0.05, peak: 0.24 * volume, filterType: 'highpass', freq: 1800 })
  tone(ctx, dest, { type: 'triangle', freq: 240 * pitch, freqEnd: 620 * pitch, start: when + 0.04, decay: 0.24, peak: 0.18 * volume })
}

// 轉輪滾動 tick（高頻短咔）。
function reelTick(ctx, dest, { pitch = 1, volume = 1, when }) {
  noiseHit(ctx, dest, { start: when, decay: 0.025, peak: 0.1 * volume, filterType: 'bandpass', freq: 4200 * pitch, q: 4 })
}

// 單一轉輪停止 thunk（低頻重落）。
function reelStop(ctx, dest, { pitch = 1, volume = 1, when }) {
  tone(ctx, dest, { type: 'sine', freq: 150 * pitch, freqEnd: 88 * pitch, start: when, decay: 0.12, peak: 0.34 * volume })
  noiseHit(ctx, dest, { start: when, decay: 0.05, peak: 0.12 * volume, filterType: 'lowpass', freq: 900 })
}

// near-miss anticipation 心跳鼓點（第三輪慢停時循環播放）。
function heartbeat(ctx, dest, { pitch = 1, volume = 1, when }) {
  tone(ctx, dest, { type: 'sine', freq: 62 * pitch, start: when, decay: 0.16, peak: 0.36 * volume })
  tone(ctx, dest, { type: 'sine', freq: 56 * pitch, start: when + 0.22, decay: 0.2, peak: 0.28 * volume })
}

// ---- 百家樂 / 通用 ----

// 發牌（卡牌滑出）。
function cardDeal(ctx, dest, { pitch = 1, volume = 1, when }) {
  noiseHit(ctx, dest, { start: when, decay: 0.09, peak: 0.2 * volume, filterType: 'highpass', freq: 2600 * pitch })
}

// 翻牌（啪）。
function cardFlip(ctx, dest, { pitch = 1, volume = 1, when }) {
  noiseHit(ctx, dest, { start: when, decay: 0.04, peak: 0.26 * volume, filterType: 'bandpass', freq: 1900 * pitch, q: 1.4 })
  tone(ctx, dest, { type: 'triangle', freq: 520 * pitch, start: when, decay: 0.06, peak: 0.1 * volume })
}

// 咪牌搓牌沙沙聲（長按擠牌時短循環觸發）。
function cardRub(ctx, dest, { pitch = 1, volume = 1, when }) {
  noiseHit(ctx, dest, { start: when, decay: 0.16, peak: 0.07 * volume, filterType: 'highpass', freq: 5200 * pitch })
}

// 籌碼碰撞。
function chip(ctx, dest, { pitch = 1, volume = 1, when }) {
  tone(ctx, dest, { type: 'square', freq: 2300 * pitch, start: when, decay: 0.04, peak: 0.1 * volume })
  tone(ctx, dest, { type: 'square', freq: 2750 * pitch, start: when + 0.035, decay: 0.05, peak: 0.08 * volume })
}

// UI 點擊。
function click(ctx, dest, { pitch = 1, volume = 1, when }) {
  tone(ctx, dest, { type: 'triangle', freq: 900 * pitch, start: when, decay: 0.05, peak: 0.1 * volume })
}

// 大鼓（Boss BGM 節奏件，也供 useBgm 排程使用）。
function drum(ctx, dest, { pitch = 1, volume = 1, when }) {
  tone(ctx, dest, { type: 'sine', freq: 130 * pitch, freqEnd: 48 * pitch, start: when, decay: 0.3, peak: 0.42 * volume })
  noiseHit(ctx, dest, { start: when, decay: 0.06, peak: 0.1 * volume, filterType: 'lowpass', freq: 700 })
}

// 嗩吶式滑音（鋸齒波 + 顫音感的快速滑奏）。
function suona(ctx, dest, { pitch = 1, volume = 1, when }) {
  tone(ctx, dest, { type: 'sawtooth', freq: 880 * pitch, freqEnd: 1318 * pitch, start: when, attack: 0.02, decay: 0.36, peak: 0.12 * volume })
  tone(ctx, dest, { type: 'sawtooth', freq: 884 * pitch, freqEnd: 1322 * pitch, start: when, attack: 0.02, decay: 0.36, peak: 0.07 * volume })
}

// 喜報入場（清亮雙音 + 微金幣）。
function announce(ctx, dest, { pitch = 1, volume = 1, when }) {
  tone(ctx, dest, { type: 'triangle', freq: 1046 * pitch, start: when, decay: 0.14, peak: 0.14 * volume })
  tone(ctx, dest, { type: 'triangle', freq: 1568 * pitch, start: when + 0.1, decay: 0.2, peak: 0.12 * volume })
}

export const SFX_RECIPES = {
  coin,
  coinPour,
  winSmall,
  winBig,
  winEpic,
  shoot,
  hit,
  crit,
  net,
  fishCaught,
  fishEscape,
  bossAlarm,
  lockOn,
  leverPull,
  reelTick,
  reelStop,
  heartbeat,
  cardDeal,
  cardFlip,
  cardRub,
  chip,
  click,
  drum,
  suona,
  announce,
}
