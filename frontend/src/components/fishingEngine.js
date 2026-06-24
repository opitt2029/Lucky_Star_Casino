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
const SWARM_INTERVAL_MS = 36000 // 魚群潮週期（短時間密集放小魚，LDW 小額回收手感）
const SWARM_SIZE = 6 // 每波魚群潮的小魚數
const SWARM_SPAWN_MS = 240 // 魚群潮期間每尾間隔
const BOSS_INTERVAL_MS = 58000 // Boss（龍王）定時降臨週期（場上無 boss 時才放，保證事件節奏）
const FIRE_INTERVAL_MS = 110 // 按住連發取樣節奏（實際射速由 hook 的 token bucket 限到 8 發/秒）
const AIM_RADIUS = 92 // 游標命中容錯半徑（px）
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
const HP_YELLOW = 0xf0cf4c
const HP_RED = 0xef5a4c

// 漁場所有可能用到的素材 id（與 registry / 後端 FishSpecies 對齊）。
const FISH_ASSETS = [
  'fish-koi', 'fish-goldfish', 'fish-lantern', 'fish-puffer', 'fish-angelfish',
  'fish-devil-ray', 'fish-gold-dragon', 'fish-pixiu', 'fish-caishen',
  'fish-dragon-king', 'fish-money-tree',
]
// 砲台等級差異化：貼圖 / 子彈顏色 / 子彈半徑 / 射擊音調 / 砲口火光大小（idx0 不用，對齊 cannonLevel 1~3）。
// 傷害差異在後端（FishingCombat.CANNON_DAMAGE 銅10/銀17/金26）；此處只管「手感與表現」，不影響 RTP。
const CANNON_STYLE = [
  null,
  { asset: 'cannon-copper', bullet: 0xffd98a, bulletR: 4, pitch: 0.9, muzzle: 13 }, // 銅炮 L1：小、暖黃、低沉
  { asset: 'cannon-silver', bullet: 0xcfe4ff, bulletR: 5, pitch: 1.06, muzzle: 17 }, // 銀炮 L2：中、銀藍
  { asset: 'cannon', bullet: 0xffd24a, bulletR: 6.5, pitch: 1.2, muzzle: 23 }, // 金炮 L3：大、金赤、高亢
]
const BULLET_BASE_R = 5 // 子彈基準半徑（白圓，實際大小由 cannonStyle.bulletR 以 scale 調整）
const SPARK_BASE_R = 10 // 火花基準半徑
const PRELOAD_ASSETS = ['cannon', 'cannon-copper', 'cannon-silver', 'coin', ...FISH_ASSETS]

// 各 tier 的渲染基準：體型 / 游速（duration 越大游越慢）/ 辨識光暈強度。
// 體型↔倍率↔HP 正相關、游速↔倍率負相關（大魚慢、好瞄但耐打）、高倍魚加光暈強化辨識（計畫 §5.1）。
const TIER_RENDER = {
  SMALL: { size: 62, durMin: 7, durMax: 9.5, glow: 0 },
  MEDIUM: { size: 96, durMin: 9, durMax: 12, glow: 0 },
  HIGH: { size: 122, durMin: 11.5, durMax: 14.5, glow: 1 },
  BOSS: { size: 154, durMin: 13.5, durMax: 17, glow: 1.5 },
  SPECIAL: { size: 106, durMin: 11, durMax: 14, glow: 1 },
}

// 依後端魚種資料（tier/spawnWeight/multiplier）推導渲染參數。
// 單一真相＝後端：tier 與 spawnWeight 直接採後端值（修正舊版用 multiplier 自行分級，把 HIGH 誤當 boss）。
function deriveMeta(fish) {
  const tierKey = (fish.tier || 'SMALL').toUpperCase()
  const base = TIER_RENDER[tierKey] || TIER_RENDER.SMALL
  // 小魚同 tier 內依倍率微調體型（錦鯉<金魚<燈籠魚），讓辨識更連續
  const sizeAdj = tierKey === 'SMALL' ? (fish.multiplier || 2) * 1.6 : 0
  return {
    tier: tierKey.toLowerCase(),
    size: base.size + sizeAdj,
    weight: fish.spawnWeight || 1,
    durMin: base.durMin,
    durMax: base.durMax,
    glow: base.glow,
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
    this.glowLayer = new Container() // 高倍魚光暈（在魚下方）
    this.fishLayer = new Container()
    this.fxLayer = new Container()
    this.hpLayer = new Container()
    this.floatLayer = new Container()
    this.cannonLayer = new Container()
    this.uiLayer = new Container()
    app.stage.addChild(
      this.glowLayer,
      this.fishLayer,
      this.fxLayer,
      this.hpLayer,
      this.floatLayer,
      this.cannonLayer,
      this.uiLayer,
    )

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

    // 指標連發狀態
    this.pointer = null
    this.holding = false
    this.aim = 0
    this.fireAccMs = 0
    this.spawnAccMs = 0

    // 事件編排：魚群潮（密集小魚）、Boss 定時降臨
    this.swarmTimerMs = 0
    this.swarmRemaining = 0
    this.swarmAccMs = 0
    this.bossTimerMs = 0

    // 自動射擊（auto-fire）：開啟後自動鎖定畫面內最高價值魚連發（手動按住時讓位給手動）
    this.autoFire = false
    this.autoTarget = null
    this.autoFireAccMs = 0

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

    // 砲台（錨點在底部中心，旋轉以底座為支點）；貼圖依砲台等級（銅/銀/金）
    this.cannon = new Sprite(this.tex[this.cannonStyle.asset] || this.tex.cannon || Texture.WHITE)
    this.cannon.anchor.set(0.5, 0.92)
    this.cannon.width = 96
    this.cannon.height = 96
    this.cannonLayer.addChild(this.cannon)

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
  }

  setPerfMode(on) {
    this.ctx.perfMode = on
  }

  setCannon(level) {
    this.ctx.cannonLevel = level
    // init 後才有 cannon sprite；場中切等級或初值灌入時換貼圖
    if (this.cannon && this.tex) {
      const tex = this.tex[this.cannonStyle.asset]
      if (tex) this.cannon.texture = tex
    }
  }

  setAutoFire(on) {
    this.autoFire = on
    if (!on) {
      this.autoTarget = null
      this.autoFireAccMs = 0
    }
  }

  get perfMode() {
    return this.ctx.perfMode || this.autoPerf || this.reducedMotion
  }

  get cannonStyle() {
    return CANNON_STYLE[this.ctx.cannonLevel] || CANNON_STYLE[1]
  }

  get maxFish() {
    return this.perfMode ? MAX_FISH_PERF : MAX_FISH
  }

  // ---- 遊戲迴圈 ----
  _tick(ticker) {
    if (this._destroyed) return
    const dtMs = ticker.deltaMS
    const W = this.app.screen.width
    const H = this.app.screen.height

    // 砲台貼底置中
    this.cannon.x = W / 2
    this.cannon.y = H - 8
    this.cannon.rotation = this.aim

    this._guardFps(dtMs)

    // 生成（只在 playing）
    if (this.ctx.phase === 'playing') {
      this.spawnAccMs += dtMs
      if (this.spawnAccMs >= SPAWN_INTERVAL_MS) {
        this.spawnAccMs = 0
        this._trySpawn(W, H)
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
      // 自動射擊（手動按住時讓位給手動）
      if (this.autoFire && !this.holding) {
        this.autoFireAccMs += dtMs
        if (this.autoFireAccMs >= FIRE_INTERVAL_MS) {
          this.autoFireAccMs = 0
          this._autoFireOnce()
        }
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

  _guardFps(dtMs) {
    const fps = this.app.ticker.FPS
    if (fps && fps < 40) this.lowFpsMs += dtMs
    else this.lowFpsMs = Math.max(0, this.lowFpsMs - dtMs)
    if (this.lowFpsMs > 2000) this.autoPerf = true // 連續低幀 → 自動降載（不再回升，避免抖動）
  }

  _trySpawn(W, H, opts = {}) {
    if (!this.table || this.table.length === 0) return
    const hardCap = this.maxFish + (opts.boss ? 2 : 0) // Boss 保證降臨，可略超並存上限
    if (this.fish.length >= hardCap) return
    let pick
    if (opts.code) {
      pick = this.table.find((f) => f.code === opts.code)
    } else if (opts.smallOnly) {
      const smalls = this.table.filter((f) => f._meta.tier === 'small')
      pick = smalls.length ? weightedPick(smalls) : weightedPick(this.table)
    } else {
      pick = weightedPick(this.table)
    }
    if (!pick) return
    const meta = pick._meta
    const dir = Math.random() > 0.5 ? 'ltr' : 'rtl'
    const size = meta.size
    const margin = size
    const baseScale = size / TEX_PX
    const speed = (W + margin * 2) / (meta.durMin + Math.random() * (meta.durMax - meta.durMin)) / 1000
    const baseY = H * (0.08 + Math.random() * 0.6)

    if (meta.tier === 'boss') this.ctx.play?.('bossAlarm')

    const sprite = new Sprite(this.tex[pick.assetId] || Texture.WHITE)
    sprite.anchor.set(0.5)
    sprite.scale.set(dir === 'ltr' ? -baseScale : baseScale, baseScale) // 朝向翻面
    sprite.x = dir === 'ltr' ? -margin : W + margin
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
      vx: dir === 'ltr' ? speed : -speed,
      x: sprite.x,
      y: baseY,
      baseY,
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

  // Boss（龍王）定時降臨：場上無 boss 時強制 spawn boss tier 魚種，_trySpawn 內對 boss 觸發 bossAlarm 預警。
  _spawnBoss(W, H) {
    if (!this.table) return
    if (this.fish.some((f) => !f.caught && !f.fleeing && f.tier === 'boss')) return
    const boss = this.table.find((f) => f._meta.tier === 'boss')
    if (!boss) return
    this._trySpawn(W, H, { code: boss.code, boss: true })
  }

  _updateFish(dtMs, W) {
    const dt = dtMs / 1000
    for (let i = this.fish.length - 1; i >= 0; i -= 1) {
      const f = this.fish[i]
      if (f.caught) {
        f.caughtMs += dtMs
        const k = Math.min(1, f.caughtMs / CAUGHT_MS)
        f.sprite.alpha = 1 - k
        const s = f.baseScale * (1 + k * 0.35)
        f.sprite.scale.set(f.dir === 'ltr' ? -s : s, s)
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
      f.bob += BOB_SPEED * dt
      f.y = f.baseY + (this.perfMode ? 0 : Math.sin(f.bob) * BOB_AMP)
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
      if (f.x < -f.margin - 4 || f.x > W + f.margin + 4) this._removeFishAt(i)
    }
  }

  // HP 條跟隨魚移動；命中後全亮顯示，計時結束後若魚仍有傷害則以半透明保持可見。
  // 無傷害時才完全隱藏（讓玩家清楚看到累積傷害，尤其大魚需多發子彈時）。
  _updateHpBar(f, dtMs) {
    const bar = f.hpBar
    if (!bar) return
    const hasDamage = f.hp < f.maxHp
    if (f.hpShownMs <= 0 && !hasDamage) {
      if (bar.visible) bar.visible = false
      return
    }
    if (f.hpShownMs > 0) f.hpShownMs -= dtMs
    bar.visible = true
    bar.x = f.x
    bar.y = f.y - f.dispSize / 2 - 9
    const ratio = Math.max(0, Math.min(1, f.hp / f.maxHp))
    f.hpFill.scale.x = ratio
    f.hpFill.tint = ratio > 0.5 ? HP_GREEN : ratio > 0.25 ? HP_YELLOW : HP_RED
    // 命中 2.6s 內全亮；之後若有傷害則保持半透明（讓玩家看到累積傷害）
    bar.alpha = f.hpShownMs > 360 ? 1 : hasDamage ? 0.55 : f.hpShownMs / 360
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
    const W = this.app.screen.width
    const H = this.app.screen.height
    // 0 = 朝正上方，順時針為正（與砲台 anchor 底座支點一致）
    return Math.atan2(px - W / 2, H - py)
  }

  _nearestFish(px, py) {
    let best = null
    let bestDist = AIM_RADIUS
    for (const f of this.fish) {
      if (f.caught || f.fleeing) continue
      const dist = Math.hypot(f.x - px, f.y - py)
      if (dist <= bestDist) {
        bestDist = dist
        best = f
      }
    }
    return best
  }

  // 自動射擊選靶：畫面內未死魚中，價值（倍率）最高者優先，平手取離砲台近的。
  _bestTarget() {
    const W = this.app.screen.width
    let best = null
    let bestScore = -Infinity
    for (const f of this.fish) {
      if (f.caught || f.fleeing) continue
      if (f.x < 0 || f.x > W) continue
      const score = f.multiplier * 1000 - Math.abs(f.x - W / 2)
      if (score > bestScore) {
        bestScore = score
        best = f
      }
    }
    return best
  }

  _autoFireOnce() {
    const target = this._bestTarget()
    this.autoTarget = target
    if (target) this._engageFish(target)
  }

  // 準心跟隨：自動射擊鎖定目標優先（轉橘紅），否則跟游標。
  _updateReticle() {
    if (!this.reticle) return
    if (this.ctx.phase !== 'playing') {
      this.reticle.visible = false
      return
    }
    const locked = this.autoFire && this.autoTarget && !this.autoTarget.caught && !this.autoTarget.fleeing
    const t = locked ? this.autoTarget : this.pointer
    if (!t) {
      this.reticle.visible = false
      return
    }
    this.reticle.visible = true
    this.reticle.x = t.x
    this.reticle.y = t.y
    this.reticle.tint = locked ? 0xff8a5a : 0xffffff
  }

  // 對指定魚開一發；回傳 'fired' | 'ratelimited' | 'insufficient' | 'inactive'
  _engageFish(f) {
    if (this.ctx.phase !== 'playing' || f.caught) return 'inactive'
    this.aim = this._aimFor(f.x, f.y)
    if (f.tier === 'boss' || f.tier === 'high' || f.tier === 'special') this.ctx.play?.('lockOn')

    const res = this.ctx.fire?.(String(f.id), f.code)
    if (!res || !res.ok) {
      if (res?.reason === 'insufficient') this._showHint('局內餘額不足，請結算後再加值')
      return res?.reason || 'inactive'
    }
    this.ctx.play?.('shoot', { pitch: this.cannonStyle.pitch + Math.random() * 0.08 })
    this._spawnBullet(f.x, f.y)
    this.pending.set(res.shotSeq, {
      fishId: f.id,
      code: f.code,
      multiplier: f.multiplier,
      tier: f.tier,
      x: f.x,
      y: f.y,
    })
    return 'fired'
  }

  // 朝游標方向開火：瞄到魚就實際開火（扣注）；空海域才放純視覺曳光，不扣注。
  // 限流時不生成視覺子彈，避免玩家誤以為大量子彈有效果（實際上未扣注、未傷魚）。
  _fireToward(px, py) {
    if (this.ctx.phase !== 'playing') return
    this.aim = this._aimFor(px, py)
    const f = this._nearestFish(px, py)
    if (!f) {
      // 空海域：純視覺曳光
      this.ctx.play?.('shoot', { pitch: this.cannonStyle.pitch + Math.random() * 0.08 })
      this._spawnBullet(px, py)
    } else {
      // 有魚：嘗試開火；成功時 _engageFish 內部已呼叫 _spawnBullet；限流時靜默不生成子彈
      this._engageFish(f)
    }
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
      // 浮動傷害數字（命中即冒，不論死活；暴擊橘紅放大）
      if (r.damage > 0) this._spawnDamage(px, py, r.damage, !!r.crit)
      // HP 條：以伺服器權威 hpRemaining 更新並顯示一段時間
      if (f && typeof r.hpRemaining === 'number') {
        f.hp = Math.max(0, r.hpRemaining)
        f.hpShownMs = HP_SHOW_MS
      }

      if (r.captured && r.payout > 0) {
        // 致命一擊 + 捕獲：派彩演出
        const effMult = Math.max(1, Math.round(r.payout / bet))
        this.ctx.play?.('net')
        this.ctx.play?.('fishCaught')
        this._spawnSpark(px, py)
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
      g = new Graphics().circle(0, 0, BULLET_BASE_R).fill({ color: 0xffffff }) // 白圓，tint 上色 + scale 調大小
      this.fxLayer.addChild(g)
    }
    g.visible = true
    g.alpha = 1
    g.tint = style.bullet // 銅暖黃 / 銀藍 / 金赤
    g.scale.set(style.bulletR / BULLET_BASE_R) // 砲台越高子彈越大
    const sx = this.app.screen.width / 2
    const sy = this.app.screen.height - 54
    g.x = sx
    g.y = sy
    this.bullets.push({ g, sx, sy, tx, ty, ms: 0 })
    this._spawnMuzzle() // 砲口火光（依砲台等級的大小/顏色）
  }

  // 砲口火光：在砲口（沿 aim 方向偏移）噴一個短促放大淡出的火花，顏色/大小依砲台等級。
  _spawnMuzzle() {
    const W = this.app.screen.width
    const H = this.app.screen.height
    const style = this.cannonStyle
    const mx = W / 2 + Math.sin(this.aim) * 44
    const my = H - 54 - Math.cos(this.aim) * 44
    this._spawnSpark(mx, my, { color: style.bullet, startScale: style.muzzle / 22, grow: 0.8 })
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
    }
  }

  _spawnSpark(x, y, opts = {}) {
    const cap = this.perfMode ? 12 : 30
    if (this.sparks.length >= cap) return
    let g = this.sparkPool.pop()
    if (!g) {
      g = new Graphics().circle(0, 0, SPARK_BASE_R).fill({ color: 0xffffff }) // 白圓 + tint 上色
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

  // 浮動傷害數字：一般白字、暴擊橘紅放大 + 「暴擊!」。用 tint 上色（避免改 style.fill 重繪），scale 區分大小。
  _spawnDamage(x, y, dmg, crit) {
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
    txt.text = crit ? `${dmg.toLocaleString()} 暴擊!` : `-${dmg.toLocaleString()}`
    txt.tint = crit ? 0xff7a3c : 0xfff0d8
    txt.visible = true
    txt.alpha = 1
    const jx = (Math.random() - 0.5) * 22
    const baseScale = crit ? 1.55 : 1
    txt.x = x + jx
    txt.y = y
    txt.scale.set(crit ? baseScale * 0.5 : baseScale) // 暴擊從小彈出
    this.dmgs.push({ txt, x: x + jx, y, ms: 0, crit, baseScale })
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
    this.hint.y = H - 90
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
    this.autoTarget = null
    this.pending.clear()
    clearCache() // 下次重掛載重新烘焙紋理
  }
}
