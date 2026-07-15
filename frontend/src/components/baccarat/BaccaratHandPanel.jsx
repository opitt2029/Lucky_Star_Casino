import BaccaratCard, { BaccaratSqueezeCard } from './BaccaratCard'

function winnerClass(winner, winnerKey) {
  if (!winner) return ''
  if (winner !== winnerKey) return 'baccarat-hand--dimmed'
  if (winnerKey === 'Player') return 'baccarat-hand--winner baccarat-hand--player-win'
  if (winnerKey === 'Banker') return 'baccarat-hand--winner baccarat-hand--banker-win'
  return 'baccarat-hand--winner'
}

export default function BaccaratHandPanel({
  title,
  localName,
  score,
  cards,
  isDealing,
  winner,
  winnerKey,
  concealed = false,
  dealSeed = 1,
  onCardRevealed,
}) {
  const visibleCards = cards.length ? cards : [null, null]
  const isNatural = !concealed && score !== null && (score === 8 || score === 9)

  return (
    <section className={['baccarat-hand', winnerClass(winner, winnerKey)].join(' ')} aria-label={`${localName}手牌`}>
      <div className="baccarat-hand__header">
        <div className="baccarat-hand__name">
          <p className="baccarat-hand__eyebrow">{title}</p>
          <h3 className="baccarat-hand__title">{localName}</h3>
          {isNatural && <span className="baccarat-natural-badge">Natural</span>}
        </div>
        <div className="baccarat-score">
          <span>點數</span>
          <strong>{concealed ? '?' : score === null ? '-' : score}</strong>
        </div>
      </div>

      <div className="baccarat-cards">
        {visibleCards.map((card, index) =>
          concealed && card ? (
            <BaccaratSqueezeCard
              key={`squeeze-${title}-${card.suit}-${card.rank}-${index}`}
              card={card}
              index={index}
              onRevealed={onCardRevealed}
            />
          ) : (
            <BaccaratCard
              key={card ? `${title}-${card.suit}-${card.rank}-${index}` : `${title}-empty-${index}`}
              card={card}
              index={index}
              isDealing={isDealing}
              dealSeed={dealSeed}
            />
          ),
        )}
      </div>
    </section>
  )
}