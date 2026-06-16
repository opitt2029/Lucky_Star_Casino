// 單例 Web Audio 音效引擎：lazy 建立 AudioContext（瀏覽器要求首次手勢後才能出聲）、
// master / sfx / bgm 三層 GainNode、設定持久化到 localStorage、提供訂閱讓 React UI 同步開關狀態。
import { SFX_RECIPES } from './sfx'

const SETTINGS_KEY = 'lucky-star-sound-settings-v1'

const defaultSettings = {
  sfxEnabled: true,
  bgmEnabled: true,
  volume: 0.8,
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    return raw ? { ...defaultSettings, ...JSON.parse(raw) } : { ...defaultSettings }
  } catch {
    return { ...defaultSettings }
  }
}

class SoundEngine {
  constructor() {
    this.ctx = null
    this.masterGain = null
    this.sfxGain = null
    this.bgmGain = null
    this.settings = loadSettings()
    this.listeners = new Set()
    this.unlockBound = false
  }

  // 首次使用者手勢時呼叫（按鈕點擊內），建立並解鎖 AudioContext。
  ensureContext() {
    if (typeof window === 'undefined') return null
    const AudioContextClass = window.AudioContext || window.webkitAudioContext
    if (!AudioContextClass) return null

    if (!this.ctx) {
      this.ctx = new AudioContextClass()
      this.masterGain = this.ctx.createGain()
      this.masterGain.gain.value = this.settings.volume
      this.masterGain.connect(this.ctx.destination)
      this.sfxGain = this.ctx.createGain()
      this.sfxGain.gain.value = this.settings.sfxEnabled ? 1 : 0
      this.sfxGain.connect(this.masterGain)
      this.bgmGain = this.ctx.createGain()
      this.bgmGain.gain.value = this.settings.bgmEnabled ? 1 : 0
      this.bgmGain.connect(this.masterGain)
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {})
    }
    return this.ctx
  }

  // 在全域掛一次性手勢監聽，讓「進頁面就有 BGM」在第一次點擊後自動解鎖。
  bindAutoUnlock() {
    if (this.unlockBound || typeof window === 'undefined') return
    this.unlockBound = true
    const unlock = () => this.ensureContext()
    window.addEventListener('pointerdown', unlock, { once: true, passive: true })
    window.addEventListener('keydown', unlock, { once: true })
  }

  /**
   * 播放音效。
   * @param {string} id    SFX_RECIPES 的鍵
   * @param {object} opts  { pitch, volume, delay }；pitch 供連擊音調漸升
   */
  play(id, opts = {}) {
    if (!this.settings.sfxEnabled) return
    const ctx = this.ensureContext()
    if (!ctx || ctx.state !== 'running') return
    const recipe = SFX_RECIPES[id]
    if (!recipe) return
    try {
      recipe(ctx, this.sfxGain, {
        pitch: opts.pitch ?? 1,
        volume: opts.volume ?? 1,
        when: ctx.currentTime + (opts.delay ?? 0),
      })
    } catch {
      // 音效失敗不可影響遊戲流程
    }
  }

  // 給 BGM 排程器用的低階入口（無視 sfxEnabled，受 bgmGain 控制）。
  playBgmNote(id, opts = {}) {
    const ctx = this.ctx
    if (!ctx || ctx.state !== 'running') return
    const recipe = SFX_RECIPES[id]
    if (!recipe) return
    try {
      recipe(ctx, this.bgmGain, {
        pitch: opts.pitch ?? 1,
        volume: opts.volume ?? 1,
        when: opts.when ?? ctx.currentTime,
      })
    } catch {
      // ignore
    }
  }

  getSettings() {
    return { ...this.settings }
  }

  updateSettings(patch) {
    this.settings = { ...this.settings, ...patch }
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings))
    } catch {
      // localStorage 不可用時僅在記憶體生效
    }
    if (this.ctx) {
      this.masterGain.gain.value = this.settings.volume
      this.sfxGain.gain.value = this.settings.sfxEnabled ? 1 : 0
      this.bgmGain.gain.value = this.settings.bgmEnabled ? 1 : 0
    }
    this.listeners.forEach((listener) => listener(this.getSettings()))
  }

  toggleSfx() {
    this.updateSettings({ sfxEnabled: !this.settings.sfxEnabled })
  }

  toggleBgm() {
    this.updateSettings({ bgmEnabled: !this.settings.bgmEnabled })
  }

  subscribe(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

export const soundEngine = new SoundEngine()
soundEngine.bindAutoUnlock()
