import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { soundEngine } from '../casino-fx/sound/SoundEngine'
import CountUp from '../casino-fx/fx/CountUp'
import Reel, {
  animateReel,
  buildReelTrack,
  buildStaticTrack,
  nextFrame,
  paylineRow,
  preloadSymbolImages,
  sameSymbol,
  visibleRows,
} from './Reel'
import './slotMachine.css'

const defaultSymbols = ['🍒', '🍋', '🔔', '⭐', '7️⃣']
const reelDurations = [1800, 2200, 2600]
const reelLoops = [5, 6, 7]
// near-miss（前兩輪中線同符號）時第三輪額外慢停時間：anticipation 演出的核心。
const anticipationExtraMs = 900

function getResponsiveSymbolHeight(compact) {
  if (compact) return 52
  if (typeof window === 'undefined') return 170
  if (window.matchMedia('(max-width: 480px)').matches) return 96
  if (window.matchMedia('(max-width: 768px)').matches) return 128
  return 170
}

function getColumns(grid) {
  return [0, 1, 2].map((colIndex) => grid.map((row) => row[colIndex]))
}

function buildFallbackGrid(symbols) {
  return Array.from({ length: visibleRows }, (_, rowIndex) =>
    Array.from({ length: visibleRows }, (_, colIndex) => symbols[(rowIndex + colIndex) % symbols.length])
  )
}

function sameGrid(left, right) {
  if (!left || !right || left.length !== right.length) return false

  return left.every((row, rowIndex) => {
    const otherRow = right[rowIndex]
    return otherRow?.length === row.length && row.every((symbol, colIndex) => sameSymbol(symbol, otherRow[colIndex]))
  })
}

export default function SlotMachine({
  compact = false,
  grid,
  winningCells = [],
  spinning: externalSpinning = false,
  canSpin = true,
  onSpin,
  onSettled,
  onSpinComplete,
  symbols = defaultSymbols,
  symbolHeight: symbolHeightProp,
}) {
  const [responsiveSymbolHeight, setResponsiveSymbolHeight] = useState(() =>
    getResponsiveSymbolHeight(compact)
  )
  const symbolHeight = symbolHeightProp ?? responsiveSymbolHeight
  const fallbackGrid = useMemo(() => buildFallbackGrid(symbols), [symbols])
  const [displayGrid, setDisplayGrid] = useState(grid || fallbackGrid)
  const [reelTracks, setReelTracks] = useState(() => getColumns(grid || fallbackGrid).map(buildStaticTrack))
  const [phase, setPhase] = useState('idle')
  const [anticipating, setAnticipating] = useState(false)
  // Jackpot 氛圍數字：緩慢滾動營造「獎池一直在長大」的期待感（純展示）。
  const [jackpot, setJackpot] = useState(777000)
  const trackRefs = useRef([])
  const abortRef = useRef(null)
  const handledGridRef = useRef(grid || fallbackGrid)

  const displayColumns = useMemo(() => getColumns(displayGrid), [displayGrid])
  const winningCellSet = useMemo(() => new Set(winningCells.map(([row, col]) => `${row}-${col}`)), [winningCells])
  const visualBusy = phase !== 'idle' || externalSpinning
  const hasWin = winningCells.length > 0

  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  // 轉動中播放轉輪 tick（隨時間遞減頻率，模擬機械減速）。
  useEffect(() => {
    if (phase !== 'spinning') return undefined
    let elapsed = 0
    const timer = window.setInterval(() => {
      elapsed += 90
      const slowdown = Math.min(elapsed / 2600, 1)
      if (Math.random() > slowdown * 0.7) {
        soundEngine.play('reelTick', { volume: 0.5 - slowdown * 0.3, pitch: 1 - slowdown * 0.2 })
      }
    }, 90)
    return () => window.clearInterval(timer)
  }, [phase])

  // anticipation：第三輪慢停時的心跳鼓點。
  useEffect(() => {
    if (!anticipating) return undefined
    soundEngine.play('heartbeat')
    const timer = window.setInterval(() => soundEngine.play('heartbeat'), 640)
    return () => window.clearInterval(timer)
  }, [anticipating])

  // Jackpot 氛圍滾動：每 2.4 秒微幅成長。
  useEffect(() => {
    const timer = window.setInterval(() => {
      setJackpot((value) => value + 17 + Math.floor(Math.random() * 120))
    }, 2400)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (symbolHeightProp) return undefined

    const handleResize = () => {
      setResponsiveSymbolHeight(getResponsiveSymbolHeight(compact))
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [compact, symbolHeightProp])

  useEffect(() => {
    if (phase !== 'idle' || !grid || sameGrid(grid, handledGridRef.current)) return

    handledGridRef.current = grid
    setDisplayGrid(grid)
    setReelTracks(getColumns(grid).map(buildStaticTrack))
  }, [grid, phase])

  const runReels = useCallback(
    async (targetGrid) => {
      abortRef.current?.abort()
      const controller = new window.AbortController()
      abortRef.current = controller

      const targetColumns = getColumns(targetGrid)
      // near-miss 偵測：前兩輪中線同符號 → 第三輪進入 anticipation 慢停演出。
      // 結果早已由後端 Provably Fair 決定，這裡只是把「差點贏」的張力放大（表現層）。
      const paylineSymbols = targetColumns.map((column) => column[paylineRow])
      const isNearMiss = sameSymbol(paylineSymbols[0], paylineSymbols[1])

      const nextTracks = targetColumns.map((column, colIndex) =>
        buildReelTrack({
          symbols,
          resultSymbol: column[paylineRow],
          resultWindow: column,
          symbolHeight,
          loops: reelLoops[colIndex] ?? reelLoops[0],
          reelIndex: colIndex,
        })
      )

      await preloadSymbolImages([...symbols, ...targetGrid.flat()])
      handledGridRef.current = targetGrid
      setDisplayGrid(targetGrid)
      setReelTracks(nextTracks)
      setPhase('spinning')
      soundEngine.play('leverPull')
      await nextFrame()
      // 首局或 re-render 競態時 ref 可能尚未掛上；多等一幀，避免 animateReel 因 trackElement 為 null 靜默跳過動畫。
      if (trackRefs.current.some((node) => !node)) {
        await nextFrame()
      }

      await Promise.all(
        nextTracks.map((track, colIndex) => {
          const isLastReel = colIndex === nextTracks.length - 1
          const duration =
            (reelDurations[colIndex] ?? reelDurations[0]) + (isNearMiss && isLastReel ? anticipationExtraMs : 0)

          if (isNearMiss && isLastReel) {
            // 前兩輪停定後才點亮 anticipation（紅光 + 心跳）。
            window.setTimeout(() => {
              if (!controller.signal.aborted) setAnticipating(true)
            }, reelDurations[1])
          }

          return animateReel({
            trackElement: trackRefs.current[colIndex],
            symbols,
            resultSymbol: track.resultSymbol,
            symbolHeight,
            loops: reelLoops[colIndex] ?? reelLoops[0],
            duration,
            targetY: track.targetY,
            signal: controller.signal,
          }).then((completed) => {
            if (completed) {
              soundEngine.play('reelStop', { pitch: 1 + colIndex * 0.08 })
            }
            return completed
          })
        })
      )

      setAnticipating(false)

      if (!controller.signal.aborted) {
        // 註：本作賠付表所有符號 pairMultiplier ≥ 1，「前兩格同、第三格不同」恆為會派彩的左二同小獎，
        // 故不在此播惋惜/逃跑音——那會與隨後 handleSettled 的中獎音衝突（贏錢卻播輸錢音）。
        // 第三輪 anticipation 慢停＋心跳已提供「能否升級三連」的張力，落定後交由中獎音收尾。
        setPhase('idle')
      }
    },
    [symbolHeight, symbols]
  )

  const spin = async () => {
    if (visualBusy || !canSpin) return

    // 在使用者手勢同步上下文內解鎖音訊，讓首局就有拉霸/轉輪/停輪音效。
    soundEngine.ensureContext()

    setPhase('waiting')
    try {
      const spinResult = onSpin ? await onSpin() : null
      const targetGrid =
        spinResult?.grid ||
        Array.from({ length: visibleRows }, () =>
          Array.from({ length: visibleRows }, () => symbols[Math.floor(Math.random() * symbols.length)])
        )

      await runReels(targetGrid)
      // 轉輪演出全部結束後才通知外層結算（慶祝特效在輪停的瞬間爆發才有衝擊力）。
      onSettled?.(spinResult)
    } catch {
      setAnticipating(false)
      setPhase('idle')
    } finally {
      // 無論成功、失敗或下注被擋，都通知外層解除視覺鎖。
      onSpinComplete?.()
    }
  }

  return (
    <section
      className={['slot-machine luxury-panel rounded p-4 sm:p-5', compact ? 'slot-machine--compact' : ''].join(' ')}
      style={{ '--slot-symbol-height': `${symbolHeight}px` }}
    >
      <div className="slot-machine__marquee" aria-hidden="true">
        {Array.from({ length: 22 }, (_, index) => (
          <span key={index} className="slot-machine__bulb" style={{ animationDelay: `${index * 70}ms` }} />
        ))}
      </div>

      <div className="slot-machine__topper">
        <div>
          <p className="slot-machine__eyebrow">Lucky Star Deluxe</p>
          <h2 className="slot-machine__title">星幣老虎機</h2>
        </div>
        <div className="slot-machine__jackpot" aria-label="Jackpot">
          <span>GRAND</span>
          <strong>
            <CountUp value={jackpot} duration={2000} />
          </strong>
        </div>
      </div>

      <div
        className={[
          'slot-cabinet mt-5',
          compact ? 'slot-cabinet--compact' : '',
          visualBusy ? 'slot-cabinet--spinning' : '',
          phase === 'spinning' ? 'slot-cabinet--settling' : '',
          anticipating ? 'slot-cabinet--anticipation' : '',
          hasWin && !visualBusy ? 'slot-cabinet--win' : '',
        ].join(' ')}
      >
        <div className="slot-payline" aria-hidden="true" />
        <div className="slot-reels" aria-live="polite">
          {displayColumns.map((column, colIndex) => (
            <Reel
              key={`reel-${colIndex}`}
              reelIndex={colIndex}
              track={reelTracks[colIndex] || buildStaticTrack(column)}
              compact={compact}
              isSpinning={phase === 'spinning'}
              winningRows={[0, 1, 2].filter((rowIndex) => winningCellSet.has(`${rowIndex}-${colIndex}`))}
              trackRef={(node) => {
                trackRefs.current[colIndex] = node
              }}
              symbolHeight={symbolHeight}
            />
          ))}
        </div>
        <div className="slot-machine__glass" aria-hidden="true" />
      </div>

      <div className="slot-console">
        <div className="slot-console__meters" aria-label="Slot machine control display">
          <div>
            <span>LINE</span>
            <strong>01</strong>
          </div>
          <div>
            <span>BET</span>
            <strong>MAX 5K</strong>
          </div>
          <div>
            <span>WIN</span>
            <strong>{hasWin && !visualBusy ? 'PAID' : 'READY'}</strong>
          </div>
        </div>
        <button
          type="button"
          onClick={spin}
          disabled={visualBusy || !canSpin}
          className="slot-spin-button gold-button rounded text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-60"
        >
          {visualBusy ? 'SPINNING' : !canSpin ? '星幣不足' : 'SPIN'}
        </button>
        <div className={['slot-lever', visualBusy ? 'slot-lever--active' : ''].join(' ')} aria-hidden="true">
          <span />
        </div>
      </div>

      <div
        className={[
          'slot-status mt-4 rounded border p-3',
          visualBusy
            ? 'slot-status--active border-yellow-200 bg-yellow-200 text-red-950'
            : hasWin
              ? 'border-yellow-200/70 bg-yellow-200/10 text-yellow-100'
              : 'border-yellow-200/15 bg-red-950/70 text-yellow-100/62',
        ].join(' ')}
      >
        <p className="text-sm font-bold">
          {phase === 'waiting'
            ? '正在確認下注與派彩結果...'
            : visualBusy
              ? '轉輪由左至右自然減速中...'
              : hasWin
                ? '中線命中，派彩已回填。'
                : 'Ready: 選擇下注金額後開始本局。'}
        </p>
      </div>
    </section>
  )
}
