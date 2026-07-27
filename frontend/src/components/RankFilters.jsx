const scopes = [
  { key: 'GLOBAL', label: '全服' },
  { key: 'FRIENDS', label: '好友' },
]

const categories = [
  { key: 'COINS', label: '星幣總榜' },
  { key: 'DAILY_WINNINGS', label: '今日贏幣' },
  { key: 'SLOT', label: '老虎機' },
  { key: 'BACCARAT', label: '百家樂' },
  { key: 'FISHING', label: '捕魚機' },
]

export { scopes as rankScopes, categories as rankCategories }

export default function RankFilters({ scope, category, onScopeChange, onCategoryChange }) {
  return (
    <section className="luxury-panel-soft rounded p-4">
      <div className="grid gap-4 md:grid-cols-[auto_1fr] md:items-center">
        <div>
          <p className="gold-muted text-xs font-black uppercase tracking-[0.25em]">Scope</p>
          <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="排行榜範圍">
            {scopes.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => onScopeChange(item.key)}
                className={[
                  'rank-filter-chip rounded px-4 py-2 text-sm font-black transition',
                  scope === item.key ? 'gold-button rank-filter-chip--active' : 'border border-yellow-200/15 bg-red-950/70 text-yellow-100/70 hover:text-yellow-100',
                ].join(' ')}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="gold-muted text-xs font-black uppercase tracking-[0.25em]">Category</p>
          <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="排行榜類型">
            {categories.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => onCategoryChange(item.key)}
                className={[
                  'rank-filter-chip rounded px-3 py-2 text-sm font-black transition',
                  category === item.key ? 'gold-button rank-filter-chip--active' : 'border border-yellow-200/15 bg-red-950/70 text-yellow-100/70 hover:text-yellow-100',
                ].join(' ')}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
