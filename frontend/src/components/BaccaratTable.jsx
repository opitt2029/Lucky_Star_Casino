import { useMemo } from 'react'

const betAreas = [
  { key: 'player', label: '閒家', odds: '1:1' },
  { key: 'banker', label: '莊家', odds: '0.95:1' },
  { key: 'tie', label: '和局', odds: '8:1' },
]

export default function BaccaratTable({ onBet, bets = {}, round, loading = false }) {
  const totalBet = useMemo(() => Object.values(bets).reduce((sum, value) => sum + value, 0), [bets])

  const placeBet = (area) => {
    onBet?.(area.key)
  }

  const playerCards = round?.playerCards || ['?', '?']
  const bankerCards = round?.bankerCards || ['?', '?']

  return (
    <section className="luxury-panel rounded p-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="gold-muted text-xs font-black uppercase tracking-[0.3em]">Baccarat</p>
          <h2 className="brand-title mt-1 text-xl font-black">百家樂多下注區</h2>
        </div>
        <div className="gold-button rounded px-4 py-2 text-sm font-black">本局下注 {totalBet.toLocaleString()}</div>
      </div>

      <div className="mt-5 grid gap-2 sm:grid-cols-3">
        {betAreas.map((area) => (
          <button
            key={area.key}
            type="button"
            onClick={() => placeBet(area)}
            disabled={loading}
            className={[
              'min-h-32 rounded border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-60',
              round?.winner === area.key
                ? 'animate-win-pulse border-yellow-200 bg-yellow-200 text-red-950'
                : 'border-yellow-200/15 bg-red-950/70 hover:border-yellow-200/70 hover:bg-red-800/70',
            ].join(' ')}
          >
            <span className="gold-muted text-xs font-black uppercase tracking-[0.25em]">Odds {area.odds}</span>
            <span className="mt-4 block text-2xl font-black">{area.label}</span>
            <span className="mt-6 block rounded border border-current px-3 py-2 text-center text-sm font-black">
              {(bets[area.key] || 0).toLocaleString()}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="rounded border border-yellow-200/15 bg-red-950/70 p-4">
          <p className="gold-muted text-xs font-black uppercase tracking-[0.25em]">Player</p>
          <div className="mt-3 flex gap-2">
            {playerCards.map((card, index) => (
              <div
                key={`${card}-${index}`}
                className={['grid h-24 w-16 place-items-center rounded bg-yellow-100 text-2xl font-black text-red-950', loading ? 'animate-card-flip' : ''].join(' ')}
              >
                {card}
              </div>
            ))}
          </div>
          <p className="mt-3 text-sm font-black text-yellow-100/72">點數 {round?.playerPoints ?? '-'}</p>
        </div>
        <div className="rounded border border-yellow-200/15 bg-red-950/70 p-4">
          <p className="gold-muted text-xs font-black uppercase tracking-[0.25em]">Banker</p>
          <div className="mt-3 flex gap-2">
            {bankerCards.map((card, index) => (
              <div
                key={`${card}-${index}`}
                className={['grid h-24 w-16 place-items-center rounded bg-yellow-100 text-2xl font-black text-red-950', loading ? 'animate-card-flip' : ''].join(' ')}
              >
                {card}
              </div>
            ))}
          </div>
          <p className="mt-3 text-sm font-black text-yellow-100/72">點數 {round?.bankerPoints ?? '-'}</p>
        </div>
      </div>
      {round && (
        <div className="mt-5 rounded border border-yellow-200/15 bg-red-950/70 p-4">
          <p className="gold-muted text-xs font-black uppercase tracking-[0.25em]">Result</p>
          <p className="brand-title mt-2 text-2xl font-black">
            {round.winner === 'player' ? '閒家勝' : round.winner === 'banker' ? '莊家勝' : '和局'} / 派彩 {round.payout.toLocaleString()}
          </p>
        </div>
      )}
    </section>
  )
}
