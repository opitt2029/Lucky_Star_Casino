import { BET_LABELS } from '../../utils/baccaratGame'

const phaseLabels = {
  idle: '等待下注',
  betting: '下注中',
  dealing: '發牌中',
  squeezing: '等待咪牌',
  settled: '本局結算',
}

export default function BaccaratStatusBar({ phase, selectedBet, betAmount, roundProfit, historyCount, roundId }) {
  const profitText =
    roundProfit === null
      ? '-'
      : `${roundProfit >= 0 ? '+' : '-'}${Math.abs(roundProfit).toLocaleString()}`

  return (
    <div className="baccarat-status-bar" aria-live="polite">
      <div>
        <span>階段</span>
        <strong>{phaseLabels[phase] || '等待下注'}</strong>
      </div>
      <div>
        <span>本局下注</span>
        <strong>{selectedBet ? BET_LABELS[selectedBet] : '尚未選擇'}</strong>
      </div>
      <div>
        <span>下注金額</span>
        <strong>{Number(betAmount || 0).toLocaleString()}</strong>
      </div>
      <div>
        <span>本局損益</span>
        <strong>{profitText}</strong>
      </div>
      <div>
        <span>歷史局數</span>
        <strong>{historyCount}</strong>
      </div>
      <div>
        <span>Round</span>
        <strong>{roundId || '-'}</strong>
      </div>
    </div>
  )
}
