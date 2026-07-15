import { BET_LABELS } from '../../utils/baccaratGame'

function resultCopy(winner) {
  if (winner === 'Player') return { status: '閒家勝', title: '閒家勝出' }
  if (winner === 'Banker') return { status: '莊家勝', title: '莊家勝出' }
  if (winner === 'Tie') return { status: '和局', title: '和局退回主注' }
  return { status: '等待結果', title: '等待下注' }
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
  sideBetCount = 0,
}) {
  const copy = resultCopy(winner)
  const isEmpty = roundProfit === null
  const stateClass =
    isEmpty
      ? 'baccarat-settlement--empty'
      : roundProfit >= 0
        ? winner === 'Tie'
          ? 'baccarat-settlement--tie'
          : 'baccarat-settlement--win'
        : 'baccarat-settlement--loss'
  const currentBetLabel = roundBet ? BET_LABELS[roundBet.selectedBet] : selectedBet ? BET_LABELS[selectedBet] : '-'
  const currentAmount = Number(roundBet?.amount ?? betAmount ?? 0).toLocaleString()

  return (
    <section className={['baccarat-settlement', stateClass].join(' ')} aria-live="polite">
      <div className="baccarat-settlement__banner">
        <p>{copy.status}</p>
        <h3>{copy.title}</h3>
        <span>{phase === 'squeezing' ? '請完成咪牌或直接開牌。' : resultMessage || '選擇下注區後開始發牌。'}</span>
      </div>

      <div className={['baccarat-result-grid', isEmpty ? 'baccarat-result-grid--empty' : ''].join(' ')}>
        {isEmpty ? (
          <>
            <ResultItem label="本局主注" value={currentBetLabel} />
            <ResultItem label="下注金額" value={currentAmount} />
            <ResultItem label="側注追蹤" value={`${sideBetCount} 項`} />
            <ResultItem label="桌台提示" value={phase === 'idle' ? '等待下注' : '準備發牌'} />
          </>
        ) : (
          <>
            <ResultItem label="本局下注" value={currentBetLabel} />
            <ResultItem label="下注金額" value={currentAmount} />
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
            <ResultItem label="驗證提示" value={roundId ? '可至遊戲紀錄核對本局結果。' : '結算後顯示 roundId。'} wide />
          </>
        )}
      </div>
    </section>
  )
}
