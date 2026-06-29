import { useMemo, useState } from 'react'
import { useSelector } from 'react-redux'
import AppShell from '../components/AppShell'
import { useDailyCheckIn } from '../hooks/useDailyCheckIn'

export default function CheckIn() {
  const player = useSelector((state) => state.auth.player)
  const {
    balance,
    monthLabel,
    monthDays,
    signedDayNumbers,
    monthCheckinDays,
    consecutiveDays,
    hasCheckedInToday,
    milestones,
    checkInLoading,
    checkInMessage,
    claiming,
    claimMessage,
    claimError,
    walletError,
    checkInToday,
    claimReward,
  } = useDailyCheckIn()
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
    const result = await checkInToday()
    if (result) {
      setNotice(`簽到成功，獲得 ${result.reward.toLocaleString()} 星幣。`)
    } else {
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
            {player?.nickname || player?.username || '玩家'}，今天是 {todayLabel}。完成簽到後會累積連續天數與本月累計天數，並發送星幣獎勵。
          </p>

          <button
            type="button"
            onClick={handleCheckIn}
            disabled={checkInLoading || hasCheckedInToday}
            className="gold-button mt-8 rounded px-6 py-3 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-60"
          >
            {checkInLoading ? '簽到中...' : hasCheckedInToday ? '今日已簽到' : '立即簽到'}
          </button>

          {(notice || checkInMessage) && (
            <p className="mt-4 rounded border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm font-bold text-emerald-200">
              {notice || checkInMessage}
            </p>
          )}
          {walletError && (
            <p className="mt-4 rounded border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-200">
              {walletError}
            </p>
          )}

          {/* 本月累計簽到月曆 */}
          <div className="mt-8">
            <div className="flex items-baseline justify-between">
              <p className="gold-muted text-xs font-black uppercase tracking-[0.28em]">{monthLabel}簽到月曆</p>
              <p className="text-sm font-bold text-yellow-100/70">
                本月累計 <span className="brand-title font-black">{monthCheckinDays}</span> 天
              </p>
            </div>
            <div className="mt-3 grid grid-cols-7 gap-1.5">
              {Array.from({ length: monthDays }, (_, index) => index + 1).map((day) => {
                const signed = signedDayNumbers.has(day)
                return (
                  <span
                    key={day}
                    className={[
                      'grid h-9 place-items-center rounded text-xs font-black',
                      signed
                        ? 'bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/40'
                        : 'bg-red-950/40 text-yellow-100/40',
                    ].join(' ')}
                  >
                    {day}
                  </span>
                )
              })}
            </div>
          </div>

          {/* 月度累計獎勵 */}
          <div className="mt-8">
            <p className="gold-muted text-xs font-black uppercase tracking-[0.28em]">本月累計獎勵</p>
            {(claimMessage || claimError) && (
              <p
                className={[
                  'mt-3 rounded px-4 py-2 text-sm font-bold',
                  claimError
                    ? 'border border-red-400/30 bg-red-500/10 text-red-200'
                    : 'border border-emerald-400/30 bg-emerald-500/10 text-emerald-200',
                ].join(' ')}
              >
                {claimError || claimMessage}
              </p>
            )}
            <ul className="mt-3 grid gap-2">
              {milestones.map((m) => (
                <li
                  key={m.milestoneDays}
                  className="flex items-center justify-between rounded border border-yellow-200/15 bg-red-950/30 px-4 py-3"
                >
                  <span className="text-sm font-bold text-yellow-100/80">
                    累計 {m.milestoneDays} 天 → {m.rewardAmount.toLocaleString()} 星幣
                  </span>
                  <button
                    type="button"
                    onClick={() => claimReward(m.milestoneDays)}
                    disabled={!m.claimable || claiming}
                    className="gold-button rounded px-4 py-1.5 text-xs font-black transition disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {m.claimed ? '已領取' : m.claimable ? '領取' : '未達標'}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <aside className="luxury-panel-soft rounded p-5">
          <p className="gold-muted text-xs font-black uppercase tracking-[0.28em]">Reward</p>
          <dl className="mt-5 grid gap-4">
            <div>
              <dt className="text-sm font-bold text-yellow-100/62">目前星幣</dt>
              <dd className="brand-title mt-1 text-3xl font-black">{balance.toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-sm font-bold text-yellow-100/62">連續簽到</dt>
              <dd className="mt-1 text-2xl font-black text-yellow-100">
                {consecutiveDays.toLocaleString()} 天
              </dd>
            </div>
            <div>
              <dt className="text-sm font-bold text-yellow-100/62">本月累計</dt>
              <dd className="mt-1 text-2xl font-black text-yellow-100">
                {monthCheckinDays.toLocaleString()} 天
              </dd>
            </div>
          </dl>
        </aside>
      </section>
    </AppShell>
  )
}
