import { useMemo, useState } from 'react'
import InfoHint from '../InfoHint'

const ROWS = 6
const MAX_HISTORY = 50
const DOT_LABELS = { Banker: '莊', Player: '閒', Tie: '和' }
const ROAD_TABS = [
  ['bead', '珠盤路'],
  ['big', '大路'],
  ['eye', '大眼仔'],
  ['small', '小路'],
  ['cockroach', '曱甴路'],
]
const DERIVED_TITLES = { eye: '大眼仔', small: '小路', cockroach: '曱甴路' }

function buildBigRoad(history) {
  const columns = []
  let lastWinner = null
  history.forEach((round) => {
    if (round.winner === 'Tie') {
      const column = columns[columns.length - 1]
      const cell = column?.[column.length - 1]
      if (cell) cell.ties += 1
      else columns.push([{ winner: 'Tie', ties: 0 }])
      return
    }
    if (round.winner !== lastWinner) {
      columns.push([{ winner: round.winner, ties: 0 }])
      lastWinner = round.winner
      return
    }
    const column = columns[columns.length - 1]
    if (column.length < ROWS) column.push({ winner: round.winner, ties: 0 })
    else columns.push([{ winner: round.winner, ties: 0 }])
  })
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
        'baccarat-road-dot--' + String(winner || '').toLowerCase(),
        small ? 'baccarat-road-dot--small' : '',
        latest ? 'baccarat-road-dot--latest' : '',
      ].join(' ')}
      title={DOT_LABELS[winner] || '\u672a\u958b\u5c40'}
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
        <RoadDot key={round.winner + '-' + (round.roundId || index)} winner={round.winner} latest={index === rounds.length - 1} small />
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
              {column[rowIndex] && (
                <RoadDot winner={column[rowIndex].winner} ties={column[rowIndex].ties} latest={colIndex === columns.length - 1 && rowIndex === column.length - 1} />
              )}
            </span>
          ))}
        </div>
      ))}
    </div>
  )
}

function DerivedRoad({ title }) {
  return (
    <div className="baccarat-derived-road">
      <p>{title}</p>
      <div>{Array.from({ length: 36 }, (_, index) => <span key={index} />)}</div>
    </div>
  )
}

export default function BaccaratRoadmapPanel({ history = [] }) {
  const [activeTab, setActiveTab] = useState('bead')
  const rounds = useMemo(() => history.slice(-MAX_HISTORY), [history])
  const bigRoad = useMemo(() => buildBigRoad(rounds), [rounds])
  const streak = useMemo(() => currentStreak(rounds), [rounds])
  const counts = useMemo(() => ({
    Banker: rounds.filter((round) => round.winner === 'Banker').length,
    Player: rounds.filter((round) => round.winner === 'Player').length,
    Tie: rounds.filter((round) => round.winner === 'Tie').length,
  }), [rounds])

  return (
    <section className="baccarat-roadmap-panel">
      <div className="baccarat-panel-heading">
        <p>路單</p>
        <h3>
          路單分析
          <InfoHint title="路單分析">
            賭場記錄最近開牌結果的傳統圖表，用來一眼看出莊閒的走勢。
            「珠盤路」按順序一格一格記錄每局贏家；「大路」把同一方連贏排成直行，換邊才換行；
            「大眼仔／小路／曱甴路」是從大路推導出來的三張衍生圖，看的是走勢規不規律。
            <strong>純粹是歷史紀錄，每局結果彼此獨立，不能用來預測下一局。</strong>
          </InfoHint>
        </h3>
      </div>
      {streak.count >= 3 && <span className={'baccarat-roadmap-panel__streak is-' + streak.winner?.toLowerCase()}>{DOT_LABELS[streak.winner]} {streak.count} 連</span>}
      <div className="baccarat-roadmap-tabs" role="tablist" aria-label="百家樂路單切換">
        {ROAD_TABS.map(([id, label]) => (
          <button key={id} type="button" onClick={() => setActiveTab(id)} className={activeTab === id ? 'is-active' : ''} role="tab" aria-selected={activeTab === id}>{label}</button>
        ))}
      </div>
      <div className="baccarat-roadmap-scroll">
        {rounds.length === 0 ? (
          <p className="baccarat-roadmap-empty">尚無路單資料，完成第一局後會累積最近 50 局結果。</p>
        ) : activeTab === 'bead' ? (
          <BeadPlate rounds={rounds} />
        ) : activeTab === 'big' ? (
          <BigRoad columns={bigRoad} />
        ) : (
          <DerivedRoad title={DERIVED_TITLES[activeTab]} />
        )}
      </div>
      <div className="baccarat-roadmap-summary"><span>莊 {counts.Banker}</span><span>閒 {counts.Player}</span><span>和 {counts.Tie}</span><span>合計 {rounds.length}</span></div>
    </section>
  )
}
