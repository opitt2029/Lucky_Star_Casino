import InfoHint from '../InfoHint'

const SIDE_BET_OPTIONS = [
  {
    id: 'playerPair',
    name: '閒對',
    odds: '11 : 1',
    description: '閒家前兩張同點數。',
    evaluate: ({ playerCards }) => hasRankPair(playerCards),
  },
  {
    id: 'bankerPair',
    name: '莊對',
    odds: '11 : 1',
    description: '莊家前兩張同點數。',
    evaluate: ({ bankerCards }) => hasRankPair(bankerCards),
  },
  {
    id: 'perfectPair',
    name: '完美對子',
    odds: '25 : 1',
    description: '任一方前兩張同點數且同花色。',
    evaluate: ({ playerCards, bankerCards }) => hasPerfectPair(playerCards) || hasPerfectPair(bankerCards),
  },
  {
    id: 'anyPair',
    name: '任一對子',
    odds: '5 : 1',
    description: '閒家或莊家任一方成對。',
    evaluate: ({ playerCards, bankerCards }) => hasRankPair(playerCards) || hasRankPair(bankerCards),
  },
  {
    id: 'big',
    name: '大牌',
    odds: '0.54 : 1',
    description: '本局總牌數為 5 或 6 張。',
    evaluate: ({ totalCards }) => totalCards >= 5,
  },
  {
    id: 'small',
    name: '小牌',
    odds: '1.5 : 1',
    description: '本局總牌數為 4 張。',
    evaluate: ({ totalCards }) => totalCards === 4,
  },
  {
    id: 'superSix',
    name: '幸運六 / 超級六',
    odds: '12 : 1',
    description: '莊家以 6 點勝出。',
    evaluate: ({ winner, bankerScore }) => winner === 'Banker' && bankerScore === 6,
  },
  {
    id: 'dragonBonus',
    name: '龍寶加注',
    odds: '最高 30 : 1',
    description: '非和局時勝方點差達 4 點以上。',
    evaluate: ({ winner, playerScore, bankerScore }) => winner !== 'Tie' && Math.abs(Number(playerScore) - Number(bankerScore)) >= 4,
  },
]

function hasRankPair(cards = []) {
  return cards.length >= 2 && cards[0]?.rank === cards[1]?.rank
}

function hasPerfectPair(cards = []) {
  return hasRankPair(cards) && cards[0]?.suit === cards[1]?.suit
}

function buildSideBetContext({ playerCards, bankerCards, playerScore, bankerScore, winner }) {
  return {
    playerCards,
    bankerCards,
    playerScore,
    bankerScore,
    winner,
    totalCards: playerCards.length + bankerCards.length,
  }
}

function sideBetState(option, context, isTracked, isSettled) {
  if (!isTracked) return { className: '', text: '點選追蹤' }
  if (!isSettled) return { className: 'is-tracked', text: '追蹤中' }
  return option.evaluate(context)
    ? { className: 'is-hit', text: '命中' }
    : { className: 'is-miss', text: '未中' }
}

export default function BaccaratSideBets({
  selectedSideBets = [],
  disabled = false,
  phase = 'idle',
  playerCards = [],
  bankerCards = [],
  playerScore = null,
  bankerScore = null,
  winner = '',
  onToggleSideBet,
  onClearSideBets,
}) {
  const tracked = new Set(selectedSideBets)
  const context = buildSideBetContext({ playerCards, bankerCards, playerScore, bankerScore, winner })
  const isSettled = phase === 'settled' && winner
  const trackedCount = selectedSideBets.length

  return (
    <section className="baccarat-side-bets" aria-label="百家樂側注追蹤">
      <div className="baccarat-panel-heading baccarat-side-bets__heading">
        <div>
          <p>側注</p>
          <h3>
            側注追蹤
            <InfoHint title="側注追蹤">
              只是「先勾起來、開牌後看有沒有中」的觀察工具，<strong>不會扣星幣、也不會派彩</strong>。
              勾選想留意的項目（例如閒對、幸運六），本局開牌後會標示命中或未中，
              方便你在真的能下側注之前先熟悉這些玩法。實際下注仍以閒／莊／和主注為準。
            </InfoHint>
          </h3>
        </div>
        <button type="button" onClick={onClearSideBets} disabled={disabled || trackedCount === 0}>
          清除
        </button>
      </div>

      <div className="baccarat-side-bets__summary">
        <span>已追蹤 {trackedCount} 項</span>
        <strong>{isSettled ? '本局已判定' : disabled ? '發牌中鎖定' : '發牌前可切換'}</strong>
      </div>

      <div className="baccarat-side-bets__grid">
        {SIDE_BET_OPTIONS.map((option) => {
          const isTracked = tracked.has(option.id)
          const state = sideBetState(option, context, isTracked, isSettled)
          return (
            <button
              key={option.id}
              type="button"
              disabled={disabled}
              onClick={() => onToggleSideBet?.(option.id)}
              className={[
                'baccarat-side-bet',
                isTracked ? 'is-selected' : '',
                state.className,
              ].join(' ')}
              aria-pressed={isTracked}
              title={option.description}
            >
              <span className="baccarat-side-bet__odds">{option.odds}</span>
              <strong>{option.name}</strong>
              <em>{option.description}</em>
              <span className="baccarat-side-bet__state">{state.text}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
