// 捕魚機 Pixi 引擎（取代 FishingArena 的 DOM 渲染）。
//
// 為什麼：舊漁場用 React-DOM 渲染——每 110ms 對每條魚做 querySelector + getBoundingClientRect
// （強制 reflow / layout thrashing）、每發子彈多次 setState + setTimeout，H5/手機連發會當機。
// 本引擎把魚/子彈/火花/浮字全做成 Pixi 物件，遊戲迴圈跑在單一 ticker 內，命中判定全在 canvas
// 座標（魚 instance 自持座標），徹底消滅每幀 DOM 查詢。
//
// 範圍（Phase 2）：只重現「現狀視覺」＝火花 + 派彩浮字。HP 條 / 傷害數字 / 暴擊 / 掙脫演出留 Phase 3。
// 契約不動：開火仍呼叫上層 hook 的 fire(fishInstanceId, fishCode)；批次結果由 handleResults 處理。
import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js'
import { preload, clearCache } from '../casino-fx/assets/bakeTextures'

// ---- 常數（沿用舊 FishingArena 的手感參數）----
const MAX_FISH = 14
const MAX_FISH_PERF = 9
const SPAWN_INTERVAL_MS = 850
const BLOCKER_INTERVAL_MS = 5200
const BLOCKER_MIN_INTERVAL_MS = 1800
const MAX_BLOCKERS = 3
const MAX_BLOCKER_THREAT_BONUS = 4
const SWARM_INTERVAL_MS = 36000 // 魚群潮週期（短時間密集放小魚，LDW 小額回收手感）
const SWARM_SIZE = 6 // 每波魚群潮的小魚數
const SWARM_SPAWN_MS = 240 // 魚群潮期間每尾間隔
const BOSS_INTERVAL_MS = 58000 // Boss（龍王）定時降臨週期（場上無 boss 時才放，保證事件節奏）
const FIRE_INTERVAL_MS = 110 // 按住連發取樣節奏（實際射速由 hook 的 token bucket 限到 8 發/秒）
const TEX_PX = 256 // 紋理烘焙解析度
const BOB_AMP = 8 // 魚上下浮動幅度（px）
const BOB_SPEED = 2.2 // 浮動頻率
const CAUGHT_MS = 520 // 捕獲淡出時間
const BULLET_MS = 340 // 子彈飛行時間
const SPARK_MS = 460
const FLOAT_MS = 1000
const DMG_FLOAT_MS = 720 // 傷害數字壽命
const HP_BAR_W_RATIO = 0.74 // HP 條寬 = 魚顯示寬 × 此比例
const HP_BAR_H = 5 // HP 條高（px）
const HP_SHOW_MS = 2600 // 命中後血條顯示時間（之後淡出，平時減雜訊）
const FLEE_MS = 440 // 致命一擊未捕獲（掙脫逃跑）的淡出時間
// HP 條顏色（依剩餘比例）：綠 → 黃 → 紅
const HP_GREEN = 0x66e06a

// 漁場所有可能用到的素材 id（與 registry / 後端 FishSpecies 對齊）。
const FISH_ASSETS = [
  'fish-koi', 'fish-goldfish', 'fish-lantern', 'fish-puffer', 'fish-angelfish',
  'fish-devil-ray', 'fish-gold-dragon', 'fish-pixiu', 'fish-caishen',
  'fish-dragon-king', 'fish-golden-dragon-king', 'fish-jackpot-fish-king', 'fish-rainbow-jackpot-fish-king', 'fish-money-tree',
  'fish-evil-blocker-octopus', 'fish-evil-blocker-starfish', 'fish-evil-blocker-turtle',
]
// 砲台等級差異化：貼圖 / 子彈顏色 / 子彈半徑 / 射擊音調 / 砲口火光大小（idx0 不用，對齊 cannonLevel 1~3）。
// 傷害差異在後端（FishingCombat.CANNON_DAMAGE 銅10/銀14/金18，ADR-004）；此處只管「手感與表現」，不影響 RTP。
const CANNON_STYLE_BY_TONE = {
  copper: {
    tone: 'copper',
    asset: 'cannon-copper',
    bullet: 0xffd98a,
    bulletR: 4,
    pitch: 0.9,
    muzzle: 13,
    scale: 0.9,
    deckScale: 0.94,
    core: 0xffb45c,
    barrel: 0x8f2d25,
    trim: 0xffc978,
    glow: 0xffd98a,
    barrelOffsets: [0],
    barrelWidthScale: 0.92,
    barrelLengthScale: 0.86,
    damage: 14,
  },
  silver: {
    tone: 'silver',
    asset: 'cannon-silver',
    bullet: 0xcfe4ff,
    bulletR: 5,
    pitch: 1.06,
    muzzle: 17,
    scale: 1.05,
    deckScale: 1.02,
    core: 0x9bd8ff,
    barrel: 0x375b72,
    trim: 0xdbeafe,
    glow: 0x7dd3fc,
    barrelOffsets: [-0.46, 0.46],
    barrelWidthScale: 0.62,
    barrelLengthScale: 1.02,
    damage: 22,
  },
  gold: {
    tone: 'gold',
    asset: 'cannon',
    bullet: 0xffd24a,
    bulletR: 6.5,
    pitch: 1.2,
    muzzle: 23,
    scale: 1.2,
    deckScale: 1.1,
    core: 0xffca5c,
    barrel: 0x971c2c,
    trim: 0xffd36b,
    glow: 0x66efff,
    barrelOffsets: [-0.78, 0, 0.78],
    barrelWidthScale: 0.56,
    barrelLengthScale: 1.16,
    damage: 32,
  },
}
const CANNON_STYLE = [null, CANNON_STYLE_BY_TONE.copper, CANNON_STYLE_BY_TONE.silver, CANNON_STYLE_BY_TONE.gold]
const BULLET_BASE_R = 5 // 子彈基準半徑（白圓，實際大小由 cannonStyle.bulletR 以 scale 調整）
const SPARK_BASE_R = 10 // 火花基準半徑

const BLOCKER_SPECIES = [
  { code: 'BLOCKER_OCTOPUS', name: '障礙章魚', asset: 'fish-evil-blocker-octopus', sizeMin: 82, sizeMax: 108, durMin: 5.1, durMax: 7.8, tint: 0xffffff, alpha: 0.96, wobble: 0.48 },
  { code: 'BLOCKER_STARFISH', name: '障礙海星', asset: 'fish-evil-blocker-starfish', sizeMin: 58, sizeMax: 84, durMin: 4.0, durMax: 6.2, tint: 0xffffff, alpha: 0.94, wobble: 0.26 },
  { code: 'BLOCKER_TURTLE', name: '障礙海龜', asset: 'fish-evil-blocker-turtle', sizeMin: 98, sizeMax: 128, durMin: 6.8, durMax: 10.2, tint: 0xffffff, alpha: 0.98, wobble: 0.2 },
]
const BLOCKER_SIZE_PROFILES = [
  { key: 'small', name: '小型', scale: 0.78, maxHits: 5, durationFactor: 0.74 },
  { key: 'medium', name: '中型', scale: 1, maxHits: 10, durationFactor: 1 },
  { key: 'large', name: '大型', scale: 1.32, maxHits: 17, durationFactor: 1.28 },
]
const PRELOAD_ASSETS = ['cannon', 'cannon-copper', 'cannon-silver', 'coin', ...FISH_ASSETS]

// 各 tier 的渲染基準：體型 / 游速（duration 越大游越慢、停越久）/ 辨識光暈強度。
// 體型↔倍率↔HP 正相關、游速↔倍率負相關（大魚慢、好瞄但耐打）、高倍魚加光暈強化辨識（計畫 §5.1）。
// ADR-004：高倍/Boss/特殊魚過場時間刻意拉長——大魚耐打（金炮 ~12s、銅炮 ~21s 才打完），
// 停太短會在打死前游走（子彈沉沒）。配合「殘血回收」，給玩家有機會把大魚打完、減少全損挫折。
const TIER_RENDER = {
  SMALL: { size: 62, durMin: 7, durMax: 9.5, glow: 0 },
  MEDIUM: { size: 96, durMin: 9, durMax: 12, glow: 0 },
  HIGH: { size: 122, durMin: 15, durMax: 19, glow: 1 },
  BOSS: { size: 154, durMin: 20, durMax: 26, glow: 1.5 },
  SPECIAL: { size: 106, durMin: 15, durMax: 19, glow: 1 },
}

// 依後端魚種資料（tier/spawnWeight/multiplier）推導渲染參數。
// 單一真相＝後端：tier 與 spawnWeight 直接採後端值（修正舊版用 multiplier 自行分級，把 HIGH 誤當 boss）。
function deriveMeta(fish) {
  const tierKey = (fish.tier || 'SMALL').toUpperCase()
  const base = TIER_RENDER[tierKey] || TIER_RENDER.SMALL
  const isLegendaryFishKing = fish.assetId === 'fish-rainbow-jackpot-fish-king'
  // Small fish within the same tier get subtle size variation for easier recognition.
  const sizeAdj = tierKey === 'SMALL' ? (fish.multiplier || 2) * 1.6 : 0
  return {
    tier: tierKey.toLowerCase(),
    size: base.size + sizeAdj + (isLegendaryFishKing ? 78 : 0),
    weight: isLegendaryFishKing ? Math.max(1, Math.min(fish.spawnWeight || 1, 1)) : fish.spawnWeight || 1,
    durMin: base.durMin + (isLegendaryFishKing ? 6 : 0),
    durMax: base.durMax + (isLegendaryFishKing ? 8 : 0),
    glow: base.glow + (isLegendaryFishKing ? 1.6 : 0),
  }
}

function weightedPick(table) {
  const total = table.reduce((sum, f) => sum + f._meta.weight, 0)
  let r = Math.random() * total
  for (const f of table) {
    r -= f._meta.weight
    if (r <= 0) return f
  }
  return table[0]
}

export class FishingEngine {
  /**
   * @param {import('pixi.js').Application} app 已 init 完成的 Pixi Application
   * @param {object} ctx 由 FishingCanvas 持有並逐 render 更新欄位（避免閉包過期）：
   *   { phase, betPerShot, fishTable, fire, play, onCatch, onMiss, onBossChange, perfMode }
   */
  constructor(app, ctx) {
    this.app = app
    this.ctx = ctx
    this._destroyed = false

    // 顯示層（由下而上）：光暈 → 魚 → 火花/子彈 → HP 條 → 浮字/傷害數字 → 砲台 → 提示
    this.backdropLayer = new Container()
    this.decorLayer = new Container()
    this.glowLayer = new Container() // 高倍魚光暈（在魚下方）
    this.fishLayer = new Container()
    this.fxLayer = new Container()
    this.hpLayer = new Container()
    this.floatLayer = new Container()
    this.cannonLayer = new Container()
    this.uiLayer = new Container()
    app.stage.addChild(
      this.backdropLayer,
      this.decorLayer,
      this.glowLayer,
      this.fishLayer,
      this.fxLayer,
      this.hpLayer,
      this.floatLayer,
      this.cannonLayer,
      this.uiLayer,
    )
    this.fishMask = new Graphics()
    app.stage.addChild(this.fishMask)
    this.glowLayer.mask = this.fishMask
    this.fishLayer.mask = this.fishMask
    this.hpLayer.mask = this.fishMask

    this.tex = {} // assetId → Texture（preload 後填入）
    this.fish = []
    this.pending = new Map() // shotSeq → { fishId, code, multiplier, tier, x, y }
    this.idSeq = Date.now() // 跨 session 唯一起點，防引擎重建後 idSeq 碰撞舊 fishDamage key

    // 物件池
    this.bulletPool = []
    this.sparkPool = []
    this.floatPool = []
    this.dmgPool = []
    this.bullets = []
    this.sparks = []
    this.floats = []
    this.dmgs = [] // 浮動傷害數字（命中即冒，含暴擊）
    this.bubbles = []
    this.godRays = [] // 水面神光光楔（加法混合，數量固定、只調 alpha，perfMode 時歸零）
    this.plankton = [] // 浮游生物微粒（固定池、緩慢漂移，reducedMotion 時不生成）
    this.backdropW = 0
    this.backdropH = 0
    this.backdropTime = 0

    // 指標連發狀態
    this.pointer = null
    this.holding = false
    this.aim = 0
    this.cannonPulse = 0
    this.fireAccMs = 0
    this.spawnAccMs = 0

    // 事件編排：魚群潮（密集小魚）、Boss 定時降臨
    this.swarmTimerMs = 0
    this.swarmRemaining = 0
    this.swarmAccMs = 0
    this.bossTimerMs = 0
    this.blockerAccMs = 0

    // 效能：FPS 守門
    this.autoPerf = false
    this.lowFpsMs = 0
    this.lastBoss = false

    // 尊重 prefers-reduced-motion：預設降載
    this.reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true

    this.hintMs = 0

    // 綁定（給 FishingCanvas registerResults 與 DOM 事件用）
    this.handleResults = this.handleResults.bind(this)
    this._tick = this._tick.bind(this)
    this._onPointerDown = this._onPointerDown.bind(this)
    this._onPointerMove = this._onPointerMove.bind(this)
    this._onPointerUp = this._onPointerUp.bind(this)
    this._onVisibility = this._onVisibility.bind(this)
    this._onContextMenu = (e) => e.preventDefault()
  }

  async init() {
    this.tex = await preload(PRELOAD_ASSETS, TEX_PX)
    if (this._destroyed) return

    this._buildBackdrop()

    // 砲台（錨點在底部中心，旋轉以底座為支點）；貼圖依砲台等級（銅/銀/金）
    this.cannon = new Sprite(this.tex[this.cannonStyle.asset] || this.tex.cannon || Texture.WHITE)
    this.cannon.anchor.set(0.5, 0.92)
    this.cannon.visible = false
    this.cannonLayer.addChild(this.cannon)
    this.cannonTurret = new Container()
    this.cannonGlow = new Graphics()
    this.cannonBarrel = new Graphics()
    this.cannonTurret.addChild(this.cannonGlow, this.cannonBarrel)
    this.cannonLayer.addChild(this.cannonTurret)

    // 提示文字（餘額不足等）
    this.hint = new Text({
      text: '',
      style: { fill: 0xffe9a8, fontSize: 16, fontWeight: '900', fontFamily: 'inherit' },
    })
    this.hint.anchor.set(0.5)
    this.hint.visible = false
    this.uiLayer.addChild(this.hint)

    // 準心十字（跟隨游標 / 自動射擊目標，改善瞄準）
    this.reticle = new Graphics()
    this.reticle.circle(0, 0, 13).stroke({ width: 2, color: 0xffe9a8, alpha: 0.85 })
    this.reticle
      .moveTo(-19, 0)
      .lineTo(-6, 0)
      .moveTo(6, 0)
      .lineTo(19, 0)
      .moveTo(0, -19)
      .lineTo(0, -6)
      .moveTo(0, 6)
      .lineTo(0, 19)
      .stroke({ width: 2, color: 0xffe9a8, alpha: 0.85 })
    this.reticle.visible = false
    this.uiLayer.addChild(this.reticle)

    // DOM 事件綁在 canvas（座標用 offsetX/offsetY，CSS px，與 stage 邏輯座標一致）
    const canvas = this.app.canvas
    canvas.style.touchAction = 'none'
    canvas.addEventListener('pointerdown', this._onPointerDown)
    canvas.addEventListener('pointermove', this._onPointerMove)
    canvas.addEventListener('pointerup', this._onPointerUp)
    canvas.addEventListener('pointercancel', this._onPointerUp)
    canvas.addEventListener('pointerleave', this._onPointerUp)
    canvas.addEventListener('contextmenu', this._onContextMenu)
    document.addEventListener('visibilitychange', this._onVisibility)

    this.app.ticker.add(this._tick)
  }

  // ---- React props 同步入口 ----
  setPhase(phase) {
    this.ctx.phase = phase
    if (phase !== 'playing') {
      this.holding = false // 離開 playing 一律停連發，避免視覺鎖脫鉤
    }
  }

  setBet(bet) {
    this.ctx.betPerShot = bet
  }

  setFishTable(table) {
    this.table = (table || []).map((f) => ({ ...f, _meta: deriveMeta(f) }))
    if (this.table.some((f) => f.visualKey === 'jackpot-fish-king')) this.bossTimerMs = BOSS_INTERVAL_MS
  }

  setPerfMode(on) {
    this.ctx.perfMode = on
  }

  setCannon(level) {
    this.ctx.cannonLevel = level
    this._syncCannonTexture()
  }

  setAmmoTone(tone) {
    this.ctx.ammoTone = tone
    this._syncCannonTexture()
  }

  _syncCannonTexture() {
    if (!this.cannon || !this.tex) return
    const tex = this.tex[this.cannonStyle.asset]
    if (tex) this.cannon.texture = tex
  }

  get perfMode() {
    return this.ctx.perfMode || this.autoPerf || this.reducedMotion
  }

  get cannonStyle() {
    return CANNON_STYLE_BY_TONE[this.ctx.ammoTone] || CANNON_STYLE[this.ctx.cannonLevel] || CANNON_STYLE[1]
  }

  get maxFish() {
    return this.perfMode ? MAX_FISH_PERF : MAX_FISH
  }

  _cannonZoneHeight(W, H) {
    return Math.max(148, Math.min(190, H * 0.28, W * 0.18))
  }

  _cannonZoneTop(W, H) {
    return H - this._cannonZoneHeight(W, H)
  }

  _fishViewportBottom(W, H) {
    return this._cannonZoneTop(W, H) - 8
  }

  _fishYMax(W, H, size) {
    const yMin = Math.max(size * 0.55, H * 0.08)
    const safeBottom = this._fishViewportBottom(W, H) - Math.max(70, size * 0.55)
    return Math.max(yMin + 24, safeBottom)
  }

  _cannonOrigin(W = this.app.screen.width, H = this.app.screen.height) {
    const zoneTop = this._cannonZoneTop(W, H)
    const zoneH = H - zoneTop
    return {
      x: W / 2,
      y: zoneTop + Math.max(30, Math.min(44, zoneH * 0.32)),
    }
  }
  // ---- 遊戲迴圈 ----
  _tick(ticker) {
    if (this._destroyed) return
    const dtMs = ticker.deltaMS
    const W = this.app.screen.width
    const H = this.app.screen.height
    if (this.cannonPulse > 0) this.cannonPulse = Math.max(0, this.cannonPulse - dtMs)
    this._updateBackdrop(dtMs, W, H)
    if (this.cannon) this.cannon.visible = false

    this._guardFps(dtMs)

    // 生成（只在 playing）
    if (this.ctx.phase === 'playing') {
      this.spawnAccMs += dtMs
      if (this.spawnAccMs >= SPAWN_INTERVAL_MS) {
        this.spawnAccMs = 0
        this._trySpawn(W, H)
      }
      this.blockerAccMs += dtMs
      const blockerInterval = this._blockerIntervalMs()
      if (this.blockerAccMs >= blockerInterval) {
        this.blockerAccMs = 0
        this._spawnBlockerWave(W, H)
      }
      // 魚群潮：週期觸發後短時間密集放小魚
      this.swarmTimerMs += dtMs
      if (this.swarmTimerMs >= SWARM_INTERVAL_MS) {
        this.swarmTimerMs = 0
        this.swarmRemaining = SWARM_SIZE
        this.swarmAccMs = SWARM_SPAWN_MS
      }
      if (this.swarmRemaining > 0) {
        this.swarmAccMs += dtMs
        if (this.swarmAccMs >= SWARM_SPAWN_MS) {
          this.swarmAccMs = 0
          this.swarmRemaining -= 1
          this._trySpawn(W, H, { smallOnly: true })
        }
      }
      // Boss 定時降臨（場上無 boss 時才放）
      this.bossTimerMs += dtMs
      if (this.bossTimerMs >= BOSS_INTERVAL_MS) {
        this.bossTimerMs = 0
        this._spawnBoss(W, H)
      }
      // 按住連發
      this.fireAccMs += dtMs
      if (this.holding && this.pointer && this.fireAccMs >= FIRE_INTERVAL_MS) {
        this.fireAccMs = 0
        this._fireToward(this.pointer.x, this.pointer.y)
      }
    }

    this._updateReticle()
    this._updateFish(dtMs, W, H)
    this._updateBullets(dtMs)
    this._updateSparks(dtMs)
    this._updateFloats(dtMs)
    this._updateDamage(dtMs)
    this._updateHint(dtMs, W, H)
    this._notifyBoss()
  }

  _buildBackdrop() {
    this.seaBack = new Graphics()
    this.caustics = new Graphics()
    this.seaFloor = new Graphics()
    this.cannonDeck = new Graphics()
    this.backdropLayer.addChild(this.seaBack, this.caustics)
    this.decorLayer.addChild(this.seaFloor)
    this.cannonLayer.addChild(this.cannonDeck)

    const bubbleCount = this.reducedMotion ? 10 : 24
    for (let i = 0; i < bubbleCount; i += 1) {
      const g = new Graphics().circle(0, 0, 1).fill({ color: 0xbdf7ff, alpha: 0.62 })
      this.decorLayer.addChild(g)
      this.bubbles.push({
        g,
        x: Math.random(),
        y: Math.random(),
        r: 2 + Math.random() * 7,
        speed: 10 + Math.random() * 26,
        drift: Math.random() * Math.PI * 2,
      })
    }

    // 神光：4 道固定光楔（幾何在 _redrawBackdrop 畫、每幀只調 alpha/位移，零配置成本）
    for (let i = 0; i < 4; i += 1) {
      const g = new Graphics()
      g.blendMode = 'add'
      this.backdropLayer.addChild(g)
      this.godRays.push({ g, phase: Math.random() * Math.PI * 2, speed: 0.16 + i * 0.05 })
    }

    // 浮游生物：固定 20 顆微粒池（比照泡泡的正規化座標更新模式），reducedMotion 不生成
    const planktonCount = this.reducedMotion ? 0 : 20
    for (let i = 0; i < planktonCount; i += 1) {
      const g = new Graphics().circle(0, 0, 1).fill({ color: 0xd8fbe8, alpha: 0.5 })
      this.decorLayer.addChild(g)
      this.plankton.push({
        g,
        x: Math.random(),
        y: Math.random(),
        r: 0.7 + Math.random() * 1.4,
        speed: 2.5 + Math.random() * 5,
        drift: Math.random() * Math.PI * 2,
      })
    }
  }

  _redrawBackdrop(W, H) {
    this.backdropW = W
    this.backdropH = H
    const fishBottom = this._fishViewportBottom(W, H)
    const zoneTop = this._cannonZoneTop(W, H)

    if (this.fishMask) {
      this.fishMask.clear().rect(0, 0, W, fishBottom).fill({ color: 0xffffff, alpha: 1 })
    }

    this.seaBack
      .clear()
      .rect(0, 0, W, fishBottom)
      .fill({ color: 0x073f61, alpha: 0.44 })
      .rect(0, fishBottom * 0.42, W, fishBottom * 0.58)
      .fill({ color: 0x031827, alpha: 0.48 })
      .rect(0, fishBottom * 0.72, W, fishBottom * 0.28)
      .fill({ color: 0x020b16, alpha: 0.42 })
      .rect(0, fishBottom, W, H - fishBottom)
      .fill({ color: 0x05020a, alpha: 0.88 })

    this.caustics.clear()
    for (let i = 0; i < 9; i += 1) {
      const x = (W / 8) * i - W * 0.12
      this.caustics
        .moveTo(x, 0)
        .lineTo(x + W * 0.2, fishBottom * 0.86)
        .stroke({ width: 18 + (i % 3) * 6, color: 0x8ff4ff, alpha: 0.055 })
    }
    for (let i = 0; i < 7; i += 1) {
      const y = fishBottom * 0.18 + i * 34
      this.caustics
        .moveTo(0, y)
        .lineTo(W, y + Math.sin(i) * 18)
        .stroke({ width: 1, color: 0xd8fbff, alpha: 0.07 })
    }

    // 神光光楔：從水面斜射向下、上窄下寬（外層淡、內層稍亮做柔邊），alpha 由每幀更新呼吸
    this.godRays.forEach((ray, i) => {
      const anchorX = W * (0.1 + i * 0.24)
      const slant = W * 0.14
      const topW = W * 0.022
      const bottomW = W * 0.1
      const depth = fishBottom * 0.92
      ray.g
        .clear()
        .poly([
          anchorX, 0,
          anchorX + topW, 0,
          anchorX + slant + bottomW, depth,
          anchorX + slant - bottomW * 0.4, depth,
        ])
        .fill({ color: 0xbdf7ff, alpha: 0.045 })
        .poly([
          anchorX + topW * 0.25, 0,
          anchorX + topW * 0.75, 0,
          anchorX + slant + bottomW * 0.55, depth,
          anchorX + slant + bottomW * 0.1, depth,
        ])
        .fill({ color: 0xe8fcff, alpha: 0.05 })
    })

    this.seaFloor
      .clear()
      .ellipse(W * 0.18, fishBottom - 74, 120, 24)
      .fill({ color: 0x010814, alpha: 0.4 })
      .ellipse(W * 0.72, fishBottom - 90, 170, 32)
      .fill({ color: 0x010814, alpha: 0.34 })
      .roundRect(W * 0.1, fishBottom - 96, 74, 40, 12)
      .fill({ color: 0x111f2c, alpha: 0.68 })
      .roundRect(W * 0.1 + 8, fishBottom - 106, 58, 20, 8)
      .fill({ color: 0x6d1421, alpha: 0.78 })
      .rect(W * 0.1 + 10, fishBottom - 94, 54, 7)
      .fill({ color: 0xffcf5d, alpha: 0.62 })
      .circle(W * 0.1 + 18, fishBottom - 111, 5)
      .fill({ color: 0xffe38a, alpha: 0.82 })
      .circle(W * 0.1 + 32, fishBottom - 113, 4)
      .fill({ color: 0xffe38a, alpha: 0.72 })
      .circle(W * 0.1 + 46, fishBottom - 111, 5)
      .fill({ color: 0xffe38a, alpha: 0.82 })
      .roundRect(-24, fishBottom - 44, W + 48, 62, 22)
      .fill({ color: 0x042033, alpha: 0.78 })
      .roundRect(24, fishBottom - 28, W - 48, 28, 14)
      .fill({ color: 0x0b3140, alpha: 0.58 })
      .rect(0, zoneTop - 2, W, 2)
      .fill({ color: 0xffd66a, alpha: 0.36 })

    const coralColors = [0xff5e82, 0xffc14d, 0x62e0c6, 0x8d7cff]
    for (let i = 0; i < 14; i += 1) {
      const side = i % 2 === 0 ? 0 : 1
      const x = side === 0 ? 32 + (i % 7) * 28 : W - 38 - (i % 7) * 31
      const base = fishBottom - 8
      const h = 20 + (i % 4) * 7
      const color = coralColors[i % coralColors.length]
      this.seaFloor
        .roundRect(x, base - h, 8, h, 4)
        .fill({ color, alpha: 0.5 })
        .circle(x + 3, base - h - 3, 6 + (i % 3), 6 + (i % 3))
        .fill({ color, alpha: 0.44 })
    }

    this._drawCannonDeck(W, H)
  }

  _drawCannonDeck(W, H) {
    if (!this.cannonDeck) return
    const deckPulse = this.cannonPulse / 150
    const zoneTop = this._cannonZoneTop(W, H)
    const zoneH = H - zoneTop
    const origin = this._cannonOrigin(W, H)
    const glow = deckPulse * 0.36
    const style = this.cannonStyle
    const scale = style.deckScale || 1
    const podW = Math.max(210, Math.min(460, W * 0.52 * scale))
    const podH = Math.max(54, Math.min(92, zoneH * 0.78 * scale))
    const podX = W / 2 - podW / 2
    const podY = H - podH - 8
    const accent = style.bullet

    this.cannonDeck
      .clear()
      .rect(0, zoneTop, W, zoneH)
      .fill({ color: 0x07020b, alpha: 0.94 })
      .rect(0, zoneTop, W, 3)
      .fill({ color: 0xffd86b, alpha: 0.42 + glow })
      .rect(0, zoneTop + 4, W, 1)
      .fill({ color: 0x56f0ff, alpha: 0.18 + glow * 0.4 })
      .roundRect(podX, podY, podW, podH, 22)
      .fill({ color: 0x180611, alpha: 0.96 })
      .roundRect(podX + 7, podY + 7, podW - 14, podH - 14, 17)
      .fill({ color: 0x5c0f1e, alpha: 0.86 })
      .roundRect(podX + 18, podY + podH * 0.58, podW - 36, 8, 8)
      .fill({ color: 0xffcc5d, alpha: 0.24 + glow })
      .roundRect(podX + podW * 0.18, podY + podH * 0.72, podW * (0.42 + deckPulse * 0.16), 4, 4)
      .fill({ color: 0x54eaff, alpha: 0.28 + glow })
      .roundRect(podX + 18, podY + 13, podW * 0.2, 14, 7)
      .fill({ color: 0x0e2330, alpha: 0.92 })
      .roundRect(podX + podW - podW * 0.2 - 18, podY + 13, podW * 0.2, 14, 7)
      .fill({ color: 0x0e2330, alpha: 0.92 })
      .circle(origin.x, origin.y + 5, (28 + deckPulse * 5) * scale)
      .fill({ color: 0xffd260, alpha: 0.22 + deckPulse * 0.18 })
      .circle(origin.x, origin.y + 5, (21 + deckPulse * 3) * scale)
      .fill({ color: 0x1b0712, alpha: 0.95 })
      .circle(origin.x, origin.y + 5, (13 + deckPulse * 2) * scale)
      .fill({ color: style.core || accent, alpha: 0.34 + deckPulse * 0.28 })

    this._drawCannonTurret(W, H, deckPulse)
  }

  _drawCannonTurret(W, H, deckPulse) {
    if (!this.cannonTurret || !this.cannonBarrel || !this.cannonGlow) return
    const origin = this._cannonOrigin(W, H)
    const style = this.cannonStyle
    const scale = style.scale || 1
    const recoil = deckPulse * (5 + scale * 4)
    const barrelLen = Math.max(34, Math.min(70, H * 0.105 * scale)) * (style.barrelLengthScale || 1)
    const barrelW = Math.max(12, Math.min(28, W * 0.026 * (0.86 + scale * 0.18)))
    const baseR = 15 + scale * 8
    const offsets = style.barrelOffsets || [0]
    const barrelUnitW = barrelW * (style.barrelWidthScale || 1)
    const spread = barrelW * 1.08
    const g = this.cannonBarrel

    this.cannonTurret.x = origin.x
    this.cannonTurret.y = origin.y + deckPulse * 4
    this.cannonTurret.rotation = this.aim
    this.cannonGlow
      .clear()
      .circle(0, -barrelLen - 4, 18 * scale + deckPulse * 10)
      .fill({ color: style.bullet, alpha: 0.08 + deckPulse * 0.18 })
      .circle(0, -barrelLen - 4, Math.max(6, barrelUnitW * 0.72) + deckPulse * 2)
      .fill({ color: style.glow || style.bullet, alpha: 0.16 + deckPulse * 0.2 })

    g.clear()

    if (style.tone === 'gold') {
      g.roundRect(-baseR * 1.55, -baseR * 0.28, baseR * 0.72, baseR * 0.72, 10)
        .fill({ color: 0x5a101b, alpha: 0.95 })
        .roundRect(baseR * 0.83, -baseR * 0.28, baseR * 0.72, baseR * 0.72, 10)
        .fill({ color: 0x5a101b, alpha: 0.95 })
        .circle(-baseR * 1.16, 0, baseR * 0.33)
        .fill({ color: style.trim, alpha: 0.7 })
        .circle(baseR * 1.16, 0, baseR * 0.33)
        .fill({ color: style.trim, alpha: 0.7 })
    } else if (style.tone === 'silver') {
      g.circle(-baseR * 0.82, baseR * 0.08, baseR * 0.34)
        .fill({ color: 0x1d4054, alpha: 0.9 })
        .circle(baseR * 0.82, baseR * 0.08, baseR * 0.34)
        .fill({ color: 0x1d4054, alpha: 0.9 })
    }

    for (const offset of offsets) {
      const ox = offset * spread
      const muzzleR = barrelUnitW * (offsets.length > 1 ? 0.64 : 0.72)
      g.roundRect(ox - barrelUnitW / 2 - 4, -barrelLen + recoil, barrelUnitW + 8, barrelLen, 10)
        .fill({ color: 0x180611, alpha: 0.98 })
        .roundRect(ox - barrelUnitW / 2, -barrelLen + 5 + recoil, barrelUnitW, barrelLen - 6, 8)
        .fill({ color: style.barrel || 0x971c2c, alpha: 0.94 })
        .roundRect(ox - barrelUnitW / 2 + 3, -barrelLen + 9 + recoil, Math.max(5, barrelUnitW - 6), barrelLen * 0.54, 6)
        .fill({ color: style.trim || 0xffd36b, alpha: 0.58 })
        .roundRect(ox - barrelUnitW / 2 + 5, -barrelLen + 14 + recoil, Math.max(3, barrelUnitW - 10), barrelLen * 0.38, 5)
        .fill({ color: style.glow || 0x66efff, alpha: 0.25 + deckPulse * 0.28 })
        .circle(ox, -barrelLen + recoil, muzzleR + deckPulse * 2)
        .fill({ color: style.bullet, alpha: 0.56 + deckPulse * 0.22 })
    }

    g.circle(0, 0, baseR * (style.tone === 'gold' ? 1.18 : 1))
      .fill({ color: 0x230816, alpha: 0.98 })
      .circle(0, 0, baseR * (style.tone === 'gold' ? 0.72 : 0.62))
      .fill({ color: style.core || 0xffca5c, alpha: 0.64 })
      .circle(0, 0, baseR * 0.34 + deckPulse * 3)
      .fill({ color: style.bullet, alpha: 0.58 + deckPulse * 0.24 })

    if (style.tone === 'copper') {
      g.circle(0, baseR * 0.18, baseR * 0.18).fill({ color: 0xffe2a4, alpha: 0.55 })
    } else if (style.tone === 'silver') {
      g.roundRect(-baseR * 0.75, baseR * 0.34, baseR * 1.5, baseR * 0.2, 999)
        .fill({ color: 0xdbeafe, alpha: 0.42 })
    } else if (style.tone === 'gold') {
      g.circle(0, -baseR * 0.42, baseR * 0.16)
        .fill({ color: 0xffffff, alpha: 0.42 })
        .circle(-baseR * 0.52, -baseR * 0.12, baseR * 0.12)
        .fill({ color: 0xfff0aa, alpha: 0.36 })
        .circle(baseR * 0.52, -baseR * 0.12, baseR * 0.12)
        .fill({ color: 0xfff0aa, alpha: 0.36 })
    }
  }
  _updateBackdrop(dtMs, W, H) {
    if (!this.seaBack) return
    if (W !== this.backdropW || H !== this.backdropH) this._redrawBackdrop(W, H)

    this.backdropTime += dtMs / 1000
    this.caustics.x = Math.sin(this.backdropTime * 0.45) * 18
    this.caustics.alpha = this.perfMode ? 0.56 : 0.86

    // 神光呼吸＋隨水流微擺；perfMode 直接熄滅（同 caustics 的守門模式）
    for (const ray of this.godRays) {
      if (this.perfMode) {
        ray.g.alpha = 0
        continue
      }
      ray.phase += (dtMs / 1000) * ray.speed
      ray.g.alpha = 0.5 + Math.sin(ray.phase) * 0.4
      ray.g.x = Math.sin(this.backdropTime * 0.3 + ray.phase) * 10
    }

    // 浮游生物緩慢上漂＋橫向游移；perfMode 減半亮度（不重配置，只調 alpha）
    for (const p of this.plankton) {
      p.y -= (p.speed * dtMs) / Math.max(H, 1) / 1000
      p.drift += dtMs * 0.0007
      if (p.y < -0.04) {
        p.y = 1.04
        p.x = Math.random()
      }
      p.g.x = p.x * W + Math.sin(p.drift) * 22
      p.g.y = p.y * this._fishViewportBottom(W, H)
      p.g.scale.set(p.r)
      p.g.alpha = (this.perfMode ? 0.14 : 0.3) + Math.sin(p.drift * 1.6) * 0.1
    }

    for (const b of this.bubbles) {
      b.y -= (b.speed * dtMs) / Math.max(H, 1) / 1000
      b.drift += dtMs * 0.0012
      if (b.y < -0.08) {
        b.y = 1.08
        b.x = Math.random()
      }
      b.g.x = b.x * W + Math.sin(b.drift) * 14
      b.g.y = b.y * this._fishViewportBottom(W, H)
      b.g.scale.set(b.r)
      b.g.alpha = this.perfMode ? 0.24 : 0.42 + Math.sin(b.drift) * 0.12
    }
    this._drawCannonDeck(W, H)
  }

  _guardFps(dtMs) {
    const fps = this.app.ticker.FPS
    if (fps && fps < 40) this.lowFpsMs += dtMs
    else this.lowFpsMs = Math.max(0, this.lowFpsMs - dtMs)
    if (this.lowFpsMs > 2000) this.autoPerf = true // 連續低幀 → 自動降載（不再回升，避免抖動）
  }

  _blockerThreatLevel() {
    return this.fish.reduce((sum, f) => {
      if (f.blocker || f.caught || f.fleeing) return sum
      if (f.tier === 'boss') return sum + 3
      if (f.tier === 'high' || f.tier === 'special') return sum + 2
      if (f.tier === 'medium') return sum + 1
      return sum
    }, 0)
  }

  _blockerIntervalMs() {
    const pressure = this._blockerThreatLevel()
    const interval = BLOCKER_INTERVAL_MS - pressure * 650
    return Math.max(this.perfMode ? BLOCKER_MIN_INTERVAL_MS + 700 : BLOCKER_MIN_INTERVAL_MS, interval)
  }

  _blockerMaxCount(pressure = this._blockerThreatLevel()) {
    const bonus = Math.min(MAX_BLOCKER_THREAT_BONUS, Math.floor((pressure + 1) / 2))
    return Math.min(this.perfMode ? 5 : MAX_BLOCKERS + MAX_BLOCKER_THREAT_BONUS, MAX_BLOCKERS + bonus)
  }

  _spawnBlockerWave(W, H) {
    const pressure = this._blockerThreatLevel()
    const maxBlockers = this._blockerMaxCount(pressure)
    const burst = pressure >= 5 ? 3 : pressure >= 2 ? 2 : 1
    for (let i = 0; i < burst; i += 1) {
      if (i > 0 && Math.random() > Math.min(0.82, 0.28 + pressure * 0.11)) break
      if (!this._trySpawnBlocker(W, H, { maxBlockers })) break
    }
  }

  _trySpawn(W, H, opts = {}) {
    if (!this.table || this.table.length === 0) return
    const hardCap = this.maxFish + (opts.boss ? 2 : 0) // Boss 保證降臨，可略超並存上限
    if (this.fish.length >= hardCap) return
    let pick
    if (opts.pick) {
      pick = opts.pick
    } else if (opts.code) {
      pick = this.table.find((f) => f.code === opts.code)
    } else if (opts.smallOnly) {
      const smalls = this.table.filter((f) => f._meta.tier === 'small')
      pick = smalls.length ? weightedPick(smalls) : weightedPick(this.table)
    } else {
      pick = weightedPick(this.table)
    }
    if (!pick) return
    const meta = pick._meta
    const size = meta.size
    const margin = size
    const baseScale = size / TEX_PX
    const speed = (W + margin * 2) / (meta.durMin + Math.random() * (meta.durMax - meta.durMin)) / 1000
    const yMin = Math.max(size * 0.55, H * 0.08)
    const yMax = this._fishYMax(W, H, size)
    const ySpan = Math.max(1, yMax - yMin)
    const verticalRatio = meta.tier === 'boss' ? 0.1 : meta.tier === 'small' ? 0.32 : 0.22
    const spawnRoll = meta.tier === 'boss' ? Math.random() * 0.58 : Math.random()
    let vx
    let vy
    let startX
    let baseY
    let entrySide = null
    if (spawnRoll < 0.52) {
      const fromLeft = Math.random() > 0.5
      startX = fromLeft ? -margin : W + margin
      baseY = yMin + Math.random() * ySpan
      vx = (fromLeft ? 1 : -1) * speed
      vy = (Math.random() > 0.5 ? 1 : -1) * speed * verticalRatio * (0.45 + Math.random() * 0.75)
    } else if (spawnRoll < 0.76) {
      startX = W * (0.12 + Math.random() * 0.76)
      baseY = -margin
      entrySide = 'top'
      vx = (Math.random() > 0.5 ? 1 : -1) * speed * (0.55 + Math.random() * 0.5)
      vy = Math.abs(speed) * (0.26 + Math.random() * 0.42)
    } else {
      const fromLeft = Math.random() > 0.5
      startX = fromLeft ? -margin : W + margin
      baseY = yMin + Math.random() * ySpan
      entrySide = null
      vx = (fromLeft ? 1 : -1) * speed * (0.58 + Math.random() * 0.52)
      vy = -Math.abs(speed) * (0.1 + Math.random() * 0.24)
    }
    const dir = vx >= 0 ? 'ltr' : 'rtl'

    if (meta.tier === 'boss') this.ctx.play?.('bossAlarm')

    const sprite = new Sprite(this.tex[pick.assetId] || Texture.WHITE)
    sprite.anchor.set(0.5)
    sprite.scale.set(dir === 'ltr' ? baseScale : -baseScale, baseScale) // 朝向翻面
    sprite.x = startX
    sprite.y = baseY
    this.fishLayer.addChild(sprite)

    // HP 條（魚頭上方）：滿血時隱藏（減雜訊），命中後顯示一段時間。fill 左端對齊、scale.x 由左往右縮。
    const barW = size * HP_BAR_W_RATIO
    const hpBar = new Container()
    const hpBg = new Graphics().roundRect(-barW / 2, 0, barW, HP_BAR_H, 2).fill({ color: 0x180c0c, alpha: 0.72 })
    const hpFill = new Graphics().rect(0, 0, barW, HP_BAR_H).fill({ color: 0xffffff })
    hpFill.x = -barW / 2
    hpFill.tint = HP_GREEN
    hpBar.addChild(hpBg, hpFill)
    hpBar.visible = false
    this.hpLayer.addChild(hpBar)

    // 高倍魚光暈（在魚下方，alpha 脈動強化辨識；效能模式減半）
    let glow = null
    if (meta.glow > 0) {
      glow = new Graphics().circle(0, 0, size * 0.62).fill({ color: 0xffe39a, alpha: 0.3 })
      this.glowLayer.addChild(glow)
    }

    const maxHp = pick.hp || pick.multiplier * 10
    this.fish.push({
      id: (this.idSeq += 1),
      code: pick.code,
      name: pick.name,
      multiplier: pick.multiplier,
      tier: meta.tier,
      sprite,
      dir,
      baseScale,
      dispSize: size,
      vx,
      vy,
      x: sprite.x,
      y: baseY,
      baseY,
      yMin,
      yMax,
      entrySide,
      margin,
      bob: Math.random() * Math.PI * 2,
      caught: false,
      caughtMs: 0,
      maxHp,
      hp: maxHp,
      hpBar,
      hpFill,
      hpShownMs: 0,
      fleeing: false,
      fleeMs: 0,
      glow,
      glowPhase: Math.random() * Math.PI * 2,
      glowAmp: meta.glow,
    })
  }

  // Boss 定時降臨：優先讓彩金魚王出場，且射擊仍沿用後端 DRAGON_KING 合約。
  _trySpawnBlocker(W, H, opts = {}) {
    const maxBlockers = opts.maxBlockers ?? this._blockerMaxCount()
    const liveBlockers = this.fish.filter((f) => f.blocker && !f.caught && !f.fleeing).length
    if (liveBlockers >= maxBlockers) return false
    const kind = BLOCKER_SPECIES[Math.floor(Math.random() * BLOCKER_SPECIES.length)] || BLOCKER_SPECIES[0]
    const profile = BLOCKER_SIZE_PROFILES[Math.floor(Math.random() * BLOCKER_SIZE_PROFILES.length)] || BLOCKER_SIZE_PROFILES[1]
    const baseSize = kind.sizeMin + Math.random() * (kind.sizeMax - kind.sizeMin)
    const size = baseSize * profile.scale
    const margin = size
    const yMin = Math.max(size * 0.6, H * 0.15)
    const yMax = this._fishYMax(W, H, size)
    if (yMax <= yMin) return false
    const fromLeft = Math.random() > 0.5
    const duration = (kind.durMin + Math.random() * (kind.durMax - kind.durMin)) * profile.durationFactor
    const speed = (W + margin * 2) / duration / 1000
    const vx = (fromLeft ? 1 : -1) * speed
    const vy = (Math.random() - 0.5) * speed * kind.wobble
    const baseScale = size / TEX_PX
    const sprite = new Sprite(this.tex[kind.asset] || Texture.WHITE)
    sprite.anchor.set(0.5)
    sprite.tint = kind.tint
    sprite.alpha = kind.alpha
    sprite.scale.set(fromLeft ? baseScale : -baseScale, baseScale)
    sprite.x = fromLeft ? -margin : W + margin
    sprite.y = yMin + Math.random() * (yMax - yMin)
    this.fishLayer.addChild(sprite)
    this.fish.push({
      id: (this.idSeq += 1),
      code: kind.code,
      name: profile.name + kind.name,
      blockerSize: profile.key,
      blockerSizeName: profile.name,
      multiplier: 0,
      tier: 'blocker',
      blocker: true,
      sprite,
      dir: fromLeft ? 'ltr' : 'rtl',
      baseScale,
      dispSize: size,
      vx,
      vy,
      x: sprite.x,
      y: sprite.y,
      baseY: sprite.y,
      yMin,
      yMax,
      entrySide: null,
      margin,
      bob: Math.random() * Math.PI * 2,
      caught: false,
      caughtMs: 0,
      maxHp: profile.maxHits,
      hp: profile.maxHits,
      hpBar: null,
      hpFill: null,
      hpShownMs: 0,
      fleeing: false,
      blockerHits: 0,
      blockerMaxHits: profile.maxHits,
      fleeMs: 0,
      glow: null,
      glowPhase: Math.random() * Math.PI * 2,
      glowAmp: 0,
    })
    return true
  }
  _spawnBoss(W, H) {
    if (!this.table) return
    if (this.fish.some((f) => !f.caught && !f.fleeing && f.tier === 'boss')) return
    const bosses = this.table.filter((f) => f._meta.tier === 'boss')
    if (bosses.length === 0) return
    const jackpotFishKing = bosses.find((f) => f.visualKey === 'jackpot-fish-king')
    const boss = jackpotFishKing || weightedPick(bosses)
    this._trySpawn(W, H, { pick: boss, boss: true })
  }

  _updateFish(dtMs, W, H) {
    const dt = dtMs / 1000
    for (let i = this.fish.length - 1; i >= 0; i -= 1) {
      const f = this.fish[i]
      if (f.caught) {
        f.caughtMs += dtMs
        const k = Math.min(1, f.caughtMs / CAUGHT_MS)
        f.sprite.alpha = 1 - k
        const s = f.baseScale * (1 + k * 0.35)
        f.sprite.scale.set(f.dir === 'ltr' ? s : -s, s)
        if (f.hpBar) f.hpBar.visible = false
        if (f.glow) f.glow.alpha = (1 - k) * 0.3
        if (k >= 1) this._removeFishAt(i)
        continue
      }
      if (f.fleeing) {
        // 致命一擊未捕獲＝掙脫逃跑：加速竄出 + 上抖 + 淡出後移除（高倍魚的惋惜演出）。
        f.fleeMs += dtMs
        const k = Math.min(1, f.fleeMs / FLEE_MS)
        f.x += f.vx * dtMs * 2.4
        f.y = f.baseY - k * 34 + Math.sin(f.fleeMs * 0.05) * 4
        f.sprite.x = f.x
        f.sprite.y = f.y
        f.sprite.alpha = 1 - k
        if (f.hpBar) f.hpBar.visible = false
        if (f.glow) f.glow.visible = false
        if (k >= 1) this._removeFishAt(i)
        continue
      }
      f.x += f.vx * dtMs
      f.baseY += (f.vy || 0) * dtMs
      const yMin = f.yMin ?? Math.max(f.dispSize * 0.55, H * 0.08)
      const yMax = f.yMax ?? this._fishYMax(W, H, f.dispSize)
      if (f.entrySide === 'top' && f.baseY >= yMin) {
        f.baseY = yMin
        f.entrySide = null
      } else if (f.entrySide === 'bottom' && f.baseY <= yMax) {
        f.baseY = yMax
        f.entrySide = null
      }
      f.bob += BOB_SPEED * dt
      f.y = f.baseY + (this.perfMode ? 0 : Math.sin(f.bob) * BOB_AMP)
      const swim = this.perfMode ? 0 : Math.sin(f.bob * 1.8 + f.glowPhase)
      const sx = f.baseScale * (1 + swim * 0.035)
      const sy = f.baseScale * (1 - swim * 0.018)
      f.sprite.scale.set(f.dir === 'ltr' ? sx : -sx, sy)
      const pathTilt = Math.atan2(f.vy || 0, Math.max(Math.abs(f.vx), 0.001)) * (f.dir === 'ltr' ? 0.24 : -0.24)
      f.sprite.rotation = pathTilt + swim * 0.028 * (f.dir === 'ltr' ? -1 : 1)
      f.sprite.x = f.x
      f.sprite.y = f.y
      this._updateHpBar(f, dtMs)
      if (f.glow) {
        f.glow.x = f.x
        f.glow.y = f.y
        f.glowPhase += dt * 3
        const pulse = 0.2 + (Math.sin(f.glowPhase) * 0.5 + 0.5) * 0.26 * f.glowAmp
        f.glow.alpha = this.perfMode ? pulse * 0.5 : pulse
      }
      // 游出畫面回收
      if (f.x < -f.margin - 4 || f.x > W + f.margin + 4 || f.baseY < -f.margin - 4 || f.baseY > this._fishViewportBottom(W, H) + f.margin + 4) this._removeFishAt(i)
    }
  }
  _updateHpBar() {
    // HP bars are intentionally hidden; combat feedback is handled by hit sparks and crit text.
  }

  _removeFishAt(i) {
    const f = this.fish[i]
    this.fish.splice(i, 1)
    f.sprite.destroy()
    if (f.hpBar) f.hpBar.destroy({ children: true })
    if (f.glow) f.glow.destroy()
  }

  _removeFishById(id) {
    const i = this.fish.findIndex((f) => f.id === id)
    if (i >= 0) this._removeFishAt(i)
  }

  // ---- 指標 / 開火 ----
  _local(event) {
    // pointer 事件的 offsetX/offsetY 已是相對 canvas 的 CSS px
    return { x: event.offsetX, y: event.offsetY }
  }

  _aimFor(px, py) {
    const { x, y } = this._cannonOrigin()
    return Math.atan2(px - x, y - py)
  }
  _bulletOrigin() {
    return this._cannonOrigin()
  }

  _rayTargetThrough(px, py) {
    const { x: sx, y: sy } = this._bulletOrigin()
    const dx = px - sx
    const dy = py - sy
    const len = Math.hypot(dx, dy)
    if (len < 1) return { x: px, y: py }

    const ux = dx / len
    const uy = dy / len
    const W = this.app.screen.width
    const H = this._fishViewportBottom(this.app.screen.width, this.app.screen.height)
    const candidates = []

    if (ux > 0) candidates.push((W - sx) / ux)
    else if (ux < 0) candidates.push((0 - sx) / ux)

    if (uy > 0) candidates.push((H - sy) / uy)
    else if (uy < 0) candidates.push((0 - sy) / uy)

    const distance = candidates.filter((t) => Number.isFinite(t) && t > 0).reduce((best, t) => Math.min(best, t), Infinity)
    if (!Number.isFinite(distance)) return { x: px, y: py }

    return { x: sx + ux * distance, y: sy + uy * distance }
  }

  _fishHitRadius(f) {
    const tierBoost = f.tier === 'boss' ? 0.44 : f.tier === 'high' || f.tier === 'special' ? 0.4 : 0.34
    return Math.max(14, Math.min(86, f.dispSize * tierBoost + this.cannonStyle.bulletR))
  }

  _firstFishOnPath(tx, ty) {
    const { x: sx, y: sy } = this._bulletOrigin()
    const dx = tx - sx
    const dy = ty - sy
    const lenSq = dx * dx + dy * dy
    if (lenSq < 1) return null

    let best = null
    let bestT = Infinity
    for (const f of this.fish) {
      if (f.caught || f.fleeing) continue
      const fx = f.x - sx
      const fy = f.y - sy
      const t = (fx * dx + fy * dy) / lenSq
      if (t < 0.02 || t > 1) continue

      const px = sx + dx * t
      const py = sy + dy * t
      const dist = Math.hypot(f.x - px, f.y - py)
      if (dist <= this._fishHitRadius(f) && t < bestT) {
        bestT = t
        best = { fish: f, x: px, y: py }
      }
    }
    return best
  }

  // 準心跟隨：自動射擊鎖定目標優先（轉橘紅），否則跟游標。
  _updateReticle() {
    if (!this.reticle) return
    if (this.ctx.phase !== 'playing') {
      this.reticle.visible = false
      return
    }
    const t = this.pointer
    if (!t) {
      this.reticle.visible = false
      return
    }
    this.reticle.visible = true
    this.reticle.x = t.x
    this.reticle.y = t.y
    this.reticle.tint = 0xffffff
  }

  // 對指定魚開一發；回傳 'fired' | 'ratelimited' | 'insufficient' | 'inactive'
  _blockShot(f, opts = {}) {
    const aimX = opts.aimX ?? f.x
    const aimY = opts.aimY ?? f.y
    this.aim = this._aimFor(aimX, aimY)

    const res = this.ctx.fire?.(String(f.id), f.code)
    if (!res || !res.ok) {
      if (res?.reason === 'insufficient') this._showHint('星幣不足，請加值後再開火')
      return res?.reason || 'inactive'
    }

    this.ctx.play?.('shoot', { pitch: this.cannonStyle.pitch + Math.random() * 0.08 })
    this.ctx.play?.('hit')
    const hitX = opts.bulletX ?? f.x
    const hitY = opts.bulletY ?? f.y
    this._spawnBullet(hitX, hitY)
    this._spawnSpark(hitX, hitY, { color: 0x8df2ff, startScale: 0.55, grow: 1.85 })

    f.blockerHits = Math.min((f.blockerHits || 0) + 1, f.blockerMaxHits || 10)
    const maxHits = f.blockerMaxHits || 10
    const cost = Number(res.betPerShot || this.ctx.betPerShot || 0)
    const costLabel = cost > 0 ? '，扣 ' + cost.toLocaleString() + ' 星幣' : '，已扣星幣'
    const blockedLabel = (f.name || '障礙生物') + '擋下子彈 ' + f.blockerHits + '/' + maxHits + costLabel
    this._showHint(blockedLabel)
    f.sprite.alpha = Math.max(0.5, (f.sprite.alpha || 1) - 0.035)
    f.sprite.rotation += (f.dir === 'ltr' ? 1 : -1) * 0.08
    if (f.blockerHits >= maxHits) {
      f.fleeing = true
      f.fleeMs = 0
      this._spawnSpark(hitX + 10, hitY - 8, { color: 0xffffff, startScale: 0.34, grow: 1.3 })
    }
    return 'blocked'
  }
  _engageFish(f, opts = {}) {
    if (this.ctx.phase !== 'playing' || f.caught) return 'inactive'
    if (f.blocker) return this._blockShot(f, opts)
    const aimX = opts.aimX ?? f.x
    const aimY = opts.aimY ?? f.y
    this.aim = this._aimFor(aimX, aimY)
    if (f.tier === 'boss' || f.tier === 'high' || f.tier === 'special') this.ctx.play?.('lockOn')

    const res = this.ctx.fire?.(String(f.id), f.code)
    if (!res || !res.ok) {
      if (res?.reason === 'insufficient') this._showHint('星幣不足，請加值後再開火')
      return res?.reason || 'inactive'
    }
    this.ctx.play?.('shoot', { pitch: this.cannonStyle.pitch + Math.random() * 0.08 })
    const hitX = opts.bulletX ?? f.x
    const hitY = opts.bulletY ?? f.y
    this._spawnBullet(hitX, hitY)

    const previewDamage = Math.max(0, Number(this.cannonStyle.damage || 0))
    if (previewDamage > 0 && typeof f.hp === 'number' && typeof f.maxHp === 'number') {
      f.hp = Math.max(0, Math.min(f.maxHp, f.hp - previewDamage))
      f.hpShownMs = HP_SHOW_MS
      this._spawnSpark(hitX, hitY, { color: this.cannonStyle.bullet, startScale: 0.5, grow: 1.45 })
    }

    this.pending.set(res.shotSeq, {
      fishId: f.id,
      code: f.code,
      multiplier: f.multiplier,
      tier: f.tier,
      x: f.x,
      y: f.y,
      previewDamage,
    })
    return 'fired'
  }
  // 朝游標方向開火：沿砲口→游標路徑做碰撞，先打到最先擋住彈道的魚；空海域才放純視覺曳光。
  // 限流時不生成視覺子彈，避免玩家誤以為大量子彈有效果（實際上未扣注、未傷魚）。
  _fireToward(px, py) {
    if (this.ctx.phase !== 'playing') return
    const rayTarget = this._rayTargetThrough(px, py)
    this.aim = this._aimFor(rayTarget.x, rayTarget.y)
    const hit = this._firstFishOnPath(rayTarget.x, rayTarget.y)
    if (!hit) {
      const missId = 'miss-' + (this.idSeq += 1)
      const res = this.ctx.fire?.(missId, 'MISS')
      if (!res || !res.ok) {
        if (res?.reason === 'insufficient') this._showHint('星幣不足，請加值後再開火')
        return res?.reason || 'inactive'
      }
      this.ctx.play?.('shoot', { pitch: this.cannonStyle.pitch + Math.random() * 0.08 })
      this._spawnBullet(rayTarget.x, rayTarget.y)
      return 'miss'
    }

    this._engageFish(hit.fish, { aimX: rayTarget.x, aimY: rayTarget.y, bulletX: hit.x, bulletY: hit.y })
  }

  _onPointerDown(event) {
    if (this.ctx.phase !== 'playing' || event.button === 2) return
    event.preventDefault()
    const p = this._local(event)
    this.pointer = p
    this.holding = true
    this.fireAccMs = 0
    try {
      this.app.canvas.setPointerCapture?.(event.pointerId)
    } catch {
      /* 不支援時退化 */
    }
    this._fireToward(p.x, p.y) // 立即第一發
  }

  _onPointerMove(event) {
    if (this.ctx.phase !== 'playing') return
    const p = this._local(event)
    this.pointer = p
    this.aim = this._aimFor(p.x, p.y)
  }

  _onPointerUp(event) {
    if (!this.holding) return
    this.holding = false
    try {
      this.app.canvas.releasePointerCapture?.(event.pointerId)
    } catch {
      /* 已釋放 */
    }
  }

  _onVisibility() {
    // 分頁隱藏暫停 ticker，避免背景跑滿計時器
    if (document.hidden) {
      this.app.ticker.stop()
    } else if (!this._destroyed) {
      this.app.ticker.start()
    }
  }

  // ---- 命中結果（由 hook 的 onResults 轉接進來；邏輯搬自舊 FishingArena.handleResults）----
  handleResults(results) {
    if (this._destroyed || !results) return
    const bet = this.ctx.betPerShot || 1
    for (const r of results) {
      const pending = this.pending.get(r.shotSeq)
      this.pending.delete(r.shotSeq)
      if (!pending) continue
      if (!r.accepted) {
        this._showHint('局內餘額不足，請結算後再加值')
        continue
      }
      // 用魚「現在」的座標冒數字/火花（子彈往返期間魚已移動）；魚已不在則退回開火當下座標。
      const f = this.fish.find((x) => x.id === pending.fishId && !x.caught && !x.fleeing)
      const px = f ? f.x : pending.x
      const py = f ? f.y : pending.y

      // 命中音（統一）：暴擊用 crit、一般用 hit，讓三種結果都有打擊感
      this.ctx.play?.(r.crit ? 'crit' : 'hit')
      // Critical hits still show text; normal damage numbers are hidden.
      if (r.crit) this._spawnDamage(px, py, r.damage, true)
      // Keep authoritative HP internally without drawing HP bars.
      // 夾在 [0, maxHp]：純防禦，避免任何異常偏高回傳讓 HP 條視覺溢出/看似回滿
      if (f && typeof r.hpRemaining === 'number') {
        f.hp = Math.max(0, Math.min(f.maxHp, r.hpRemaining))
        f.hpShownMs = HP_SHOW_MS
      }

      if (r.captured && r.payout > 0) {
        // 致命一擊 + 捕獲：派彩演出
        const effMult = Math.max(1, Math.round(r.payout / bet))
        this.ctx.play?.('net')
        this.ctx.play?.('fishCaught')
        this._spawnSpark(px, py, { color: effMult >= 30 ? 0xffd75d : 0xfff3c4, startScale: effMult >= 30 ? 0.9 : 0.55, grow: effMult >= 30 ? 2.4 : 1.7 })
        if (effMult >= 10) this._spawnSpark(px + 16, py - 8, { color: 0x5cf2ff, startScale: 0.38, grow: 1.8 })
        if (effMult >= 30) this._spawnSpark(px - 20, py + 8, { color: 0xff4f75, startScale: 0.42, grow: 2.1 })
        this._spawnFloat(px, py, r.payout)
        if (f) {
          f.caught = true
          f.caughtMs = 0
        }
        this.ctx.onCatch?.({ payout: r.payout, multiplier: pending.multiplier, effMult, tier: pending.tier })
      } else if (r.killed) {
        // 致命一擊但掙脫逃跑：標記 fleeing 交給 _updateFish 演出（高倍魚加惋惜音）
        if (pending.multiplier >= 15) this.ctx.play?.('fishEscape')
        if (f) {
          f.fleeing = true
          f.fleeMs = 0
        } else {
          this._removeFishById(pending.fishId)
        }
        this.ctx.onMiss?.({ multiplier: pending.multiplier })
      } else {
        // 命中但未死（擦傷）：火花回饋
        this._spawnSpark(px, py)
      }
    }
  }

  _notifyBoss() {
    const active = this.fish.some((f) => !f.caught && f.tier === 'boss')
    if (active !== this.lastBoss) {
      this.lastBoss = active
      this.ctx.onBossChange?.(active)
    }
  }

  // ---- 子彈 / 火花 / 浮字（物件池）----
  _spawnBullet(tx, ty) {
    const cap = this.perfMode ? 18 : 40
    if (this.bullets.length >= cap) return
    const style = this.cannonStyle
    let g = this.bulletPool.pop()
    if (!g) {
      g = new Graphics()
        .ellipse(-10, 0, 18, 5)
        .fill({ color: 0xffffff, alpha: 0.34 })
        .circle(0, 0, BULLET_BASE_R)
        .fill({ color: 0xffffff, alpha: 0.98 })
        .circle(2, -2, BULLET_BASE_R * 0.35)
        .fill({ color: 0xffffff, alpha: 0.95 }) // 白圓，tint 上色 + scale 調大小
      this.fxLayer.addChild(g)
    }
    g.visible = true
    g.alpha = 1
    g.tint = style.bullet // 銅暖黃 / 銀藍 / 金赤
    g.scale.set(style.bulletR / BULLET_BASE_R) // 砲台越高子彈越大
    const { x: sx, y: sy } = this._bulletOrigin()
    g.x = sx
    g.y = sy
    g.rotation = Math.atan2(ty - sy, tx - sx)
    this.bullets.push({ g, sx, sy, tx, ty, ms: 0 })
    this._spawnMuzzle() // 砲口火光（依砲台等級的大小/顏色）
  }

  // 砲口火光：在砲口（沿 aim 方向偏移）噴一個短促放大淡出的火花，顏色/大小依砲台等級。
  _spawnMuzzle() {
    const style = this.cannonStyle
    const { x, y } = this._cannonOrigin()
    const muzzleOffset = Math.max(30, Math.min(64, this.app.screen.height * 0.105 * (style.scale || 1)))
    const mx = x + Math.sin(this.aim) * muzzleOffset
    const my = y - Math.cos(this.aim) * muzzleOffset
    this.cannonPulse = 150
    this._spawnSpark(mx, my, { color: style.bullet, startScale: style.muzzle / 18, grow: 1.25 })
    this._spawnSpark(mx + Math.sin(this.aim) * 9, my - Math.cos(this.aim) * 9, { color: 0xffffff, startScale: 0.3, grow: 0.95 })
  }

  _updateBullets(dtMs) {
    for (let i = this.bullets.length - 1; i >= 0; i -= 1) {
      const b = this.bullets[i]
      b.ms += dtMs
      const t = b.ms / BULLET_MS
      if (t >= 1) {
        b.g.visible = false
        this.bulletPool.push(b.g)
        this.bullets.splice(i, 1)
        continue
      }
      b.g.x = b.sx + (b.tx - b.sx) * t
      b.g.y = b.sy + (b.ty - b.sy) * t
      b.g.alpha = t < 0.72 ? 1 : 1 - (t - 0.72) / 0.28
    }
  }

  _spawnSpark(x, y, opts = {}) {
    const cap = this.perfMode ? 12 : 30
    if (this.sparks.length >= cap) return
    let g = this.sparkPool.pop()
    if (!g) {
      g = new Graphics()
        .circle(0, 0, SPARK_BASE_R)
        .fill({ color: 0xffffff, alpha: 0.62 })
        .circle(0, 0, SPARK_BASE_R * 0.42)
        .fill({ color: 0xffffff, alpha: 1 })
        .moveTo(-SPARK_BASE_R * 1.4, 0)
        .lineTo(SPARK_BASE_R * 1.4, 0)
        .moveTo(0, -SPARK_BASE_R * 1.4)
        .lineTo(0, SPARK_BASE_R * 1.4)
        .stroke({ color: 0xffffff, alpha: 0.5, width: 2 }) // 白圓 + tint 上色
      this.fxLayer.addChild(g)
    }
    g.visible = true
    g.x = x
    g.y = y
    g.alpha = 1
    g.tint = opts.color ?? 0xfff3c4
    const startScale = opts.startScale ?? 0.4
    g.scale.set(startScale)
    this.sparks.push({ g, ms: 0, startScale, grow: opts.grow ?? 1.4 })
  }

  _updateSparks(dtMs) {
    for (let i = this.sparks.length - 1; i >= 0; i -= 1) {
      const s = this.sparks[i]
      s.ms += dtMs
      const t = s.ms / SPARK_MS
      if (t >= 1) {
        s.g.visible = false
        this.sparkPool.push(s.g)
        this.sparks.splice(i, 1)
        continue
      }
      s.g.alpha = 1 - t
      s.g.scale.set(s.startScale + t * s.grow)
    }
  }

  _spawnFloat(x, y, payout) {
    const cap = this.perfMode ? 8 : 16
    if (this.floats.length >= cap) return
    let txt = this.floatPool.pop()
    if (!txt) {
      txt = new Text({
        text: '',
        style: { fill: 0xffe9a8, fontSize: 20, fontWeight: '900', fontFamily: 'inherit' },
      })
      txt.anchor.set(0.5)
      this.floatLayer.addChild(txt)
    }
    txt.text = `+${payout.toLocaleString()}`
    txt.visible = true
    txt.alpha = 1
    txt.x = x
    txt.y = y
    this.floats.push({ txt, x, y, ms: 0 })
  }

  _updateFloats(dtMs) {
    for (let i = this.floats.length - 1; i >= 0; i -= 1) {
      const fl = this.floats[i]
      fl.ms += dtMs
      const t = fl.ms / FLOAT_MS
      if (t >= 1) {
        fl.txt.visible = false
        this.floatPool.push(fl.txt)
        this.floats.splice(i, 1)
        continue
      }
      fl.txt.y = fl.y - t * 44
      fl.txt.alpha = 1 - t
    }
  }
  // Critical hits still show text; normal damage numbers are hidden.
  _spawnDamage(x, y, dmg, crit) {
    if (!crit) return
    const cap = this.perfMode ? 10 : 22
    if (this.dmgs.length >= cap) return
    let txt = this.dmgPool.pop()
    if (!txt) {
      txt = new Text({
        text: '',
        style: { fill: 0xffffff, fontSize: 20, fontWeight: '900', fontFamily: 'inherit' },
      })
      txt.anchor.set(0.5)
      this.floatLayer.addChild(txt)
    }
    txt.text = '\u66b4\u64ca'
    txt.tint = 0xff7a3c
    txt.visible = true
    txt.alpha = 1
    const jx = (Math.random() - 0.5) * 22
    const baseScale = 1.55
    txt.x = x + jx
    txt.y = y
    txt.scale.set(baseScale * 0.5)
    this.dmgs.push({ txt, x: x + jx, y, ms: 0, crit: true, baseScale })
  }

  _updateDamage(dtMs) {
    for (let i = this.dmgs.length - 1; i >= 0; i -= 1) {
      const d = this.dmgs[i]
      d.ms += dtMs
      const t = d.ms / DMG_FLOAT_MS
      if (t >= 1) {
        d.txt.visible = false
        this.dmgPool.push(d.txt)
        this.dmgs.splice(i, 1)
        continue
      }
      d.txt.y = d.y - t * 40
      d.txt.alpha = t < 0.65 ? 1 : 1 - (t - 0.65) / 0.35
      if (d.crit) {
        const pop = t < 0.25 ? 0.5 + (t / 0.25) * 0.5 : 1 // 前 25% 彈出放大
        d.txt.scale.set(d.baseScale * pop)
      }
    }
  }

  _showHint(text) {
    this.hint.text = text
    this.hint.visible = true
    this.hintMs = 0
  }

  _updateHint(dtMs, W, H) {
    if (!this.hint.visible) return
    this.hint.x = W / 2
    this.hint.y = this._cannonZoneTop(W, H) - 24
    this.hintMs += dtMs
    if (this.hintMs > 1400) this.hint.visible = false
  }

  destroy() {
    this._destroyed = true
    const canvas = this.app?.canvas
    if (canvas) {
      canvas.removeEventListener('pointerdown', this._onPointerDown)
      canvas.removeEventListener('pointermove', this._onPointerMove)
      canvas.removeEventListener('pointerup', this._onPointerUp)
      canvas.removeEventListener('pointercancel', this._onPointerUp)
      canvas.removeEventListener('pointerleave', this._onPointerUp)
      canvas.removeEventListener('contextmenu', this._onContextMenu)
    }
    document.removeEventListener('visibilitychange', this._onVisibility)
    try {
      this.app?.ticker?.remove(this._tick)
    } catch {
      /* ticker 可能已隨 app 銷毀 */
    }
    this.fish = []
    this.bullets = []
    this.sparks = []
    this.floats = []
    this.dmgs = []
    this.bubbles = []
    this.godRays = []
    this.plankton = []
    this.pending.clear()
    clearCache() // 下次重掛載重新烘焙紋理
  }
}
