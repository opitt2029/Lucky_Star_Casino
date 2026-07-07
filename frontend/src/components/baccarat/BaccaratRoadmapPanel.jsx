import { useMemo, useState } from 'react'

const ROWS = 6
const MAX_HISTORY = 50
const DOT_LABELS = { Banker: '莊', Player: '閒', Tie: '和' }

function buildBigRoad(history) {
  const columns = []
  let lastWinner = null
  for (const round of history) {
    if (round.winner === 'Tie') {
      const lastColumn = columns[columns.length - 1]
      const lastCell = lastColumn?.[lastColumn.length - 1]
      if (lastCell) lastCell.ties += 1
      else columns.push([{ winner: 'Tie', ties: 0 }])
      continue
    }
    if (round.winner !== lastWinner) {
      columns.push([{ winner: round.winner, ties: 0 }])
      lastWinner = round.winner
    } else {
      const column = columns[columns.length - 1]
      if (column.length < ROWS) column.push({ winner: round.winner, ties: 0 })
      else columns.push([{ winner: round.winner, ties: 0 }])
    }
  }
  return columns
}

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

function RoadDot({ winner, ties = 0, latest = false, small = false }) {
  return (
    <span
      className={[
        'baccarat-road-dot',
        `baccarat-road-dot--${String(winner || '').toLowerCase()}`,
        small ? 'baccarat-road-dot--small' : '',
        latest ? 'baccarat-road-dot--latest' : '',
      ].join(' ')}
      title={DOT_LABELS[winner] || winner}
    >
      {DOT_LABELS[winner] || '-'}
      {ties > 0 && <i>{ties > 1 ? ties : ''}</i>}
    </span>
  )
}

function BeadPlate({ rounds }) {
  return (
    <div className="baccarat-road-grid baccarat-road-grid--bead">
      {rounds.map((round, index) => (
        <RoadDot key={`${round.winner}-${index}`} winner={round.winner} latest={index === rounds.length - 1} small />
      ))}
    </div>
  )
}

function BigRoad({ columns }) {
  return (
    <div className="baccarat-big-road">
      {columns.map((column, colIndex) => (
        <div key={colIndex} className="baccarat-big-road__column">
          {Array.from({ length: ROWS }, (_, rowIndex) => (
            <span key={rowIndex} className="baccarat-big-road__cell">
              {column[rowIndex] ? (
                <RoadDot
                  winner={column[rowIndex].winner}
                  ties={column[rowIndex].ties}
                  latest={colIndex === columns.length - 1 && rowIndex === column.length - 1}
                />
              ) : null}
            </span>
          ))}
        </div>
      ))}
    </div>
  )
}

function DerivedRoadSkeleton({ title }) {
  return (
    <div className="baccarat-derived-road">
      <p>{title}</p>
      <div>
        {Array.from({ length: 36 }, (_, index) => (
          <span key={index} />
        ))}
      </div>
      {/* TODO: 補上大眼仔路 / 小路 / 蟑螂路的正式百家樂路單衍生演算法。 */}
    </div>
  )
}

export default function BaccaratRoadmapPanel({ history = [] }) {
  const [activeTab, setActiveTab] = useState('bead')
  const rounds = useMemo(() => history.slice(-MAX_HISTORY), [history])
  const bigRoad = useMemo(() => buildBigRoad(rounds), [rounds])
  const streak = useMemo(() => currentStreak(rounds), [rounds])

  const tabs = [
    { id: 'bead', label: '珠盤路' },
    { id: 'big', label: '大路' },
    { id: 'eye', label: '大眼仔' },
    { id: 'small', label: '小路' },
    { id: 'cockroach', label: '蟑螂路' },
  ]

  return (
    <section className="baccarat-roadmap-panel">
      <div className="baccarat-panel-heading">
        <p>Roadmap</p>
        <h3>路單</h3>
      </div>

      {streak.count >= 3 && (
        <span className={['baccarat-roadmap-panel__streak', `is-${streak.winner?.toLowerCase()}`].join(' ')}>
          {DOT_LABELS[streak.winner]} {streak.count} 連
        </span>
      )}

      <div className="baccarat-roadmap-tabs" role="tablist" aria-label="百家樂路單類型">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={activeTab === tab.id ? 'is-active' : ''}
            role="tab"
            aria-selected={activeTab === tab.id}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="baccarat-roadmap-scroll">
        {rounds.length === 0 ? (
          <p className="baccarat-roadmap-empty">開局後路單即時更新，最近 50 局會保留在本次進場。</p>
        ) : activeTab === 'bead' ? (
          <BeadPlate rounds={rounds} />
        ) : activeTab === 'big' ? (
          <BigRoad columns={bigRoad} />
        ) : activeTab === 'eye' ? (
          <DerivedRoadSkeleton title="Big Eye Boy / 大眼仔路" />
        ) : activeTab === 'small' ? (
          <DerivedRoadSkeleton title="Small Road / 小路" />
        ) : (
          <DerivedRoadSkeleton title="Cockroach Pig / 蟑螂路" />
        )}
      </div>

      <div className="baccarat-roadmap-summary">
        <span>莊 {rounds.filter((round) => round.winner === 'Banker').length}</span>
        <span>閒 {rounds.filter((round) => round.winner === 'Player').length}</span>
        <span>和 {rounds.filter((round) => round.winner === 'Tie').length}</span>
        <span>共 {rounds.length} 局</span>
      </div>
    </section>
  )
}
