import { BET_LABELS, BET_ODDS, BET_TYPES } from '../../utils/baccaratGame'

const betNames = {
  Player: { zh: '閒家', en: 'Player' },
  Tie: { zh: '和局', en: 'Tie' },
  Banker: { zh: '莊家', en: 'Banker' },
}

const betOrder = ['Player', 'Tie', 'Banker']

function ChipStack({ amount }) {
  if (!amount) return null
  return (
    <span className="baccarat-bet-chip-stack" aria-hidden="true">
      <i />
      <i />
      <b>{Number(amount).toLocaleString()}</b>
    </span>
  )
}

export default function BaccaratBettingMat({ bets, selectedBet, disabled, onPlaceBet }) {
  return (
    <section className="baccarat-betting-mat" aria-label="百家樂主注下注區">
      {betOrder.map((betType) => {
        const name = betNames[betType]
        const amount = bets[betType] || 0
        return (
          <button
            key={betType}
            type="button"
            onClick={() => onPlaceBet(betType)}
            disabled={disabled}
            className={[
              'baccarat-bet-zone',
              `baccarat-bet-zone--${betType.toLowerCase()}`,
              selectedBet === betType ? 'baccarat-bet-zone--selected' : '',
            ].join(' ')}
          >
            <span className="baccarat-bet-zone__ratio">{BET_ODDS[betType]} : 1</span>
            <strong>{name.zh}</strong>
            <em>{name.en}</em>
            <span className="baccarat-bet-zone__amount">已下注 {Number(amount).toLocaleString()}</span>
            <ChipStack amount={amount} />
          </button>
        )
      })}
      <span className="baccarat-betting-mat__note">
        目前主注維持單區下注：{BET_TYPES.map((type) => BET_LABELS[type]).join(' / ')}
      </span>
    </section>
  )
}
