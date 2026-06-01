import { useSelector } from 'react-redux'
import { Link } from 'react-router-dom'
import AppShell from '../components/AppShell'
import MetricCard from '../components/MetricCard'
import { gameCatalog, getBackgroundStyle, getDecorativeAssetStyle } from '../theme/backgroundTheme'

function GameCard({ game, index }) {
  const hoverTone =
    index % 2 === 0
      ? 'hover:shadow-[0_28px_80px_rgba(248,213,106,0.18)] hover:[transform:translateY(-6px)_scale(1.01)]'
      : 'hover:shadow-[0_28px_80px_rgba(201,13,24,0.24)] hover:[transform:translateY(-4px)_rotate(-0.5deg)]'

  return (
    <Link
      to={game.to}
      className={[
        'luxury-panel-soft group relative grid min-h-[360px] overflow-hidden rounded transition-all duration-500 md:grid-cols-[0.56fr_0.44fr]',
        'hover:border-yellow-200/80 hover:bg-red-800/80',
        hoverTone,
      ].join(' ')}
    >
      <div
        className="decorative-asset min-h-64 transition duration-700 group-hover:scale-105 group-hover:saturate-125"
        style={getDecorativeAssetStyle(game.assetKey)}
      />
      <div className="relative grid content-between overflow-hidden p-6 sm:p-8">
        <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-yellow-200/70 to-transparent opacity-0 transition duration-500 group-hover:opacity-100" />
        <div>
          <p className="gold-muted text-xs font-black uppercase tracking-[0.25em]">{game.meta}</p>
          <h3 className="brand-title mt-4 text-4xl font-black sm:text-5xl">{game.title}</h3>
          <p className="mt-4 max-w-xl text-base font-bold leading-7 text-yellow-100/68">{game.caption}</p>
        </div>
        <span className="mt-8 inline-flex w-fit items-center gap-2 text-sm font-black text-yellow-100 transition duration-500 group-hover:translate-x-2 group-hover:text-yellow-200">
          進入遊戲
          <span className="grid h-8 w-8 place-items-center rounded-full border border-yellow-200/30 bg-red-950/70 transition group-hover:border-yellow-200 group-hover:bg-yellow-200 group-hover:text-red-950">
            →
          </span>
        </span>
      </div>
    </Link>
  )
}

export default function Lobby() {
  const balance = useSelector((state) => state.wallet.balance)

  return (
    <AppShell>
      <section className="grid gap-4 lg:grid-cols-[1.35fr_0.65fr]">
        <div
          className="theme-artwork flex min-h-[360px] flex-col justify-between rounded border border-yellow-200/20 p-6 sm:p-8"
          style={getBackgroundStyle('lobbyHero')}
        >
          <div>
            <p className="gold-muted text-xs font-black uppercase tracking-[0.35em]">Game Directory</p>
            <h2 className="brand-title mt-4 max-w-3xl text-4xl font-black tracking-tight sm:text-5xl">
              遊戲大全
            </h2>
            <p className="mt-5 max-w-2xl text-base leading-7 text-yellow-100/70">
              這裡只展示平台目前收錄的遊戲清單。使用者從遊戲大全選擇遊戲後，才會進入各自的遊玩頁面。
            </p>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/shop" className="red-gold-button rounded px-5 py-3 text-sm font-black transition">
              前往賭場商城
            </Link>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
          <MetricCard label="目前星幣" value={balance.toLocaleString()} caption="您目前的籌碼總數" tone="light" />
          <MetricCard label="收錄遊戲" value={gameCatalog.length.toString()} caption="遊戲大全展示數" />
        </div>
      </section>

      <section className="mt-6 grid gap-5 xl:grid-cols-2">
        {gameCatalog.map((game, index) => (
          <GameCard key={game.to} game={game} index={index} />
        ))}
      </section>
    </AppShell>
  )
}
