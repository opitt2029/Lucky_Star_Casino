import { BET_LABELS } from '../../utils/baccaratGame'

function resultCopy(winner) {
  if (winner === 'Player') return { en: 'Player Win', zh: '閒家勝' }
  if (winner === 'Banker') return { en: 'Banker Win', zh: '莊家勝' }
  if (winner === 'Tie') return { en: 'Tie', zh: '和局' }
  return { en: 'Waiting', zh: '等待結算' }
}

function ResultItem({ label, value, wide = false }) {
  return (
    <div className={['baccarat-result-item', wide ? 'baccarat-result-item--wide' : ''].join(' ')}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

export default function BaccaratSettlementPanel({
  phase,
  winner,
  roundBet,
  selectedBet,
  betAmount,
  payout,
  roundProfit,
  rebate,
  resultMessage,
  roundId,
}) {
  const copy = resultCopy(winner)
  const stateClass =
    roundProfit === null
      ? 'baccarat-settlement--empty'
      : roundProfit >= 0
        ? winner === 'Tie'
          ? 'baccarat-settlement--tie'
          : 'baccarat-settlement--win'
        : 'baccarat-settlement--loss'

  return (
    <section className={['baccarat-settlement', stateClass].join(' ')}>
      <div className="baccarat-settlement__banner">
        <p>{copy.en}</p>
        <h3>{copy.zh}</h3>
        <span>{phase === 'squeezing' ? '咪牌完成後揭曉' : resultMessage || '等待下注與發牌。'}</span>
      </div>

      <div className="baccarat-result-grid">
        <ResultItem label="本局下注" value={roundBet ? BET_LABELS[roundBet.selectedBet] : selectedBet ? BET_LABELS[selectedBet] : '-'} />
        <ResultItem label="下注金額" value={Number(roundBet?.amount ?? betAmount ?? 0).toLocaleString()} />
        <ResultItem label="派彩金額" value={payout === null || payout === undefined ? '-' : payout.toLocaleString()} />
        <ResultItem
          label="淨損益"
          value={
            roundProfit === null
              ? '-'
              : `${roundProfit >= 0 ? '+' : '-'}${Math.abs(roundProfit).toLocaleString()}`
          }
        />
        <ResultItem label="返水" value={rebate === null || rebate === undefined ? '-' : `+${Number(rebate).toLocaleString()}`} />
        <ResultItem label="roundId" value={roundId || '-'} />
        <ResultItem label="公平性驗證" value={roundId ? '可於遊戲紀錄核對' : '結算後產生'} wide />
      </div>
    </section>
  )
}
