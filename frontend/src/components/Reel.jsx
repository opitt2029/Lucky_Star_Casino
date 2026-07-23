import Art from '../casino-fx/assets/Art'
import { SLOT_SYMBOL_ASSET } from '../casino-fx/assets/registry'

export const visibleRows = 3
export const paylineRow = 1

// 後端契約仍是 emoji 字串（SlotSymbol.display），視覺上由 SLOT_SYMBOL_ASSET
// 映射成華人財富意象（元寶/銅錢/紅包/福/金龍）；caption 同步改中文彩頭名。
const symbolMeta = {
  '🍒': { label: '🍒', caption: '金元寶', tone: 'slot-symbol-seven' },
  '🍋': { label: '🍋', caption: '銅錢', tone: 'slot-symbol-card' },
  '🔔': { label: '🔔', caption: '紅包', tone: 'slot-symbol-bar' },
  '⭐': { label: '⭐', caption: '福字', tone: 'slot-symbol-star' },
  '7️⃣': { label: '7️⃣', caption: '金龍', tone: 'slot-symbol-seven' },
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

// 視窗被別的視窗完全遮蔽、或分頁切到背景時，Chrome 會停掉 requestAnimationFrame，
// 但 setTimeout 仍會（被節流地）觸發。單靠 rAF 的 Promise 在那段期間永遠不 resolve，
// 上游 SlotMachine.runReels 就會一直停在 phase='spinning' —— 這正是 PR #255 回報的
// 「SPIN 永久卡在 SPINNING、狀態停在減速中、餘額不更新、卻沒有 console 錯誤」。
// 這裡讓 rAF 與逾時互相賽跑，保證這個 Promise 一定會結束（AGENTS.md 雷區 13：
// 視覺鎖必須綁在真實流程上，不能被一個可能永遠不來的影格綁死）。
export function nextFrame(timeoutMs = 250) {
  return new Promise((resolve) => {
    let settled = false
    const settle = () => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      resolve()
    }
    const timer = window.setTimeout(settle, timeoutMs)
    window.requestAnimationFrame(() => window.requestAnimationFrame(settle))
  })
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
    // 用 null 而非 0 當「尚未起算」：rAF 的 timestamp 可能就是 0，用 !startedAt 判斷
    // 會把那一幀當成沒起算過而丟掉一幀（動畫實際上會少跑一格）。
    let startedAt = null
    let watchdogId = 0

    const finish = (completed) => {
      window.cancelAnimationFrame(frameId)
      window.clearTimeout(watchdogId)
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

      if (startedAt === null) startedAt = timestamp
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
    // 看門狗：rAF 停擺（視窗被遮蔽/背景分頁）時仍讓轉輪落定並結束這個 Promise。
    // 寬限 1.2s 遠大於正常演出的影格抖動，正常路徑一定是 step() 先跑完，行為不變；
    // 只有動畫真的停住時才會由它收尾——寧可少看一段演出，也不能把玩家鎖在轉動中。
    watchdogId = window.setTimeout(() => finish(true), duration + 1200)
    frameId = window.requestAnimationFrame(step)
  })
}

function SymbolTile({ symbol, compact = false, isWinning = false, ghost = false }) {
  const meta = typeof symbol === 'string' ? symbolMeta[symbol] || { label: symbol, caption: 'Prize', tone: 'slot-symbol-card' } : symbol
  const imageSrc = getSymbolImageSrc(symbol)
  const isImageSymbol = Boolean(imageSrc)
  const richAssetId = typeof symbol === 'string' ? SLOT_SYMBOL_ASSET[symbol] : null
  const isEmojiSymbol = !richAssetId && typeof symbol === 'string' && /\p{Extended_Pictographic}|\uFE0F/u.test(symbol)

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
      {richAssetId ? (
        <>
          <span className="slot-symbol-art slot-symbol-art--rich" aria-hidden="true">
            <Art id={richAssetId} />
          </span>
          {!compact && <span className="slot-symbol-caption">{meta.caption || 'Prize'}</span>}
        </>
      ) : imageSrc ? (
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
