import { useCallback, useEffect, useState } from 'react'
import AppShell from '../components/AppShell'
import SeedCard from '../components/fairness/SeedCard'
import VerdictPanel from '../components/fairness/VerdictPanel'
import ResultDiff from '../components/fairness/ResultDiff'
import '../components/fairness/fairness.css'
import { fairnessApi } from '../services/fairnessApi'
import { gameApi } from '../services/gameApi'

const recentLimit = 8

function formatTime(value) {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString()
}

function gameLabel(gameType) {
  return {
    SLOT: '老虎機',
    BACCARAT: '百家樂',
    FISHING: '捕魚機',
  }[gameType] || gameType || '未知遊戲'
}

export default function Fairness() {
  const [roundId, setRoundId] = useState('')
  const [serverSeed, setServerSeed] = useState('')
  const [recentRounds, setRecentRounds] = useState([])
  const [loadingRecent, setLoadingRecent] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  const loadRecentRounds = useCallback(async () => {
    setLoadingRecent(true)
    try {
      const history = await gameApi.gameHistory({ gameType: 'all', page: 1, pageSize: recentLimit })
      setRecentRounds(history.items || [])
    } catch {
      setRecentRounds([])
    } finally {
      setLoadingRecent(false)
    }
  }, [])

  useEffect(() => {
    loadRecentRounds()
  }, [loadRecentRounds])

  const verify = async (targetRoundId = roundId) => {
    const trimmed = String(targetRoundId || '').trim()
    if (!trimmed) {
      setError('請輸入 Round ID')
      return
    }
    setVerifying(true)
    setError('')
    try {
      const data = await fairnessApi.verifyRound({
        roundId: trimmed,
        serverSeed: serverSeed.trim() || undefined,
      })
      setRoundId(trimmed)
      setResult(data)
    } catch (apiError) {
      setResult(null)
      setError(apiError?.response?.data?.message || apiError.message || '驗證失敗')
    } finally {
      setVerifying(false)
    }
  }

  return (
    <AppShell>
      <section className="fairness">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <span className={`fairness__badge fairness__badge--${fairnessApi.isMock ? 'mock' : 'real'}`}>
              {fairnessApi.isMock ? 'Mock 驗證模式' : 'Real 後端驗證'}
            </span>
            <h1 className="brand-title mt-3 text-3xl font-black text-yellow-100">公平性驗證</h1>
            <p className="fairness__badge-note">
              輸入遊戲紀錄的 Round ID，系統會用 server seed、client seed 與 nonce 重算結果，確認承諾雜湊與紀錄是否一致。
            </p>
          </div>
          <button type="button" className="red-gold-button rounded px-4 py-3 text-sm font-black" onClick={loadRecentRounds}>
            {loadingRecent ? '更新中...' : '更新最近紀錄'}
          </button>
        </div>

        <form
          className="mt-5 grid gap-3 rounded border border-yellow-200/15 bg-red-950/60 p-4 md:grid-cols-[1fr_1fr_auto]"
          onSubmit={(event) => {
            event.preventDefault()
            verify()
          }}
        >
          <label className="grid gap-2 text-sm font-bold text-yellow-100/78">
            Round ID
            <input
              className="min-h-11 rounded border border-yellow-200/15 bg-red-950/70 px-4 text-sm font-bold text-white outline-none focus:border-yellow-200"
              value={roundId}
              onChange={(event) => setRoundId(event.target.value)}
              placeholder="例如 SLOT-..."
            />
          </label>
          <label className="grid gap-2 text-sm font-bold text-yellow-100/78">
            Server Seed 選填
            <input
              className="min-h-11 rounded border border-yellow-200/15 bg-red-950/70 px-4 text-sm font-bold text-white outline-none focus:border-yellow-200"
              value={serverSeed}
              onChange={(event) => setServerSeed(event.target.value)}
              placeholder="留空使用已揭露 seed"
            />
          </label>
          <button type="submit" className="gold-button self-end rounded px-5 py-3 text-sm font-black" disabled={verifying}>
            {verifying ? '驗證中...' : '開始驗證'}
          </button>
        </form>

        {error && <p className="fairness__error">{error}</p>}

        {result && (
          <section className="mt-5 rounded border border-yellow-200/15 bg-red-950/50 p-4">
            <div className="flex flex-col justify-between gap-2 md:flex-row md:items-center">
              <div>
                <p className="gold-muted text-xs font-black uppercase tracking-[0.25em]">Verification</p>
                <h2 className="mt-1 text-xl font-black text-yellow-100">{gameLabel(result.gameType)} / {result.roundId}</h2>
              </div>
              <span className={result.usedProvidedSeed ? 'fairness__badge fairness__badge--mock' : 'fairness__badge fairness__badge--real'}>
                {result.usedProvidedSeed ? '使用手動 seed' : '使用已揭露 seed'}
              </span>
            </div>
            <div className="mt-4 grid gap-2">
              <SeedCard label="Server Seed" value={result.serverSeed} />
              <SeedCard label="Server Seed Hash" value={result.serverSeedHash} />
              <SeedCard label="Client Seed" value={result.clientSeed} />
              <SeedCard label="Nonce" value={String(result.nonce ?? '-')} />
            </div>
            <VerdictPanel
              commitmentValid={result.commitmentValid}
              resultMatches={result.resultMatches}
              valid={result.valid}
              message={result.message}
            />
            <ResultDiff recomputed={result.recomputed} stored={result.stored} />
          </section>
        )}

        <section className="mt-5 rounded border border-yellow-200/15 bg-red-950/50 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="gold-muted text-xs font-black uppercase tracking-[0.25em]">Recent Rounds</p>
              <h2 className="mt-1 text-xl font-black text-yellow-100">最近遊戲紀錄</h2>
            </div>
          </div>
          <div className="mt-4 grid gap-2">
            {loadingRecent ? (
              <p className="rounded border border-yellow-200/15 px-4 py-6 text-center font-bold text-yellow-100/60">讀取中...</p>
            ) : recentRounds.length > 0 ? (
              recentRounds.map((round) => (
                <button
                  key={round.roundId}
                  type="button"
                  className="grid gap-1 rounded border border-yellow-200/15 bg-red-950/70 px-4 py-3 text-left transition hover:border-yellow-200/60 md:grid-cols-[1fr_auto] md:items-center"
                  onClick={() => verify(round.roundId)}
                >
                  <span className="min-w-0">
                    <span className="block break-all text-sm font-black text-yellow-100">{round.roundId}</span>
                    <span className="block text-xs font-bold text-yellow-100/56">
                      {gameLabel(round.gameType)} / 損益 {(round.profit ?? 0).toLocaleString()} / {formatTime(round.settledAt || round.betAt)}
                    </span>
                  </span>
                  <span className="gold-button rounded px-3 py-2 text-xs font-black">驗證</span>
                </button>
              ))
            ) : (
              <p className="rounded border border-yellow-200/15 px-4 py-6 text-center font-bold text-yellow-100/60">目前沒有可驗證的遊戲紀錄</p>
            )}
          </div>
        </section>
      </section>
    </AppShell>
  )
}