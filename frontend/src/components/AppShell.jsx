import { NavLink, useNavigate } from 'react-router-dom'
import { useDispatch, useSelector } from 'react-redux'
import { lazy, Suspense, useEffect, useState } from 'react'
import ErrorBoundary from './ErrorBoundary'
import { fetchProfile, logoutMember } from '../store/slices/authSlice'
import { clearNotifications } from '../store/slices/gameSlice'
import { fetchRanks } from '../store/slices/rankSlice'
import { dailyCheckIn, fetchWallet } from '../store/slices/walletSlice'
import { getBackgroundStyle } from '../theme/backgroundTheme'
import CoinRain from './CoinRain'

const navItems = [
  { to: '/', label: '首頁' },
  { to: '/games', label: '遊戲大全' },
  { to: '/shop', label: '賭場商城' },
  { to: '/rank', label: '排行榜' },
  { to: '/transactions', label: '交易紀錄' },
  { to: '/profile', label: '會員中心' },
]

const RealtimeBridge = lazy(() => import('./RealtimeBridge'))
const CHECKIN_DATES_KEY = 'lucky-star-checkin-dates-v1'
const CHECKIN_AUTO_OPEN_KEY = 'lucky-star-checkin-auto-open-v1'
const DAILY_CHECKIN_REWARD = 100
const checkInMilestones = [
  { day: 7, bonus: 1000 },
  { day: 14, bonus: 2000 },
  { day: 21, bonus: 3000 },
  { day: 30, bonus: 5000 },
]

function readJson(key, fallback) {
  try {
    const value = localStorage.getItem(key)
    return value ? JSON.parse(value) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value))
}

function getTaipeiDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${value.year}-${value.month}-${value.day}`
}

function getMonthDays(monthKey) {
  const [year, month] = monthKey.split('-').map(Number)
  return new Date(year, month, 0).getDate()
}

function getStoredCheckInDates(playerId) {
  const allDates = readJson(CHECKIN_DATES_KEY, {})
  return Array.isArray(allDates[playerId]) ? allDates[playerId] : []
}

function saveStoredCheckInDate(playerId, dateKey) {
  const allDates = readJson(CHECKIN_DATES_KEY, {})
  const nextDates = Array.from(new Set([...(allDates[playerId] || []), dateKey])).sort()
  writeJson(CHECKIN_DATES_KEY, { ...allDates, [playerId]: nextDates })
  return nextDates
}

function hasAutoOpenedCheckIn(playerId, dateKey) {
  const openedDates = readJson(CHECKIN_AUTO_OPEN_KEY, {})
  return openedDates[playerId] === dateKey
}

function markAutoOpenedCheckIn(playerId, dateKey) {
  const openedDates = readJson(CHECKIN_AUTO_OPEN_KEY, {})
  writeJson(CHECKIN_AUTO_OPEN_KEY, { ...openedDates, [playerId]: dateKey })
}

function calculateCheckInReward(consecutiveDays) {
  const milestone = checkInMilestones.find((item) => item.day === consecutiveDays)
  return DAILY_CHECKIN_REWARD + (milestone?.bonus || 0)
}

export default function AppShell({ children }) {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const [noticeOpen, setNoticeOpen] = useState(false)
  const [isScrolled, setIsScrolled] = useState(false)
  const [avatarFailed, setAvatarFailed] = useState(false)
  const [checkInModalOpen, setCheckInModalOpen] = useState(false)
  const [checkInDates, setCheckInDates] = useState([])
  const [checkInDatesReady, setCheckInDatesReady] = useState(false)
  const player = useSelector((state) => state.auth.player)
  const wallet = useSelector((state) => state.wallet)
  const balance = wallet.balance
  const notifications = useSelector((state) => state.game.notifications)
  const playerName = player?.nickname || player?.username || 'Demo Player'
  const canShowAvatar = player?.avatarUrl && !avatarFailed
  const todayKey = getTaipeiDateKey()
  const currentMonthKey = todayKey.slice(0, 7)
  const monthDays = getMonthDays(currentMonthKey)
  const currentMonthSignedDates = checkInDates.filter((date) => date.startsWith(currentMonthKey))
  const signedDayNumbers = new Set(currentMonthSignedDates.map((date) => Number(date.slice(8, 10))))
  const currentConsecutiveDays = wallet.checkIn.consecutiveDays ?? player?.consecutiveCheckInDays ?? 0
  const hasCheckedInToday = checkInDates.includes(todayKey) || player?.lastCheckInDate === todayKey
  const upcomingConsecutiveDays = hasCheckedInToday ? currentConsecutiveDays : currentConsecutiveDays + 1
  const projectedReward = calculateCheckInReward(Math.max(upcomingConsecutiveDays, 1))
  const monthLabel = `${Number(currentMonthKey.slice(5, 7))} 月`
  const checkInDismissLabel = hasCheckedInToday || wallet.checkIn.message ? '關閉' : '稍後'

  useEffect(() => {
    dispatch(fetchWallet())
    dispatch(fetchRanks())
  }, [dispatch])

  useEffect(() => {
    setAvatarFailed(false)
  }, [player?.avatarUrl])

  useEffect(() => {
    if (!player?.id) {
      setCheckInDates([])
      setCheckInDatesReady(false)
      return
    }
    const storedDates = getStoredCheckInDates(player.id)
    const seededDates = player.lastCheckInDate
      ? Array.from(new Set([...storedDates, player.lastCheckInDate])).sort()
      : storedDates
    setCheckInDates(seededDates)
    setCheckInDatesReady(true)
  }, [player])

  useEffect(() => {
    if (
      !player?.id ||
      !checkInDatesReady ||
      hasCheckedInToday ||
      hasAutoOpenedCheckIn(player.id, todayKey)
    ) {
      return
    }
    setCheckInModalOpen(true)
    markAutoOpenedCheckIn(player.id, todayKey)
  }, [checkInDatesReady, hasCheckedInToday, player?.id, todayKey])

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 18)
    }

    handleScroll()
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  const handleLogout = () => {
    dispatch(logoutMember()).finally(() => navigate('/member'))
  }

  const handleDailyCheckIn = async () => {
    if (!player?.id) return
    try {
      const result = await dispatch(dailyCheckIn()).unwrap()
      const nextDates = saveStoredCheckInDate(player.id, todayKey)
      setCheckInDates(nextDates)
      dispatch(fetchProfile())
      dispatch(fetchWallet())
      return result
    } catch {
      return null
    }
  }

  return (
    <div className="theme-background min-h-screen text-zinc-50" style={getBackgroundStyle('app')}>
      <CoinRain />
      <ErrorBoundary>
        <Suspense fallback={null}>
          <RealtimeBridge />
        </Suspense>
      </ErrorBoundary>

      <header
        className={[
          'sticky top-0 z-30 border-b backdrop-blur transition-all duration-500',
          isScrolled ? 'scrolled-header border-yellow-200/30 py-0' : 'border-yellow-200/15 bg-red-950/82',
        ].join(' ')}
      >
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
            <div>
              <p className="gold-muted text-xs uppercase tracking-[0.35em]">Lucky Star Casino</p>
              <h1 className="brand-title mt-1 text-2xl font-black tracking-tight">幸運星幣城</h1>
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm sm:flex sm:items-center">
              <div className="gold-button flex min-w-0 items-center gap-3 rounded px-3 py-2">
                <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full border border-red-950/20 bg-red-950/18 text-sm font-black text-red-950">
                  {canShowAvatar ? (
                    <img
                      src={player.avatarUrl}
                      alt={`${playerName} 頭像`}
                      className="h-full w-full object-cover"
                      onError={() => setAvatarFailed(true)}
                    />
                  ) : (
                    playerName.slice(0, 1).toUpperCase()
                  )}
                </span>
                <span className="min-w-0 truncate font-black">{playerName}</span>
              </div>
              <div className="luxury-panel-soft rounded px-4 py-2">
                <span className="gold-muted block text-[11px] font-bold uppercase">籌碼</span>
                <span className="font-black">{balance.toLocaleString()}</span>
              </div>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setNoticeOpen((open) => !open)}
                  className="red-gold-button relative grid h-full min-h-12 w-full place-items-center rounded px-4 py-2 transition sm:w-12"
                  aria-label="通知中心"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
                    <path d="M13.7 21a2 2 0 0 1-3.4 0" />
                  </svg>
                  {notifications.length > 0 && (
                    <span className="absolute right-2 top-1 grid h-5 min-w-5 place-items-center rounded-full bg-yellow-200 px-1 text-[11px] font-black text-red-950">
                      {notifications.length}
                    </span>
                  )}
                </button>
                {noticeOpen && (
                  <div className="luxury-panel absolute right-0 top-14 z-40 w-80 rounded p-3 shadow-2xl">
                    <div className="flex items-center justify-between">
                      <p className="gold-text text-sm font-black">通知中心</p>
                      <button
                        type="button"
                        onClick={() => dispatch(clearNotifications())}
                        className="red-gold-button rounded px-2 py-1 text-xs font-bold"
                      >
                        清空
                      </button>
                    </div>
                    <div className="mt-3 grid max-h-80 gap-2 overflow-auto">
                      {notifications.length === 0 ? (
                        <p className="rounded bg-red-950/70 p-3 text-sm text-yellow-100/60">目前沒有新通知</p>
                      ) : (
                        notifications.map((item) => (
                          <div key={item.id || item.createdAt} className="rounded border border-yellow-200/15 bg-red-950/70 p-3">
                            <p className="text-sm font-black text-yellow-100">{item.title || '系統通知'}</p>
                            <p className="mt-1 text-xs leading-5 text-yellow-100/64">{item.message || '已收到新的即時事件'}</p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={handleLogout}
                className="red-gold-button rounded px-4 py-2 text-sm font-bold transition"
              >
                登出
              </button>
            </div>
          </div>

          <nav className="flex gap-2 overflow-x-auto pb-1">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  [
                    'shrink-0 rounded px-4 py-2 text-sm font-bold transition',
                    isActive
                      ? 'gold-button'
                      : 'border border-yellow-200/15 bg-red-950/70 text-yellow-100/72 hover:border-yellow-200/50 hover:text-yellow-100',
                  ].join(' ')
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>

      {checkInModalOpen && (
        <section
          className="fixed inset-0 z-50 grid place-items-center bg-red-950/72 px-4 py-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="daily-checkin-title"
        >
          <div className="luxury-panel max-h-[calc(100vh-3rem)] w-full max-w-lg overflow-auto rounded p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="gold-muted text-xs font-black uppercase tracking-[0.25em]">
                  Daily Check-in
                </p>
                <h2 id="daily-checkin-title" className="brand-title mt-1 text-2xl font-black">
                  {monthLabel}簽到獎勵
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setCheckInModalOpen(false)}
                className="red-gold-button rounded px-3 py-2 text-xs font-black"
              >
                {checkInDismissLabel}
              </button>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-2">
              <div className="rounded border border-yellow-200/15 bg-red-950/70 p-3">
                <p className="gold-muted text-xs font-bold">本月簽到</p>
                <p className="mt-1 text-2xl font-black text-yellow-100">
                  {currentMonthSignedDates.length}
                  <span className="ml-1 text-sm text-yellow-100/60">天</span>
                </p>
              </div>
              <div className="rounded border border-yellow-200/15 bg-red-950/70 p-3">
                <p className="gold-muted text-xs font-bold">連續天數</p>
                <p className="mt-1 text-2xl font-black text-yellow-100">
                  {currentConsecutiveDays}
                  <span className="ml-1 text-sm text-yellow-100/60">天</span>
                </p>
              </div>
              <div className="rounded border border-yellow-200/15 bg-red-950/70 p-3">
                <p className="gold-muted text-xs font-bold">今日可領</p>
                <p className="mt-1 text-2xl font-black text-yellow-100">
                  {hasCheckedInToday ? 0 : projectedReward.toLocaleString()}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleDailyCheckIn}
              disabled={wallet.checkIn.loading || hasCheckedInToday}
              className="gold-button mt-4 w-full rounded px-4 py-3 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-55"
            >
              {wallet.checkIn.loading
                ? '簽到中...'
                : hasCheckedInToday
                  ? '今日已簽到'
                  : `確認簽到領 ${projectedReward.toLocaleString()}`}
            </button>

            {wallet.checkIn.message && (
              <p className="mt-3 rounded border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-sm font-bold text-emerald-200">
                {wallet.checkIn.message}
              </p>
            )}
            {wallet.error && (
              <p className="mt-3 rounded border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm font-bold text-red-200">
                {wallet.error}
              </p>
            )}

            <div className="mt-4 grid grid-cols-7 gap-1">
              {Array.from({ length: monthDays }, (_, index) => {
                const day = index + 1
                const signed = signedDayNumbers.has(day)
                return (
                  <span
                    key={day}
                    className={
                      signed
                        ? 'grid h-8 place-items-center rounded bg-yellow-200 text-xs font-black text-red-950'
                        : 'grid h-8 place-items-center rounded border border-yellow-200/10 bg-red-950/60 text-xs font-bold text-yellow-100/54'
                    }
                  >
                    {day}
                  </span>
                )
              })}
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {checkInMilestones.map((item) => {
                const reached = currentConsecutiveDays >= item.day
                return (
                  <div
                    key={item.day}
                    className="flex items-center justify-between rounded border border-yellow-200/15 bg-red-950/70 px-3 py-2 text-sm"
                  >
                    <span className={reached ? 'font-black text-yellow-100' : 'font-bold text-yellow-100/62'}>
                      連續 {item.day} 天
                    </span>
                    <span className="font-black text-yellow-200">+{item.bonus.toLocaleString()}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
