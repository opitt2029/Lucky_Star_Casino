import { useMemo } from 'react'

// 百家樂路單：珠盤路 + 大路 + 長龍提示。華人百家樂玩家「看路下注」是核心儀式，
// 這是沉浸感最大的缺口。history 為本 session 局史 [{ winner: 'Player'|'Banker'|'Tie' }]。
const ROWS = 6

const DOT_STYLES = {
  Banker: 'bg-red-600 border-red-300 text-red-50',
  Player: 'bg-blue-600 border-blue-300 text-blue-50',
  Tie: 'bg-emerald-600 border-emerald-300 text-emerald-50',
}

const DOT_LABELS = { Banker: '莊', Player: '閒', Tie: '和' }

// 大路：同勝方向下疊、換勝方開新列；和局不開新列，記在前一格的角標。
function buildBigRoad(history) {
  const columns = []
  let lastWinner = null
  for (const round of history) {
    if (round.winner === 'Tie') {
      const lastColumn = columns[columns.length - 1]
      const lastCell = lastColumn?.[lastColumn.length - 1]
      if (lastCell) lastCell.ties += 1
      continue
    }
    if (round.winner !== lastWinner) {
      columns.push([{ winner: round.winner, ties: 0 }])
      lastWinner = round.winner
    } else {
      const column = columns[columns.length - 1]
      if (column.length < ROWS) {
        column.push({ winner: round.winner, ties: 0 })
      } else {
        // 超過 6 行轉龍尾：簡化為開新列（不做轉彎演算法）
        columns.push([{ winner: round.winner, ties: 0 }])
      }
    }
  }
  return columns
}

// 目前長龍：從最近一局往回數連續同勝方（跳過和局）。
export function currentStreak(history) {
  let winner = null
  let count = 0
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i].winner === 'Tie') continue
    if (winner === null) winner = history[i].winner
    if (history[i].winner !== winner) break
    count += 1
  }
  return { winner, count }
}

function Dot({ winner, ties = 0, small = false }) {
  return (
    <span
      className={[
        'relative grid place-items-center rounded-full border font-black',
        small ? 'h-4 w-4 text-[9px]' : 'h-5 w-5 text-[10px]',
        DOT_STYLES[winner] || 'bg-zinc-700 border-zinc-500',
      ].join(' ')}
    >
      {DOT_LABELS[winner]}
      {ties > 0 && (
        <span className="absolute -right-1 -top-1 grid h-3 w-3 place-items-center rounded-full bg-emerald-500 text-[8px] text-white">
          {ties > 1 ? ties : ''}
        </span>
      )}
    </span>
  )
}

// 大路最多顯示幾欄（依面板寬度估算：300px - 2*16px padding - scrollbar ≈ 260px；每欄 21px）
const MAX_BIG_ROAD_COLS = 12
// 珠盤路最多顯示 6×10 = 60 顆
const MAX_BEAD_COLS = 10

export default function BaccaratRoadmap({ history = [] }) {
  const bigRoad = useMemo(() => buildBigRoad(history), [history])
  const streak = useMemo(() => currentStreak(history), [history])
  const beads = history.slice(-ROWS * MAX_BEAD_COLS)
  const visibleColumns = bigRoad.slice(-MAX_BIG_ROAD_COLS)

  return (
    <div className="luxury-panel-soft rounded p-4 min-w-0 w-full overflow-hidden">
      <div className="flex items-center justify-between gap-2 min-w-0">
        <div className="shrink-0">
          <p className="gold-muted text-xs font-black uppercase tracking-[0.25em]">Roadmap</p>
          <h3 className="brand-title mt-1 text-xl font-black">路單</h3>
        </div>
        {streak.count >= 3 && (
          <span
            className={[
              'animate-pulse rounded-full border px-2 py-1 text-xs font-black shrink min-w-0 text-center',
              streak.winner === 'Banker'
                ? 'border-red-300/60 bg-red-600/30 text-red-100'
                : 'border-blue-300/60 bg-blue-600/30 text-blue-100',
            ].join(' ')}
          >
            {DOT_LABELS[streak.winner]} {streak.count} 連！
          </span>
        )}
      </div>

      {history.length === 0 ? (
        <p className="mt-3 rounded bg-red-950/70 p-3 text-sm text-yellow-100/60">開局後路單即時更新，看路下注。</p>
      ) : (
        <>
          <p className="mt-3 text-[11px] font-bold uppercase tracking-widest text-yellow-100/50">大路</p>
          <div className="mt-1 w-full overflow-x-auto rounded border border-yellow-200/15 bg-red-950/70 p-2">
            <div className="flex gap-1" style={{ width: 'max-content' }}>
              {visibleColumns.map((column, colIndex) => (
                <div key={colIndex} className="flex flex-col gap-1">
                  {Array.from({ length: ROWS }, (_, rowIndex) => (
                    <span key={rowIndex} className="grid h-5 w-5 place-items-center">
                      {column[rowIndex] ? <Dot winner={column[rowIndex].winner} ties={column[rowIndex].ties} /> : null}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <p className="mt-3 text-[11px] font-bold uppercase tracking-widest text-yellow-100/50">珠盤路</p>
          <div className="mt-1 w-full overflow-x-auto rounded border border-yellow-200/15 bg-red-950/70 p-2">
            <div
              className="grid grid-flow-col gap-1"
              style={{
                gridTemplateRows: `repeat(${ROWS}, minmax(0, 1fr))`,
                width: 'max-content',
              }}
            >
              {beads.map((round, index) => (
                <Dot key={index} winner={round.winner} small />
              ))}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs font-bold text-yellow-100/60">
            <span>莊 {history.filter((r) => r.winner === 'Banker').length}</span>
            <span>閒 {history.filter((r) => r.winner === 'Player').length}</span>
            <span>和 {history.filter((r) => r.winner === 'Tie').length}</span>
            <span className="ml-auto">共 {history.length} 局</span>
          </div>
        </>
      )}
    </div>
  )
}
