import { useMemo, useState } from 'react'
import { useSelector } from 'react-redux'
import { integrationTestApi } from '../services/integrationTestApi'

const serviceLabels = {
  gateway: 'Gateway',
  member: 'Member',
  wallet: 'Wallet',
  game: 'Game',
  rank: 'Rank',
}

const gatewayBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080'

const statusStyles = {
  PASS: 'border-emerald-300/30 bg-emerald-500/10 text-emerald-200',
  FAIL: 'border-red-300/30 bg-red-500/10 text-red-200',
  IDLE: 'border-yellow-200/15 bg-red-950/70 text-yellow-100/54',
}

function formatTime(value) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('zh-TW', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(value)
}

function statusClass(status) {
  return statusStyles[status] || statusStyles.IDLE
}

function ResultRow({ result }) {
  return (
    <article className="rounded border border-yellow-200/15 bg-red-950/72 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded border px-2 py-1 text-xs font-black ${statusClass(result.status)}`}>
              {result.status}
            </span>
            <span className="gold-muted text-xs font-black uppercase">{result.method}</span>
            <span className="text-xs font-bold text-yellow-100/46">{result.httpStatus || 'ERR'}</span>
          </div>
          <h3 className="mt-3 text-base font-black text-yellow-100">{result.name}</h3>
          <p className="mt-1 break-all text-xs font-bold text-yellow-100/50">{result.path}</p>
        </div>
        <span className="shrink-0 rounded border border-yellow-200/15 px-2 py-1 text-xs font-black text-yellow-100/62">
          {result.durationMs} ms
        </span>
      </div>
      <p className="mt-3 break-words rounded bg-red-950/70 px-3 py-2 text-sm font-bold text-yellow-100/70">
        {result.detail || '-'}
      </p>
    </article>
  )
}

function SummaryTile({ label, value, tone = 'default' }) {
  const toneClass =
    tone === 'good'
      ? 'text-emerald-200'
      : tone === 'bad'
        ? 'text-red-200'
        : 'text-yellow-100'

  return (
    <div className="rounded border border-yellow-200/15 bg-red-950/70 p-4">
      <p className="gold-muted text-xs font-black uppercase tracking-[0.22em]">{label}</p>
      <p className={`mt-2 text-2xl font-black ${toneClass}`}>{value}</p>
    </div>
  )
}

export default function IntegrationTestPage() {
  const player = useSelector((state) => state.auth.player)
  const walletBalance = useSelector((state) => state.wallet.balance)
  const [results, setResults] = useState([])
  const [running, setRunning] = useState(false)
  const [lastRunAt, setLastRunAt] = useState(null)
  const [slotBet, setSlotBet] = useState(100)

  const grouped = useMemo(() => {
    return results.reduce((acc, result) => {
      acc[result.service] = acc[result.service] || []
      acc[result.service].push(result)
      return acc
    }, {})
  }, [results])

  const passCount = results.filter((item) => item.status === 'PASS').length
  const failCount = results.filter((item) => item.status === 'FAIL').length
  const totalCount = results.length

  const runSafeChecks = async () => {
    setRunning(true)
    try {
      const nextResults = await integrationTestApi.runSafeProbes()
      setResults(nextResults)
      setLastRunAt(new Date())
    } finally {
      setRunning(false)
    }
  }

  const appendActionResult = async (action) => {
    setRunning(true)
    try {
      const result = await action()
      setResults((current) => [result, ...current])
      setLastRunAt(new Date())
    } finally {
      setRunning(false)
    }
  }

  const canAffordSlot = Number(walletBalance || 0) >= Number(slotBet || 0)

  return (
    <div className="theme-background min-h-screen text-zinc-50">
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <section className="luxury-panel rounded p-4">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div>
            <p className="gold-muted text-xs font-black uppercase tracking-[0.3em]">
              Integration Lab
            </p>
            <h2 className="brand-title mt-1 text-2xl font-black">前後端整合測試</h2>
            <p className="mt-2 max-w-3xl text-sm font-bold leading-6 text-yellow-100/62">
              用目前登入的 JWT 直接經由 Gateway 打真實服務，快速確認路由、CORS、token、錢包、遊戲與排行榜鏈路。
            </p>
          </div>
          <div className="grid gap-2 sm:flex">
            <button
              type="button"
              onClick={runSafeChecks}
              disabled={running}
              className="gold-button rounded px-4 py-3 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-55"
            >
              {running ? '檢查中...' : '執行安全檢查'}
            </button>
            <a
              href={`${gatewayBaseUrl}/swagger-ui.html`}
              target="_blank"
              rel="noreferrer"
              className="red-gold-button rounded px-4 py-3 text-center text-sm font-black transition"
            >
              Swagger
            </a>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryTile label="API 模式" value={integrationTestApi.modeLabel} />
          <SummaryTile label="玩家" value={player?.username || player?.nickname || '-'} />
          <SummaryTile label="PASS" value={`${passCount}/${totalCount}`} tone={failCount ? 'default' : 'good'} />
          <SummaryTile label="FAIL" value={failCount} tone={failCount ? 'bad' : 'good'} />
        </div>

        <div className="mt-4 rounded border border-yellow-200/15 bg-red-950/62 px-4 py-3 text-sm font-bold text-yellow-100/58">
          上次執行：{formatTime(lastRunAt)}。讀取型檢查不會改變資料；下方兩個手動動作會建立帳務或遊戲紀錄。
        </div>
      </section>

      <section className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="luxury-panel rounded p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="gold-muted text-xs font-black uppercase tracking-[0.22em]">Wallet Action</p>
              <h3 className="mt-1 text-lg font-black text-yellow-100">破產補助探針</h3>
              <p className="mt-1 text-sm font-bold text-yellow-100/58">
                測試 gateway → wallet-service → PostgreSQL 入帳鏈路；若餘額不符合門檻，後端會拒絕。
              </p>
            </div>
            <button
              type="button"
              onClick={() => appendActionResult(() => integrationTestApi.claimBankruptcyAid())}
              disabled={running}
              className="red-gold-button shrink-0 rounded px-4 py-2 text-sm font-black disabled:cursor-not-allowed disabled:opacity-55"
            >
              執行
            </button>
          </div>
        </div>

        <div className="luxury-panel rounded p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="gold-muted text-xs font-black uppercase tracking-[0.22em]">Game Action</p>
              <h3 className="mt-1 text-lg font-black text-yellow-100">老虎機下注探針</h3>
              <p className="mt-1 text-sm font-bold text-yellow-100/58">
                測試 game-service 扣款、RNG、派彩與遊戲紀錄。餘額不足時前端先擋。
              </p>
            </div>
            <div className="grid shrink-0 grid-cols-[104px_72px] gap-2">
              <input
                type="number"
                min="100"
                step="100"
                value={slotBet}
                onChange={(event) => setSlotBet(Number(event.target.value))}
                className="min-h-10 rounded border border-yellow-200/15 bg-red-950/70 px-3 text-sm font-black text-yellow-100 outline-none focus:border-yellow-200"
                aria-label="老虎機下注金額"
              />
              <button
                type="button"
                onClick={() => appendActionResult(() => integrationTestApi.spinSlot({ bet: slotBet }))}
                disabled={running || !canAffordSlot}
                className="gold-button rounded px-3 py-2 text-sm font-black disabled:cursor-not-allowed disabled:opacity-55"
              >
                下注
              </button>
            </div>
          </div>
          {!canAffordSlot && (
            <p className="mt-3 rounded border border-red-300/30 bg-red-500/10 px-3 py-2 text-sm font-bold text-red-200">
              星幣不足，目前餘額 {Number(walletBalance || 0).toLocaleString()}。
            </p>
          )}
        </div>
      </section>

      <section className="mt-5 grid gap-5">
        {totalCount === 0 ? (
          <div className="luxury-panel rounded p-8 text-center">
            <p className="text-sm font-bold text-yellow-100/58">
              尚未執行檢查。啟動後端與前端後，先按「執行安全檢查」確認整條鏈路。
            </p>
          </div>
        ) : (
          Object.entries(grouped).map(([service, items]) => (
            <div key={service} className="luxury-panel rounded p-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-black text-yellow-100">{serviceLabels[service] || service}</h3>
                <span className="rounded border border-yellow-200/15 px-2 py-1 text-xs font-black text-yellow-100/58">
                  {items.filter((item) => item.status === 'PASS').length}/{items.length}
                </span>
              </div>
              <div className="mt-4 grid gap-3 xl:grid-cols-2">
                {items.map((result) => (
                  <ResultRow key={result.id} result={result} />
                ))}
              </div>
            </div>
          ))
        )}
      </section>

      </main>
    </div>
  )
}
