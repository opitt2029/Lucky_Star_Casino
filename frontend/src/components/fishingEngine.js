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
const FIRE_INTERVAL_MS = 110 // 按住連發取樣節奏（實際射速由 hook 的 token bucket 限到 8 發/秒）
const AIM_RADIUS = 92 // 游標命中容錯半徑（px）
const TEX_PX = 256 // 紋理烘焙解析度
const BOB_AMP = 8 // 魚上下浮動幅度（px）
const BOB_SPEED = 2.2 // 浮動頻率
const CAUGHT_MS = 520 // 捕獲淡出時間
const BULLET_MS = 340 // 子彈飛行時間
const SPARK_MS = 460
const FLOAT_MS = 1000

// 漁場所有可能用到的素材 id（與 registry / 後端 FishSpecies 對齊）。
const FISH_ASSETS = [
  'fish-koi', 'fish-goldfish', 'fish-lantern', 'fish-puffer', 'fish-angelfish',
  'fish-devil-ray', 'fish-gold-dragon', 'fish-pixiu', 'fish-caishen',
  'fish-dragon-king', 'fish-money-tree',
]
const PRELOAD_ASSETS = ['cannon', 'coin', ...FISH_ASSETS]

// 依倍率/魚種推導渲染參數（搬自舊 FishingArena.deriveMeta，數值不變）。
function deriveMeta(fish) {
  const m = fish.multiplier
  if (fish.code === 'MONEY_TREE') return { tier: 'special', size: 100, weight: 0.8, durMin: 11, durMax: 14 }
  if (m <= 8) return { tier: 'small', size: 56 + m * 3, weight: 6, durMin: 7, durMax: 9.5 }
  if (m <= 25) return { tier: 'medium', size: 94, weight: 2.2, durMin: 9, durMax: 11.5 }
  return { tier: 'boss', size: 132, weight: 0.5, durMin: 12, durMax: 15.5 }
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

    // 顯示層（由下而上）：魚 → 火花/子彈 → 浮字 → 砲台 → 提示
    this.fishLayer = new Container()
    this.fxLayer = new Container()
    this.floatLayer = new Container()
    this.cannonLayer = new Container()
    this.uiLayer = new Container()
    app.stage.addChild(this.fishLayer, this.fxLayer, this.floatLayer, this.cannonLayer, this.uiLayer)

    this.tex = {} // assetId → Texture（preload 後填入）
    this.fish = []
    this.pending = new Map() // shotSeq → { fishId, code, multiplier, tier, x, y }
    this.idSeq = 0

    // 物件池
    this.bulletPool = []
    this.sparkPool = []
    this.floatPool = []
    this.bullets = []
    this.sparks = []
    this.floats = []

    // 指標連發狀態
    this.pointer = null
    this.holding = false
    this.aim = 0
    this.fireAccMs = 0
    this.spawnAccMs = 0

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

    // 砲台（錨點在底部中心，旋轉以底座為支點）
    this.cannon = new Sprite(this.tex.cannon || Texture.WHITE)
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

  get perfMode() {
    return this.ctx.perfMode || this.autoPerf || this.reducedMotion
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
      // 按住連發
      this.fireAccMs += dtMs
      if (this.holding && this.pointer && this.fireAccMs >= FIRE_INTERVAL_MS) {
        this.fireAccMs = 0
        this._fireToward(this.pointer.x, this.pointer.y)
      }
    }

    this._updateFish(dtMs, W, H)
    this._updateBullets(dtMs)
    this._updateSparks(dtMs)
    this._updateFloats(dtMs)
    this._updateHint(dtMs, W, H)
    this._notifyBoss()
  }

  _guardFps(dtMs) {
    const fps = this.app.ticker.FPS
    if (fps && fps < 40) this.lowFpsMs += dtMs
    else this.lowFpsMs = Math.max(0, this.lowFpsMs - dtMs)
    if (this.lowFpsMs > 2000) this.autoPerf = true // 連續低幀 → 自動降載（不再回升，避免抖動）
  }

  _trySpawn(W, H) {
    if (!this.table || this.table.length === 0) return
    if (this.fish.length >= this.maxFish) return
    const pick = weightedPick(this.table)
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

    this.fish.push({
      id: (this.idSeq += 1),
      code: pick.code,
      name: pick.name,
      multiplier: pick.multiplier,
      tier: meta.tier,
      sprite,
      dir,
      baseScale,
      vx: dir === 'ltr' ? speed : -speed,
      x: sprite.x,
      y: baseY,
      baseY,
      margin,
      bob: Math.random() * Math.PI * 2,
      caught: false,
      caughtMs: 0,
    })
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
        if (k >= 1) this._removeFishAt(i)
        continue
      }
      f.x += f.vx * dtMs
      f.bob += BOB_SPEED * dt
      f.y = f.baseY + (this.perfMode ? 0 : Math.sin(f.bob) * BOB_AMP)
      f.sprite.x = f.x
      f.sprite.y = f.y
      // 游出畫面回收
      if (f.x < -f.margin - 4 || f.x > W + f.margin + 4) this._removeFishAt(i)
    }
  }

  _removeFishAt(i) {
    const f = this.fish[i]
    this.fish.splice(i, 1)
    f.sprite.destroy()
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
      if (f.caught) continue
      const dist = Math.hypot(f.x - px, f.y - py)
      if (dist <= bestDist) {
        bestDist = dist
        best = f
      }
    }
    return best
  }

  // 對指定魚開一發；回傳 'fired' | 'ratelimited' | 'insufficient' | 'inactive'
  _engageFish(f) {
    if (this.ctx.phase !== 'playing' || f.caught) return 'inactive'
    this.aim = this._aimFor(f.x, f.y)
    if (f.tier === 'boss' || f.tier === 'special') this.ctx.play?.('lockOn')

    const res = this.ctx.fire?.(String(f.id), f.code)
    if (!res || !res.ok) {
      if (res?.reason === 'insufficient') this._showHint('局內餘額不足，請結算後再加值')
      return res?.reason || 'inactive'
    }
    this.ctx.play?.('shoot', { pitch: 1 + Math.random() * 0.1 })
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

  // 朝游標方向開火：瞄到魚就實際開火（扣注）；空海域/限流只放純視覺曳光，不扣注。
  _fireToward(px, py) {
    if (this.ctx.phase !== 'playing') return
    this.aim = this._aimFor(px, py)
    const f = this._nearestFish(px, py)
    if (!f || this._engageFish(f) === 'ratelimited') {
      this.ctx.play?.('shoot', { pitch: 1 + Math.random() * 0.1 })
      this._spawnBullet(px, py)
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
      if (r.captured && r.payout > 0) {
        // 致命一擊 + 捕獲：派彩演出
        const effMult = Math.max(1, Math.round(r.payout / bet))
        this.ctx.play?.('hit')
        this.ctx.play?.('net')
        this.ctx.play?.('fishCaught')
        this._spawnSpark(pending.x, pending.y)
        this._spawnFloat(pending.x, pending.y, r.payout)
        const f = this.fish.find((x) => x.id === pending.fishId)
        if (f) {
          f.caught = true
          f.caughtMs = 0
        }
        this.ctx.onCatch?.({ payout: r.payout, multiplier: pending.multiplier, effMult, tier: pending.tier })
      } else if (r.killed) {
        // 致命一擊但掙脫逃跑
        if (pending.multiplier >= 15) this.ctx.play?.('fishEscape')
        this._removeFishById(pending.fishId)
        this.ctx.onMiss?.({ multiplier: pending.multiplier })
      } else {
        // 命中但未死（擦傷）：火花回饋
        this.ctx.play?.('hit')
        this._spawnSpark(pending.x, pending.y)
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
    let g = this.bulletPool.pop()
    if (!g) {
      g = new Graphics().circle(0, 0, 4).fill({ color: 0xffe08a })
      this.fxLayer.addChild(g)
    }
    g.visible = true
    g.alpha = 1
    const sx = this.app.screen.width / 2
    const sy = this.app.screen.height - 54
    g.x = sx
    g.y = sy
    this.bullets.push({ g, sx, sy, tx, ty, ms: 0 })
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

  _spawnSpark(x, y) {
    const cap = this.perfMode ? 12 : 30
    if (this.sparks.length >= cap) return
    let g = this.sparkPool.pop()
    if (!g) {
      g = new Graphics().circle(0, 0, 10).fill({ color: 0xfff3c4 })
      this.fxLayer.addChild(g)
    }
    g.visible = true
    g.x = x
    g.y = y
    g.alpha = 1
    g.scale.set(0.4)
    this.sparks.push({ g, ms: 0 })
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
      s.g.scale.set(0.4 + t * 1.4)
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
    this.pending.clear()
    clearCache() // 下次重掛載重新烘焙紋理
  }
}
