import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  onSpin,
  symbols = defaultSymbols,
  symbolHeight: symbolHeightProp,
}) {
  const symbolHeight = symbolHeightProp ?? (compact ? 52 : 170)
  const fallbackGrid = useMemo(() => buildFallbackGrid(symbols), [symbols])
  const [displayGrid, setDisplayGrid] = useState(grid || fallbackGrid)
  const [reelTracks, setReelTracks] = useState(() => getColumns(grid || fallbackGrid).map(buildStaticTrack))
  const [phase, setPhase] = useState('idle')
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
      await nextFrame()

      await Promise.all(
        nextTracks.map((track, colIndex) =>
          animateReel({
            trackElement: trackRefs.current[colIndex],
            symbols,
            resultSymbol: track.resultSymbol,
            symbolHeight,
            loops: reelLoops[colIndex] ?? reelLoops[0],
            duration: reelDurations[colIndex] ?? reelDurations[0],
            targetY: track.targetY,
            signal: controller.signal,
          })
        )
      )

      if (!controller.signal.aborted) {
        setPhase('idle')
      }
    },
    [symbolHeight, symbols]
  )

  const spin = async () => {
    if (visualBusy) return

    setPhase('waiting')
    try {
      const spinResult = onSpin ? await onSpin() : null
      const targetGrid =
        spinResult?.grid ||
        Array.from({ length: visibleRows }, () =>
          Array.from({ length: visibleRows }, () => symbols[Math.floor(Math.random() * symbols.length)])
        )

      await runReels(targetGrid)
    } catch {
      setPhase('idle')
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
          <strong>777,000</strong>
        </div>
      </div>

      <div
        className={[
          'slot-cabinet mt-5',
          compact ? 'slot-cabinet--compact' : '',
          visualBusy ? 'slot-cabinet--spinning' : '',
          phase === 'spinning' ? 'slot-cabinet--settling' : '',
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
            <span>LINES</span>
            <strong>03</strong>
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
          disabled={visualBusy}
          className="slot-spin-button gold-button rounded text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-60"
        >
          {visualBusy ? 'SPINNING' : 'SPIN'}
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
