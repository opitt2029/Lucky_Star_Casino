import { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import AppShell from '../components/AppShell'
import MetricCard from '../components/MetricCard'
import { fetchProfile, updateProfile } from '../store/slices/authSlice'
import { mockApi } from '../services/mockApi'
import { dailyCheckIn, setBalance } from '../store/slices/walletSlice'
import {
  getSocialBindings,
  setSocialBinding,
  socialProviders,
} from '../utils/memberPreferences'
import casinoFemaleBlackjackDealer from '../assets/avatars/casino-female-blackjack-dealer.webp'
import casinoFemalePokerAce from '../assets/avatars/casino-female-poker-ace.webp'
import casinoFemaleRouletteHost from '../assets/avatars/casino-female-roulette-host.webp'
import casinoMaleDealer from '../assets/avatars/casino-male-dealer.webp'
import casinoMaleHighRoller from '../assets/avatars/casino-male-high-roller.webp'
import casinoMaleSlotChampion from '../assets/avatars/casino-male-slot-champion.webp'

const MAX_AVATAR_SIZE = 300 * 1024
const allowedAvatarTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
const CHECKIN_DATES_KEY = 'lucky-star-checkin-dates-v1'
const DAILY_CHECKIN_REWARD = 100
const checkInMilestones = [
  { day: 7, bonus: 1000 },
  { day: 14, bonus: 2000 },
  { day: 21, bonus: 3000 },
  { day: 30, bonus: 5000 },
]
const avatarPresets = [
  { id: 'male-dealer', label: '男荷官', src: casinoMaleDealer },
  { id: 'male-high-roller', label: '男貴賓', src: casinoMaleHighRoller },
  { id: 'male-slot-champion', label: '男機台高手', src: casinoMaleSlotChampion },
  { id: 'female-blackjack-dealer', label: '女二十一點荷官', src: casinoFemaleBlackjackDealer },
  { id: 'female-roulette-host', label: '女輪盤主持', src: casinoFemaleRouletteHost },
  { id: 'female-poker-ace', label: '女撲克高手', src: casinoFemalePokerAce },
]

function readAssetAsDataUrl(src) {
  return fetch(src)
    .then((response) => {
      if (!response.ok) throw new Error('Avatar asset failed to load')
      return response.blob()
    })
    .then(
      (blob) =>
        new Promise((resolve, reject) => {
          const reader = new window.FileReader()
          reader.onload = () => resolve(reader.result)
          reader.onerror = reject
          reader.readAsDataURL(blob)
        }),
    )
}

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

function calculateCheckInReward(consecutiveDays) {
  const milestone = checkInMilestones.find((item) => item.day === consecutiveDays)
  return DAILY_CHECKIN_REWARD + (milestone?.bonus || 0)
}

export default function Profile() {
  const dispatch = useDispatch()
  const player = useSelector((state) => state.auth.player)
  const authLoading = useSelector((state) => state.auth.loading)
  const authError = useSelector((state) => state.auth.error)
  const wallet = useSelector((state) => state.wallet)
  const [form, setForm] = useState({ nickname: '', avatarUrl: '' })
  const [friends, setFriends] = useState([])
  const [friendName, setFriendName] = useState('')
  const [giftAmount, setGiftAmount] = useState(500)
  const [notice, setNotice] = useState('')
  const [avatarPreviewError, setAvatarPreviewError] = useState(false)
  const [socialBindings, setSocialBindings] = useState({})
  const [checkInOpen, setCheckInOpen] = useState(false)
  const [checkInDates, setCheckInDates] = useState([])
  const todayKey = getTaipeiDateKey()
  const currentMonthKey = todayKey.slice(0, 7)
  const currentMonthSignedDates = checkInDates.filter((date) => date.startsWith(currentMonthKey))
  const signedDayNumbers = new Set(currentMonthSignedDates.map((date) => Number(date.slice(8, 10))))
  const monthDays = getMonthDays(currentMonthKey)
  const currentConsecutiveDays = wallet.checkIn.consecutiveDays ?? player?.consecutiveCheckInDays ?? 0
  const hasCheckedInToday = checkInDates.includes(todayKey) || player?.lastCheckInDate === todayKey
  const upcomingConsecutiveDays = hasCheckedInToday ? currentConsecutiveDays : currentConsecutiveDays + 1
  const projectedReward = calculateCheckInReward(Math.max(upcomingConsecutiveDays, 1))
  const nextMilestone = checkInMilestones.find((item) => item.day > currentConsecutiveDays)
  const previousMilestoneDay = [...checkInMilestones]
    .reverse()
    .find((item) => item.day <= currentConsecutiveDays)?.day || 0
  const progressTarget = nextMilestone?.day || 30
  const progress = nextMilestone
    ? Math.min(
        ((currentConsecutiveDays - previousMilestoneDay) / (progressTarget - previousMilestoneDay)) * 100,
        100,
      )
    : 100
  const monthLabel = `${Number(currentMonthKey.slice(5, 7))} 月`

  useEffect(() => {
    dispatch(fetchProfile())
    mockApi.getFriends().then(setFriends)
  }, [dispatch])

  useEffect(() => {
    setForm({
      nickname: player?.nickname || '',
      avatarUrl: player?.avatarUrl || '',
    })
    setAvatarPreviewError(false)
    if (player?.id) {
      setSocialBindings(getSocialBindings(player.id))
      const storedDates = getStoredCheckInDates(player.id)
      const seededDates = player.lastCheckInDate
        ? Array.from(new Set([...storedDates, player.lastCheckInDate])).sort()
        : storedDates
      setCheckInDates(seededDates)
    } else {
      setCheckInDates([])
    }
  }, [player])

  const handleChange = (event) => {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }))
  }

  const handleSave = async (event) => {
    event.preventDefault()
    try {
      await dispatch(updateProfile(form)).unwrap()
      setNotice('個人資料已更新')
    } catch {
      setNotice('')
    }
  }

  const handleAvatarFile = (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (!allowedAvatarTypes.includes(file.type)) {
      setNotice('頭像僅支援 JPG、PNG、GIF 或 WebP')
      event.target.value = ''
      return
    }
    if (file.size > MAX_AVATAR_SIZE) {
      setNotice('頭像檔案請小於 300KB')
      event.target.value = ''
      return
    }

    const reader = new window.FileReader()
    reader.onload = () => {
      setForm((current) => ({ ...current, avatarUrl: reader.result }))
      setAvatarPreviewError(false)
      setNotice('頭像已載入，記得儲存設定')
    }
    reader.onerror = () => setNotice('頭像讀取失敗，請重新選擇檔案')
    reader.readAsDataURL(file)
  }

  const handlePickAvatar = async (avatar) => {
    try {
      setNotice('頭像套用中...')
      const avatarUrl = await readAssetAsDataUrl(avatar.src)
      setForm((current) => ({ ...current, avatarUrl }))
      setAvatarPreviewError(false)
      setNotice('已套用頭像預設，記得儲存設定')
    } catch {
      setNotice('頭像預設載入失敗，請重新選擇')
    }
  }

  const handleSocialBinding = (providerId) => {
    if (!player?.id) return
    const nextBound = !socialBindings[providerId]
    setSocialBindings(setSocialBinding(player.id, providerId, nextBound))
    const provider = socialProviders.find((item) => item.id === providerId)
    setNotice(`${provider?.label || '第三方帳戶'}${nextBound ? '已綁定' : '已解除綁定'}`)
  }

  const handleDailyCheckIn = async () => {
    if (!player?.id) return
    try {
      const result = await dispatch(dailyCheckIn()).unwrap()
      const nextDates = saveStoredCheckInDate(player.id, todayKey)
      setCheckInDates(nextDates)
      dispatch(fetchProfile())
      setNotice(
        `簽到成功，連續 ${result.consecutiveDays} 天，獲得 ${result.reward.toLocaleString()} 星幣`,
      )
    } catch (error) {
      setNotice(error || '簽到失敗，請稍後再試')
    }
  }

  const handleAddFriend = async (event) => {
    event.preventDefault()
    try {
      const nextFriends = await mockApi.addFriend(friendName)
      setFriends(nextFriends)
      setFriendName('')
      setNotice('好友已加入')
    } catch (error) {
      setNotice(error.message)
    }
  }

  const handleRemoveFriend = async (friendId) => {
    try {
      const nextFriends = await mockApi.removeFriend(friendId)
      setFriends(nextFriends)
      setNotice('好友已刪除')
    } catch (error) {
      setNotice(error.message)
    }
  }

  const handleGift = async (friendId) => {
    try {
      const result = await mockApi.giftCoins({ friendId, amount: Number(giftAmount) })
      dispatch(setBalance(result.wallet))
      setFriends(result.friends)
      setNotice(`已贈送 ${Number(giftAmount).toLocaleString()} 星幣`)
    } catch (error) {
      setNotice(error.message)
    }
  }

  return (
    <AppShell>
      <section className="grid gap-4 lg:grid-cols-[0.75fr_0.25fr]">
        <form onSubmit={handleSave} className="luxury-panel rounded p-6">
          <p className="gold-muted text-xs font-black uppercase tracking-[0.3em]">Profile</p>
          <h2 className="brand-title mt-3 text-3xl font-black">會員中心</h2>
          <div className="mt-6 grid gap-5 lg:grid-cols-[180px_1fr]">
            <div className="grid content-start gap-3">
              <div className="aspect-square overflow-hidden rounded border border-yellow-200/20 bg-red-950/70">
                {form.avatarUrl && !avatarPreviewError ? (
                  <img
                    src={form.avatarUrl}
                    alt="會員頭像預覽"
                    className="h-full w-full object-cover"
                    onError={() => setAvatarPreviewError(true)}
                  />
                ) : (
                  <div className="grid h-full place-items-center bg-gradient-to-br from-red-900 to-yellow-900/60 text-5xl font-black text-yellow-100">
                    {(form.nickname || player?.username || 'P').slice(0, 1).toUpperCase()}
                  </div>
                )}
              </div>
              <label className="red-gold-button cursor-pointer rounded px-4 py-3 text-center text-sm font-black transition">
                上傳頭像
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  className="sr-only"
                  onChange={handleAvatarFile}
                />
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm font-bold text-yellow-100/78">
                玩家 ID
                <input
                  className="rounded border border-yellow-200/15 bg-red-950/70 px-4 py-3 text-white outline-none focus:border-yellow-200"
                  value={player?.id || 'demo-player'}
                  readOnly
                />
              </label>
              <label className="grid gap-2 text-sm font-bold text-yellow-100/78">
                暱稱
                <input
                  name="nickname"
                  className="rounded border border-yellow-200/15 bg-red-950/70 px-4 py-3 text-white outline-none focus:border-yellow-200"
                  value={form.nickname}
                  onChange={handleChange}
                  required
                />
              </label>

              <div className="sm:col-span-2">
                <p className="text-sm font-bold text-yellow-100/78">快速頭像</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {avatarPresets.map((avatar) => (
                    <button
                      key={avatar.id}
                      type="button"
                      onClick={() => handlePickAvatar(avatar)}
                      className="h-16 w-16 overflow-hidden rounded border border-yellow-200/15 bg-red-950/70 transition hover:-translate-y-0.5 hover:border-yellow-200 focus:outline-none focus:ring-2 focus:ring-yellow-200/70"
                      aria-label={`套用${avatar.label}頭像預設`}
                    >
                      <img src={avatar.src} alt="" className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
          {authError && (
            <p className="mt-4 rounded border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-200">
              {authError}
            </p>
          )}
          {notice && (
            <p className="mt-4 rounded border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm font-bold text-emerald-200">
              {notice}
            </p>
          )}
          <button
            type="submit"
            disabled={authLoading}
            className="gold-button mt-6 rounded px-5 py-3 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-60"
          >
            {authLoading ? '儲存中...' : '儲存設定'}
          </button>
        </form>

        <aside className="grid gap-4 content-start">
          <MetricCard
            label="可用籌碼"
            value={wallet.balance.toLocaleString()}
            tone="light"
          />
          <MetricCard
            label="凍結籌碼"
            value={wallet.frozenAmount.toLocaleString()}
            caption="下注中保留"
          />
          <div className="relative">
            <button
              type="button"
              onClick={() => setCheckInOpen((open) => !open)}
              className="luxury-panel-soft w-full rounded p-4 text-left transition hover:border-yellow-200/40"
              aria-expanded={checkInOpen}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="gold-muted text-xs font-black uppercase tracking-[0.25em]">Check-in</p>
                  <p className="brand-title mt-2 text-2xl font-black">{currentConsecutiveDays} 天</p>
                </div>
                <span className="gold-button rounded px-2 py-1 text-xs font-black">
                  {checkInOpen ? '收合' : '查看'}
                </span>
              </div>
              <div className="mt-4 h-3 overflow-hidden rounded bg-red-950/70">
                <div
                  className="h-full bg-yellow-200 transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="gold-muted mt-2 text-xs font-bold">
                本月已簽到 {currentMonthSignedDates.length} 天
              </p>
            </button>

            {checkInOpen && (
              <section className="luxury-panel absolute right-0 top-[calc(100%+0.75rem)] z-20 w-[min(23rem,calc(100vw-2rem))] rounded p-4 shadow-2xl">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="gold-muted text-xs font-black uppercase tracking-[0.25em]">
                      Monthly Check-in
                    </p>
                    <h3 className="brand-title mt-1 text-xl font-black">{monthLabel}簽到獎勵</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCheckInOpen(false)}
                    className="red-gold-button rounded px-3 py-2 text-xs font-black"
                  >
                    關閉
                  </button>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <div className="rounded border border-yellow-200/15 bg-red-950/70 p-3">
                    <p className="gold-muted text-xs font-bold">本月天數</p>
                    <p className="mt-1 text-2xl font-black text-yellow-100">
                      {currentMonthSignedDates.length}
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
                      : `立即簽到領 ${projectedReward.toLocaleString()}`}
                </button>

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

                <div className="mt-4 grid gap-2">
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

                {wallet.error && (
                  <p className="mt-3 rounded border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-200">
                    {wallet.error}
                  </p>
                )}
              </section>
            )}
          </div>
        </aside>
      </section>

      <section className="luxury-panel-soft mt-6 rounded p-6">
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
          <div>
            <p className="gold-muted text-xs font-black uppercase tracking-[0.3em]">
              Linked Accounts
            </p>
            <h2 className="brand-title mt-1 text-2xl font-black">第三方帳戶綁定</h2>
          </div>
          <p className="max-w-xl text-sm font-bold leading-6 text-yellow-100/62">
            綁定後可在登入頁選擇 LINE、Google 或 Apple 入口；目前以前端偏好設定保存綁定狀態。
          </p>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          {socialProviders.map((provider) => {
            const bound = Boolean(socialBindings[provider.id])
            return (
              <div key={provider.id} className={`rounded border p-4 ${provider.accentClass}`}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-lg font-black">{provider.label}</p>
                    <p className="mt-1 text-xs font-bold opacity-75">
                      {bound ? '已綁定，可作為登入方式' : '尚未綁定'}
                    </p>
                  </div>
                  <span className="grid h-10 w-10 place-items-center rounded-full border border-current/30 text-sm font-black">
                    {provider.label.slice(0, 1)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleSocialBinding(provider.id)}
                  className={
                    bound
                      ? 'red-gold-button mt-4 w-full rounded px-4 py-3 text-sm font-black'
                      : 'gold-button mt-4 w-full rounded px-4 py-3 text-sm font-black'
                  }
                >
                  {bound ? '解除綁定' : '綁定帳戶'}
                </button>
              </div>
            )
          })}
        </div>
      </section>

      <section className="luxury-panel-soft mt-6 rounded p-6">
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
          <div>
            <p className="gold-muted text-xs font-black uppercase tracking-[0.3em]">Friends</p>
            <h2 className="brand-title mt-1 text-2xl font-black">好友列表</h2>
          </div>
          <form onSubmit={handleAddFriend} className="flex gap-2">
            <input
              className="min-h-11 rounded border border-yellow-200/15 bg-red-950/70 px-4 text-sm font-bold text-white outline-none focus:border-yellow-200"
              placeholder="輸入好友帳號"
              value={friendName}
              onChange={(event) => setFriendName(event.target.value)}
              required
            />
            <button
              type="submit"
              className="gold-button rounded px-4 py-2 text-sm font-black transition"
            >
              加好友
            </button>
          </form>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {friends.map((friend) => (
            <div key={friend.id} className="rounded border border-yellow-200/15 bg-red-950/70 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-lg font-black text-yellow-100">{friend.nickname}</p>
                  <p className="gold-muted text-sm font-bold">{friend.username}</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveFriend(friend.id)}
                  className="red-gold-button rounded px-3 py-2 text-sm font-bold"
                >
                  刪除
                </button>
              </div>
              <div className="mt-4 grid grid-cols-[1fr_auto] gap-2">
                <input
                  type="number"
                  min="100"
                  step="100"
                  className="min-h-11 rounded border border-yellow-200/15 bg-red-950/80 px-3 text-sm font-bold text-white outline-none focus:border-yellow-200"
                  value={giftAmount}
                  onChange={(event) => setGiftAmount(event.target.value)}
                />
                <button
                  type="button"
                  onClick={() => handleGift(friend.id)}
                  className="gold-button rounded px-4 py-2 text-sm font-black transition"
                >
                  贈送
                </button>
              </div>
            </div>
          ))}
          {friends.length === 0 && (
            <p className="rounded border border-yellow-200/15 bg-red-950/70 p-5 text-sm font-bold text-yellow-100/56">
              目前尚無好友
            </p>
          )}
        </div>
      </section>
    </AppShell>
  )
}
