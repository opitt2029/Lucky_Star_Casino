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

export default function BaccaratBettingMat({ bets, selectedBet, disabled, onPlaceBet, chipFlight }) {
  return (
    <section className="baccarat-betting-mat" aria-label="百家樂主下注區">
      {betOrder.map((betType) => {
        const name = betNames[betType]
        const amount = bets[betType] || 0
        const isChipFlying = chipFlight?.betType === betType

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
              isChipFlying ? 'baccarat-bet-zone--pulse' : '',
            ].join(' ')}
            aria-pressed={selectedBet === betType}
            aria-label={`下注 ${name.zh}，賠率 ${BET_ODDS[betType]} 比 1`}
          >
            <span className="baccarat-bet-zone__ratio">{BET_ODDS[betType]} : 1</span>
            <strong>{name.zh}</strong>
            <em>{name.en}</em>
            <span className="baccarat-bet-zone__amount">本區下注 {Number(amount).toLocaleString()}</span>
            <ChipStack amount={amount} />
            {isChipFlying && <span key={chipFlight.nonce} className="baccarat-chip-flight" aria-hidden="true" />}
          </button>
        )
      })}
      <span className="baccarat-betting-mat__note">
        目前後端契約維持單區主注：{BET_TYPES.map((type) => BET_LABELS[type]).join(' / ')}
      </span>
    </section>
  )
}
