import { useEffect, useRef } from 'react'
import { Application } from 'pixi.js'
import { FishingEngine } from './fishingEngine'

/**
 * 捕魚機 Pixi 漁場（取代舊 FishingArena 的 DOM 渲染層）。
 *
 * 對外介面與舊 FishingArena 完全相容：phase / betPerShot / fishTable / fire / play /
 * registerResults / onCatch / onMiss / onBossChange，外加 perfMode（效能模式）。
 * 玩法/契約/帳務一律不變——開火仍走 hook 的 fire(fishInstanceId, fishCode)。
 */
export default function FishingCanvas({
  phase,
  betPerShot,
  cannonLevel = 1,
  ammoTone = 'copper',
  fishTable,
  fire,
  play,
  registerResults,
  onCatch,
  onMiss,
  onBossChange,
  perfMode = false,
}) {
  const hostRef = useRef(null)
  const engineRef = useRef(null)
  const appRef = useRef(null)

  // 引擎讀 ctxRef.current.*（每 render 更新欄位，避免閉包過期）。
  const ctxRef = useRef({})
  ctxRef.current.phase = phase
  ctxRef.current.betPerShot = betPerShot
  ctxRef.current.cannonLevel = cannonLevel
  ctxRef.current.ammoTone = ammoTone
  ctxRef.current.fishTable = fishTable
  ctxRef.current.fire = fire
  ctxRef.current.play = play
  ctxRef.current.onCatch = onCatch
  ctxRef.current.onMiss = onMiss
  ctxRef.current.onBossChange = onBossChange
  ctxRef.current.perfMode = perfMode

  const registerRef = useRef(registerResults)
  registerRef.current = registerResults

  // 掛載一次：建 Pixi Application + 引擎（async；做 StrictMode 雙掛載防護）。
  useEffect(() => {
    let cancelled = false
    const host = hostRef.current
    const app = new Application()

    app
      .init({
        resizeTo: host,
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: window.devicePixelRatio || 1,
      })
      .then(async () => {
        if (cancelled) {
          app.destroy({ removeView: true }, { children: true })
          return
        }
        host.appendChild(app.canvas)
        const engine = new FishingEngine(app, ctxRef.current)
        await engine.init()
        if (cancelled) {
          engine.destroy()
          app.destroy({ removeView: true }, { children: true })
          return
        }
        engineRef.current = engine
        appRef.current = app
        // 灌入當前 props
        engine.setFishTable(ctxRef.current.fishTable)
        engine.setBet(ctxRef.current.betPerShot)
        engine.setCannon(ctxRef.current.cannonLevel)
        engine.setAmmoTone(ctxRef.current.ammoTone)
        engine.setPerfMode(ctxRef.current.perfMode)
        engine.setPhase(ctxRef.current.phase)
        registerRef.current?.(engine.handleResults)
      })

    return () => {
      cancelled = true
      registerRef.current?.(null) // 卸載前先讓 hook 停止把結果送進已銷毀的引擎
      const engine = engineRef.current
      const app = appRef.current
      if (engine) engine.destroy()
      if (app) app.destroy({ removeView: true }, { children: true })
      engineRef.current = null
      appRef.current = null
    }
  }, [])

  // props → engine 同步（引擎就緒後才推；未就緒時由 init 灌初值）。
  useEffect(() => {
    engineRef.current?.setPhase(phase)
  }, [phase])
  useEffect(() => {
    engineRef.current?.setBet(betPerShot)
  }, [betPerShot])
  useEffect(() => {
    engineRef.current?.setCannon(cannonLevel)
  }, [cannonLevel])
  useEffect(() => {
    engineRef.current?.setAmmoTone(ammoTone)
  }, [ammoTone])
  useEffect(() => {
    engineRef.current?.setFishTable(fishTable)
  }, [fishTable])
  useEffect(() => {
    engineRef.current?.setPerfMode(perfMode)
  }, [perfMode])

  return <div ref={hostRef} className="fishing-arena fishing-arena--canvas" style={{ touchAction: 'none', userSelect: 'none' }} />
}
