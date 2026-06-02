import { useMemo, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import AppShell from '../components/AppShell'
import { fetchProfile } from '../store/slices/authSlice'
import { dailyCheckIn, fetchWallet } from '../store/slices/walletSlice'

export default function CheckIn() {
  const dispatch = useDispatch()
  const player = useSelector((state) => state.auth.player)
  const wallet = useSelector((state) => state.wallet)
  const [notice, setNotice] = useState('')
  const todayLabel = useMemo(
    () =>
      new Intl.DateTimeFormat('zh-TW', {
        timeZone: 'Asia/Taipei',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'long',
      }).format(new Date()),
    []
  )

  const handleCheckIn = async () => {
    try {
      const result = await dispatch(dailyCheckIn()).unwrap()
      dispatch(fetchProfile())
      dispatch(fetchWallet())
      setNotice(`簽到成功，獲得 ${result.reward.toLocaleString()} 星幣。`)
    } catch {
      setNotice('')
    }
  }

  return (
    <AppShell>
      <section className="grid gap-5 lg:grid-cols-[1fr_0.42fr]">
        <div className="luxury-panel rounded p-6 sm:p-8">
          <p className="gold-muted text-xs font-black uppercase tracking-[0.35em]">Daily Check-in</p>
          <h2 className="brand-title mt-3 text-4xl font-black tracking-tight sm:text-5xl">
            每日簽到
          </h2>
          <p className="mt-4 max-w-2xl text-base font-bold leading-8 text-yellow-100/70">
            {player?.nickname || player?.username || '玩家'}，今天是 {todayLabel}。完成簽到後會累積連續天數，並發送星幣獎勵。
          </p>

          <button
            type="button"
            onClick={handleCheckIn}
            disabled={wallet.checkIn.loading}
            className="gold-button mt-8 rounded px-6 py-3 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-60"
          >
            {wallet.checkIn.loading ? '簽到中...' : '立即簽到'}
          </button>

          {(notice || wallet.checkIn.message) && (
            <p className="mt-4 rounded border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm font-bold text-emerald-200">
              {notice || wallet.checkIn.message}
            </p>
          )}
          {wallet.error && (
            <p className="mt-4 rounded border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-200">
              {wallet.error}
            </p>
          )}
        </div>

        <aside className="luxury-panel-soft rounded p-5">
          <p className="gold-muted text-xs font-black uppercase tracking-[0.28em]">Reward Status</p>
          <dl className="mt-5 grid gap-4">
            <div>
              <dt className="text-sm font-bold text-yellow-100/62">目前星幣</dt>
              <dd className="brand-title mt-1 text-3xl font-black">{wallet.balance.toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-sm font-bold text-yellow-100/62">連續簽到</dt>
              <dd className="mt-1 text-2xl font-black text-yellow-100">
                {(wallet.checkIn.consecutiveDays ?? player?.consecutiveCheckInDays ?? 0).toLocaleString()} 天
              </dd>
            </div>
          </dl>
        </aside>
      </section>
    </AppShell>
  )
}
