const sideBets = [
  'Player Pair',
  'Banker Pair',
  'Perfect Pair',
  'Either Pair',
  'Big',
  'Small',
  'Lucky 6 / Super 6',
  'Dragon Bonus',
]

export default function BaccaratSideBets() {
  return (
    <section className="baccarat-side-bets" aria-label="百家樂 Side Bets">
      <div className="baccarat-panel-heading">
        <p>Side Bets</p>
        <h3>特殊注區</h3>
      </div>
      <div className="baccarat-side-bets__grid">
        {sideBets.map((bet) => (
          <button key={bet} type="button" disabled className="baccarat-side-bet">
            <strong>{bet}</strong>
            <span>尚未開放</span>
          </button>
        ))}
      </div>
    </section>
  )
}
