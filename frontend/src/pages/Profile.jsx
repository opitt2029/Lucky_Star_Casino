import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useDispatch, useSelector } from 'react-redux'
import AppShell from '../components/AppShell'
import MetricCard from '../components/MetricCard'
import { fetchProfile, updateProfile } from '../store/slices/authSlice'
import { useDailyCheckIn } from '../hooks/useDailyCheckIn'
import { socialProviders } from '../utils/memberPreferences'
import SocialProviderIcon from '../components/SocialProviderIcon'
import { memberApi } from '../services/memberApi'
import casinoFemaleBlackjackDealer from '../assets/avatars/casino-female-blackjack-dealer.webp'
import casinoFemalePokerAce from '../assets/avatars/casino-female-poker-ace.webp'
import casinoFemaleRouletteHost from '../assets/avatars/casino-female-roulette-host.webp'
import casinoMaleDealer from '../assets/avatars/casino-male-dealer.webp'
import casinoMaleHighRoller from '../assets/avatars/casino-male-high-roller.webp'
import casinoMaleSlotChampion from '../assets/avatars/casino-male-slot-champion.webp'

const MAX_AVATAR_SIZE = 300 * 1024
const allowedAvatarTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
const checkInMilestones = [
  { day: 7, bonus: 1000 },
  { day: 14, bonus: 2000 },
  { day: 21, bonus: 3000 },
  { day: 30, bonus: 5000 },
]
const avatarPresets = [
  { id: 'male-dealer', label: '男性荷官', src: casinoMaleDealer },
  { id: 'male-high-roller', label: '豪客玩家', src: casinoMaleHighRoller },
  { id: 'male-slot-champion', label: '老虎機冠軍', src: casinoMaleSlotChampion },
  { id: 'female-blackjack-dealer', label: '黑傑克女荷官', src: casinoFemaleBlackjackDealer },
  { id: 'female-roulette-host', label: '輪盤主持人', src: casinoFemaleRouletteHost },
  { id: 'female-poker-ace', label: '撲克高手', src: casinoFemalePokerAce },
]

function readAssetAsDataUrl(src) {
  return fetch(src)
    .then((response) => {
      if (!response.ok) throw new Error('頭像載入失敗')
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

export default function Profile() {
  const dispatch = useDispatch()
  const player = useSelector((state) => state.auth.player)
  const authLoading = useSelector((state) => state.auth.loading)
  const authError = useSelector((state) => state.auth.error)
  const wallet = useSelector((state) => state.wallet)
  const [form, setForm] = useState({ nickname: '', avatarUrl: '' })
  const [notice, setNotice] = useState('')
  const [avatarPreviewError, setAvatarPreviewError] = useState(false)
  const [socialBindings, setSocialBindings] = useState({})
  const [socialBindingsLoading, setSocialBindingsLoading] = useState(false)
  const [checkInOpen, setCheckInOpen] = useState(false)
  const checkin = useDailyCheckIn()
  const {
    monthDays,
    monthLabel,
    signedDayNumbers,
    monthCheckinDays,
    consecutiveDays: currentConsecutiveDays,
    hasCheckedInToday,
    projectedReward,
    milestones,
  } = checkin
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

  useEffect(() => {
    dispatch(fetchProfile())
  }, [dispatch])

  useEffect(() => {
    setForm({
      nickname: player?.nickname || '',
      avatarUrl: player?.avatarUrl || '',
    })
    setAvatarPreviewError(false)
    if (player?.id) {
      let active = true
      setSocialBindingsLoading(true)
      memberApi.getSocialBindings()
        .then((bindings) => {
          if (!active) return
          setSocialBindings(Object.fromEntries((bindings || []).map((item) => [item.provider, item])))
        })
        .catch(() => {
          if (active) setNotice('第三方帳戶綁定狀態暫時無法載入')
        })
        .finally(() => {
          if (active) setSocialBindingsLoading(false)
        })
      return () => { active = false }
    }
  }, [player])

  const handleChange = (event) => {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }))
  }

  const handleSave = async (event) => {
    event.preventDefault()
    try {
      await dispatch(updateProfile(form)).unwrap()
      setNotice('會員資料已更新')
    } catch {
      setNotice('會員資料更新失敗，請稍後再試')
    }
  }

  const handleAvatarFile = (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (!allowedAvatarTypes.includes(file.type)) {
      setNotice('頭像格式限 JPG、PNG、GIF 或 WebP')
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
      setNotice('頭像已載入，請記得儲存變更')
    }
    reader.onerror = () => setNotice('頭像讀取失敗，請重新選擇檔案')
    reader.readAsDataURL(file)
  }

  const handlePickAvatar = async (avatar) => {
    try {
      setNotice('正在套用預設頭像...')
      const avatarUrl = await readAssetAsDataUrl(avatar.src)
      setForm((current) => ({ ...current, avatarUrl }))
      setAvatarPreviewError(false)
      setNotice('已套用預設頭像，請記得儲存變更')
    } catch {
      setNotice('預設頭像載入失敗，請稍後再試')
    }
  }

  const handleDailyCheckIn = async () => {
    const result = await checkin.checkInToday()
    if (result) {
      setNotice(
        `簽到成功：連續 ${result.consecutiveDays} 天，獲得 ${result.reward.toLocaleString()} 星幣`,
      )
    } else {
      setNotice('簽到失敗，請稍後再試')
    }
  }

  return (
    <AppShell>
      <section className="grid gap-4 lg:grid-cols-[0.75fr_0.25fr]">
        <form onSubmit={handleSave} className="luxury-panel rounded p-6">
          <p className="gold-muted text-xs font-black uppercase tracking-[0.3em]">Profile</p>
          <h2 className="brand-title mt-3 text-3xl font-black">會員資料</h2>
          <div className="mt-6 grid gap-5 md:grid-cols-[160px_1fr] lg:grid-cols-[180px_1fr]">
            <div className="grid w-full max-w-[180px] content-start gap-3 justify-self-center md:max-w-none md:justify-self-auto">
              <div className="aspect-square overflow-hidden rounded border border-yellow-200/20 bg-red-950/70">
                {form.avatarUrl && !avatarPreviewError ? (
                  <img
                    src={form.avatarUrl}
                    alt="會員頭像"
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
                <p className="text-sm font-bold text-yellow-100/78">預設頭像</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {avatarPresets.map((avatar) => (
                    <button
                      key={avatar.id}
                      type="button"
                      onClick={() => handlePickAvatar(avatar)}
                      className="h-16 w-16 overflow-hidden rounded border border-yellow-200/15 bg-red-950/70 transition hover:-translate-y-0.5 hover:border-yellow-200 focus:outline-none focus:ring-2 focus:ring-yellow-200/70"
                      aria-label={`選擇 ${avatar.label} 頭像`}
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
            {authLoading ? '儲存中...' : '儲存變更'}
          </button>
        </form>

        <aside className="grid gap-4 content-start">
          <MetricCard
            label="可用星幣"
            value={wallet.balance.toLocaleString()}
            tone="light"
          />
          <MetricCard
            label="凍結星幣"
            value={wallet.frozenAmount.toLocaleString()}
            caption="下注或結算中的暫扣金額"
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
                本月已簽到 {monthCheckinDays} 天
              </p>
            </button>

            {checkInOpen && (
              <section className="luxury-panel absolute right-0 top-[calc(100%+0.75rem)] z-20 w-[min(23rem,calc(100vw-2rem))] rounded p-4 shadow-2xl">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="gold-muted text-xs font-black uppercase tracking-[0.25em]">
                      Monthly Check-in
                    </p>
                    <h3 className="brand-title mt-1 text-xl font-black">{monthLabel} 簽到獎勵</h3>
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
                      {monthCheckinDays}
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
                      : `立即簽到 +${projectedReward.toLocaleString()}`}
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

                <p className="mt-4 gold-muted text-xs font-black uppercase tracking-[0.25em]">本月里程碑</p>
                {(checkin.claimMessage || checkin.claimError) && (
                  <p
                    className={[
                      'mt-2 rounded px-3 py-2 text-xs font-bold',
                      checkin.claimError
                        ? 'border border-red-400/30 bg-red-500/10 text-red-200'
                        : 'border border-emerald-400/30 bg-emerald-500/10 text-emerald-200',
                    ].join(' ')}
                  >
                    {checkin.claimError || checkin.claimMessage}
                  </p>
                )}
                <div className="mt-2 grid gap-2">
                  {milestones.map((m) => (
                    <div
                      key={m.milestoneDays}
                      className="flex items-center justify-between rounded border border-yellow-200/15 bg-red-950/70 px-3 py-2 text-sm"
                    >
                      <span className={m.reached ? 'font-black text-yellow-100' : 'font-bold text-yellow-100/62'}>
                        累積 {m.milestoneDays} 天
                        <span className="ml-2 font-black text-yellow-200">+{m.rewardAmount.toLocaleString()}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => checkin.claimReward(m.milestoneDays)}
                        disabled={!m.claimable || checkin.claiming}
                        className="gold-button rounded px-3 py-1 text-xs font-black transition disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {m.claimed ? '已領取' : m.claimable ? '領取' : '未達成'}
                      </button>
                    </div>
                  ))}
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
            綁定 LINE、Google 或 Apple，之後可更快完成登入與帳戶驗證。點選任一服務會前往專屬綁定畫面。
          </p>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          {socialProviders.map((provider) => {
            const binding = socialBindings[provider.id]
            const bound = Boolean(binding?.bound)
            return (
              <div
                key={provider.id}
                className={`rounded border p-4 transition hover:-translate-y-0.5 hover:border-yellow-200/60 ${provider.accentClass} ${provider.glowClass}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-lg font-black">{provider.label}</p>
                    <p className="mt-1 text-xs font-bold opacity-75">
                      {socialBindingsLoading
                        ? '同步狀態中'
                        : bound
                          ? `已綁定 ${binding.maskedAccountId || ''}`
                          : '尚未綁定'}
                    </p>
                  </div>
                  <SocialProviderIcon provider={provider.id} className="h-14 w-14 drop-shadow-xl" />
                </div>
                <Link
                  to={`/profile/social-bindings/${provider.id}`}
                  className={
                    bound
                      ? 'red-gold-button mt-4 block w-full rounded px-4 py-3 text-center text-sm font-black'
                      : 'gold-button mt-4 block w-full rounded px-4 py-3 text-center text-sm font-black'
                  }
                >
                  {bound ? '管理綁定' : '前往綁定'}
                </Link>
              </div>
            )
          })}
        </div>
      </section>
    </AppShell>
  )
}