export const visibleRows = 3
export const paylineRow = 1

const symbolMeta = {
  '🍒': { label: '🍒', caption: 'Cherry', tone: 'slot-symbol-seven' },
  '🍋': { label: '🍋', caption: 'Lemon', tone: 'slot-symbol-card' },
  '🔔': { label: '🔔', caption: 'Bell', tone: 'slot-symbol-bar' },
  '⭐': { label: '⭐', caption: 'Star', tone: 'slot-symbol-star' },
  '7️⃣': { label: '7️⃣', caption: 'Lucky', tone: 'slot-symbol-seven' },
  '7': { label: '7', caption: 'Lucky', tone: 'slot-symbol-seven' },
  BAR: { label: 'BAR', caption: 'Triple', tone: 'slot-symbol-bar' },
  STAR: { label: 'STAR', caption: 'Bonus', tone: 'slot-symbol-star' },
  CHIP: { label: 'CHIP', caption: 'Credit', tone: 'slot-symbol-chip' },
  A: { label: 'A', caption: 'Ace', tone: 'slot-symbol-card' },
  K: { label: 'K', caption: 'King', tone: 'slot-symbol-card' },
}

export function easeOutCubic(progress) {
  return 1 - Math.pow(1 - progress, 3)
}

export function symbolKey(symbol) {
  return typeof symbol === 'string' ? symbol : (symbol?.id ?? symbol?.label ?? symbol?.src ?? JSON.stringify(symbol))
}

export function getSymbolImageSrc(symbol) {
  return typeof symbol === 'object' && symbol !== null ? symbol.src || symbol.image || symbol.imageUrl : null
}

export function sameSymbol(left, right) {
  return symbolKey(left) === symbolKey(right)
}

function createResultWindow({ symbols, resultSymbol, resultWindow, stopRow = paylineRow }) {
  const resultIndex = Math.max(
    symbols.findIndex((symbol) => sameSymbol(symbol, resultSymbol)),
    0
  )
  const windowSymbols =
    resultWindow?.length >= visibleRows
      ? resultWindow.slice(0, visibleRows)
      : Array.from({ length: visibleRows }, (_, index) => symbols[(index + resultIndex) % symbols.length])

  // Result symbol is placed into the final visible window before animation starts.
  if (resultSymbol !== undefined && !sameSymbol(windowSymbols[stopRow], resultSymbol)) {
    windowSymbols[stopRow] = resultSymbol
  }

  return windowSymbols
}

export function buildReelTrack({ symbols, resultSymbol, resultWindow, symbolHeight, loops, reelIndex, stopRow = paylineRow }) {
  const cycleLength = symbols.length * loops
  const cycleItems = Array.from({ length: cycleLength }, (_, index) => symbols[(index + reelIndex * 2) % symbols.length])
  const finalWindow = createResultWindow({ symbols, resultSymbol, resultWindow, stopRow })
  const resultIndex = cycleLength + stopRow

  // Align finalWindow[stopRow] to the same viewport row. This gives an exact stop
  // without replacing symbols after the animation completes.
  const targetY = -1 * (resultIndex - stopRow) * symbolHeight

  return {
    items: [...cycleItems, ...finalWindow],
    resultSymbol: finalWindow[stopRow],
    targetY,
  }
}

export function buildStaticTrack(column) {
  return {
    items: column,
    resultSymbol: column[paylineRow],
    targetY: 0,
  }
}

export function preloadSymbolImages(symbols) {
  const urls = [...new Set(symbols.map(getSymbolImageSrc).filter(Boolean))]
  if (!urls.length) return Promise.resolve()

  return Promise.all(
    urls.map(
      (url) =>
        new Promise((resolve) => {
          const image = new window.Image()
          image.onload = resolve
          image.onerror = resolve
          image.src = url
        })
    )
  )
}

export function nextFrame() {
  return new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)))
}

export function animateReel({
  trackElement,
  symbols,
  resultSymbol,
  symbolHeight = 100,
  loops = 5,
  duration = 1800,
  fromY = 0,
  targetY,
  easing = easeOutCubic,
  signal,
}) {
  const resultIndex = symbols.findIndex((symbol) => sameSymbol(symbol, resultSymbol))
  const computedTargetY = targetY ?? -1 * (loops * symbols.length + Math.max(resultIndex, 0)) * symbolHeight
  const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  return new Promise((resolve) => {
    if (!trackElement || signal?.aborted) {
      resolve(false)
      return
    }

    let frameId = 0
    let startedAt = 0

    const finish = (completed) => {
      window.cancelAnimationFrame(frameId)
      signal?.removeEventListener('abort', abort)

      if (completed) {
        // Final correction prevents sub-pixel drift after easing interpolation.
        trackElement.style.transform = `translate3d(0, ${computedTargetY}px, 0)`
      }

      resolve(completed)
    }

    const abort = () => finish(false)

    if (prefersReducedMotion || duration <= 0) {
      trackElement.style.transform = `translate3d(0, ${computedTargetY}px, 0)`
      resolve(true)
      return
    }

    const step = (timestamp) => {
      if (signal?.aborted) {
        finish(false)
        return
      }

      if (!startedAt) startedAt = timestamp
      const elapsed = timestamp - startedAt
      const progress = Math.min(elapsed / duration, 1)
      const eased = easing(progress)
      const currentY = fromY + (computedTargetY - fromY) * eased

      // During the spin, only the compositor-friendly transform changes.
      trackElement.style.transform = `translate3d(0, ${currentY}px, 0)`

      if (progress < 1) {
        frameId = window.requestAnimationFrame(step)
        return
      }

      finish(true)
    }

    signal?.addEventListener('abort', abort, { once: true })
    trackElement.style.transform = `translate3d(0, ${fromY}px, 0)`
    frameId = window.requestAnimationFrame(step)
  })
}

function SymbolTile({ symbol, compact = false, isWinning = false, ghost = false }) {
  const meta = typeof symbol === 'string' ? symbolMeta[symbol] || { label: symbol, caption: 'Prize', tone: 'slot-symbol-card' } : symbol
  const imageSrc = getSymbolImageSrc(symbol)
  const isImageSymbol = Boolean(imageSrc)
  const isEmojiSymbol = typeof symbol === 'string' && /\p{Extended_Pictographic}|\uFE0F/u.test(symbol)

  return (
    <div
      className={[
        'slot-symbol-tile',
        meta.tone || 'slot-symbol-card',
        compact ? 'slot-symbol-tile--compact' : '',
        isEmojiSymbol ? 'slot-symbol-tile--emoji' : '',
        isImageSymbol ? 'slot-symbol-tile--image' : '',
        isWinning ? 'slot-symbol-tile--winning' : '',
        ghost ? 'slot-symbol-tile--ghost' : '',
      ].join(' ')}
    >
      {imageSrc ? (
        <img className="slot-symbol-image" src={imageSrc} alt={meta.label || 'slot symbol'} draggable="false" />
      ) : (
        <>
          <span className="slot-symbol-art" aria-hidden="true">
            {meta.label || symbolKey(symbol)}
          </span>
          {!compact && <span className="slot-symbol-caption">{meta.caption || 'Prize'}</span>}
        </>
      )}
    </div>
  )
}

export default function Reel({
  reelIndex,
  track,
  compact = false,
  isSpinning = false,
  winningRows = [],
  trackRef,
  symbolHeight = 100,
}) {
  const winningRowSet = new Set(winningRows)
  const finalWindowStart = Math.max(track.items.length - visibleRows, 0)

  return (
    <div className="slot-reel-window" style={{ '--slot-symbol-height': `${symbolHeight}px` }}>
      <div ref={trackRef} className="slot-reel-track">
        {track.items.map((symbol, itemIndex) => {
          const finalRow = itemIndex - finalWindowStart
          const isFinalVisibleRow = finalRow >= 0 && finalRow < visibleRows

          return (
            <SymbolTile
              key={`${reelIndex}-${itemIndex}-${symbolKey(symbol)}`}
              symbol={symbol}
              compact={compact}
              ghost={isSpinning && !isFinalVisibleRow}
              isWinning={!isSpinning && isFinalVisibleRow && winningRowSet.has(finalRow)}
            />
          )
        })}
      </div>
    </div>
  )
}
