import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useDispatch, useSelector } from 'react-redux'
import AppShell from '../components/AppShell'
import MetricCard from '../components/MetricCard'
import { fetchProfile, updateProfile } from '../store/slices/authSlice'
import { useDailyCheckIn } from '../hooks/useDailyCheckIn'
import { socialProviders } from '../utils/memberPreferences'
import SocialProviderIcon from '../components/SocialProviderIcon'
import { memberApi, extractError } from '../services/memberApi'
import { gameApi } from '../services/gameApi'
import { avatarPresets } from '../data/avatarPresets'

const text = {
  profile: '會員個人頁',
  subtitle: '管理公開暱稱、頭像，以及需要密碼保護的基本資訊。',
  avatar: '頭像',
  upload: '上傳頭像',
  preset: '快速選擇頭像',
  playerId: '會員 ID',
  nickname: '暱稱',
  savePublic: '儲存公開資料',
  saveSettings: '儲存設定',
  saving: '儲存中...',
  balance: '目前星幣',
  frozen: '凍結星幣',
  security: '帳戶安全',
  securityHint: '基本資訊需要再次輸入密碼才能查看與修改，降低共用裝置上的資料外露風險。',
  basic: '基本資訊',
  settingsButton: '設定基本資訊',
  lockedHint: '尚未輸入密碼確認前，個人敏感資訊會維持遮罩或狀態摘要顯示。',
  password: '請輸入密碼',
  unlock: '確認並進入設定',
  unlocking: '確認中...',
  close: '關閉',
  name: '姓名',
  birthday: '生日',
  gender: '性別',
  address: '住址',
  walletPayment: '錢包支付設定',
  immutable: '姓名與生日只能在註冊時設定，若需修正請聯繫客服。',
  settingsSaved: '基本資訊設定已更新。',
  settingsFailed: '設定更新失敗，請確認密碼或稍後再試。',
  publicSaved: '公開資料已更新。',
  publicFailed: '公開資料更新失敗。',
  hidden: '*********',
  linked: '第三方帳號綁定',
  linkedCopy: '綁定 LINE、Google 或 Apple 後，可用第三方帳號快速登入並保留同一個錢包。',
  bound: '已綁定',
  unbound: '尚未綁定',
  manage: '管理綁定',
  bind: '前往綁定',
  checkin: '簽到進度',
  days: '天',
  todayDone: '今日已完成簽到',
  todayTodo: '今日尚未簽到',
  complete: '資料完整度',
  unavailable: '未設定',
  configured: '已設定',
  unlocked: '密碼已確認，現在可以調整基本資訊。',
}

const MAX_AVATAR_SIZE = 300 * 1024
const allowedAvatarTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
const genderLabels = { MALE: '男', FEMALE: '女', PREFER_NOT_TO_SAY: '不公開' }
const paymentLabels = { STAR_COIN: '星幣優先', DIAMOND: '鑽石優先', ASK_EVERY_TIME: '每次詢問' }
const genderOptions = [
  { value: 'MALE', label: genderLabels.MALE },
  { value: 'FEMALE', label: genderLabels.FEMALE },
  { value: 'PREFER_NOT_TO_SAY', label: genderLabels.PREFER_NOT_TO_SAY },
]
const paymentOptions = [
  { value: 'STAR_COIN', label: paymentLabels.STAR_COIN },
  { value: 'DIAMOND', label: paymentLabels.DIAMOND },
  { value: 'ASK_EVERY_TIME', label: paymentLabels.ASK_EVERY_TIME },
]
const PROFILE_GAME_FETCH_CAP = 200
const GAME_PLAY_ESTIMATES_MS = {
  SLOT: 30 * 1000,
  BACCARAT: 45 * 1000,
  FISHING: 3 * 60 * 1000,
}
const gameProfiles = [
  { key: 'SLOT', label: '星幣老虎機', focus: '連線倍率' },
  { key: 'BACCARAT', label: '百家樂', focus: '牌桌策略' },
  { key: 'FISHING', label: '龍王捕魚機', focus: '深海狩獵' },
]
const readOnlyInputClass = 'min-h-[3.75rem] rounded border border-yellow-200/15 bg-red-950/70 px-4 py-3 text-base font-black text-yellow-100/60 outline-none'
const textInputClass = 'min-h-[3.75rem] rounded border border-yellow-200/20 bg-red-950/75 px-5 py-3 text-base font-black text-yellow-50 outline-none transition placeholder:text-yellow-100/35 hover:border-yellow-200/45 focus:border-yellow-200 focus:ring-2 focus:ring-yellow-200/25'
const dropdownButtonClass = 'flex min-h-[3.75rem] w-full items-center justify-between gap-3 rounded border border-yellow-200/30 bg-[radial-gradient(circle_at_18%_0%,rgba(255,229,150,.14),transparent_28%),linear-gradient(135deg,rgba(74,8,13,.98),rgba(128,22,18,.95))] px-5 py-3 text-left text-base font-black text-yellow-50 shadow-[inset_0_0_0_1px_rgba(255,226,145,.08),0_12px_30px_rgba(0,0,0,.24)] outline-none transition hover:border-yellow-200/65 hover:shadow-[inset_0_0_0_1px_rgba(255,226,145,.14),0_14px_34px_rgba(0,0,0,.28)] focus:border-yellow-200 focus:ring-2 focus:ring-yellow-200/30'
const dropdownMenuClass = 'absolute left-0 right-0 top-[calc(100%+.45rem)] z-30 overflow-hidden rounded border border-yellow-200/25 bg-red-950/95 p-1 shadow-[0_18px_48px_rgba(0,0,0,.42)] backdrop-blur-md'
const dropdownOptionClass = 'w-full rounded px-4 py-3 text-left text-sm font-black text-yellow-100 transition hover:bg-yellow-200/12 focus:bg-yellow-200/12 focus:outline-none'
const dropdownOptionActiveClass = 'bg-yellow-200/18 text-yellow-50 shadow-[inset_3px_0_0_rgba(255,226,145,.9)]'

function readAssetAsDataUrl(src) {
  return fetch(src)
    .then((response) => {
      if (!response.ok) throw new Error('avatar load failed')
      return response.blob()
    })
    .then((blob) => new Promise((resolve, reject) => {
      const reader = new window.FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    }))
}

function maskName(value) {
  if (!value) return '王**'
  return `${String(value).slice(0, 1)}**`
}

function maskBirthDate(value) {
  const year = String(value || '').slice(0, 4)
  if (year.length >= 2) return `${year.slice(0, 2)}**-**-**`
  return '19**-**-**'
}

function settingStatus(value) {
  return String(value || '').trim() ? text.configured : text.unavailable
}

function completionOf(player) {
  const fields = [player?.realName, player?.birthDate, player?.gender, player?.address, player?.walletPaymentMethod]
  const completed = fields.filter((value) => String(value || '').trim()).length
  return Math.round((completed / fields.length) * 100)
}

function FieldDisplay({ label, value }) {
  return (
    <div className="rounded border border-yellow-200/15 bg-red-950/55 px-4 py-3">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-yellow-100/45">{label}</p>
      <p className="mt-2 break-words text-sm font-black text-yellow-100">{value || text.unavailable}</p>
    </div>
  )
}

function numberValue(value) {
  const n = Number(value || 0)
  return Number.isFinite(n) ? n : 0
}

function roundDurationMs(row) {
  const fallback = GAME_PLAY_ESTIMATES_MS[row?.gameType] || 60 * 1000
  const start = Date.parse(row?.betAt || row?.createdAt || row?.settledAt || '')
  const end = Date.parse(row?.settledAt || row?.updatedAt || row?.betAt || '')
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return fallback
  return Math.max(end - start, fallback)
}

function formatDuration(ms) {
  if (!ms) return '0 分鐘'
  const minutes = Math.max(1, Math.round(ms / 60000))
  if (minutes < 60) return `${minutes} 分鐘`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} 小時 ${rest} 分鐘` : `${hours} 小時`
}

function formatDateShort(value) {
  if (!value) return '尚無紀錄'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '尚無紀錄' : date.toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' })
}

function achievementLabelsFor(stats) {
  const labels = []
  if (stats.rounds > 0) labels.push('初次遊玩')
  if (stats.wins > 0) labels.push('完成勝局')
  if (stats.rounds >= 10) labels.push('熟練玩家')
  if (stats.bestProfit >= 1000) labels.push('高額收穫')
  if (stats.totalDurationMs >= 60 * 60 * 1000) labels.push('長時間挑戰')
  return labels
}

function buildGameStats(rows = []) {
  const statsByGame = Object.fromEntries(gameProfiles.map((profile) => [
    profile.key,
    {
      ...profile,
      rounds: 0,
      wins: 0,
      totalBet: 0,
      profit: 0,
      bestProfit: 0,
      totalDurationMs: 0,
      lastPlayedAt: null,
      achievements: [],
    },
  ]))

  rows.forEach((row) => {
    const stats = statsByGame[row?.gameType]
    if (!stats) return
    const profit = numberValue(row.profit ?? numberValue(row.winAmount) - numberValue(row.betAmount))
    const playedAt = row.settledAt || row.betAt
    stats.rounds += 1
    stats.wins += profit > 0 ? 1 : 0
    stats.totalBet += numberValue(row.betAmount)
    stats.profit += profit
    stats.bestProfit = Math.max(stats.bestProfit, profit)
    stats.totalDurationMs += roundDurationMs(row)
    if (playedAt && (!stats.lastPlayedAt || new Date(playedAt) > new Date(stats.lastPlayedAt))) {
      stats.lastPlayedAt = playedAt
    }
  })

  return gameProfiles.map((profile) => {
    const stats = statsByGame[profile.key]
    return { ...stats, achievements: achievementLabelsFor(stats) }
  })
}

function totalAchievements(gameStats) {
  return gameStats.reduce((sum, stats) => sum + stats.achievements.length, 0)
}
function DropdownChevron({ open }) {
  return (
    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded border border-yellow-200/20 bg-yellow-200/10 text-yellow-100 transition ${open ? 'rotate-180 border-yellow-200/45 bg-yellow-200/18' : ''}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 9.5 12 15.5 18 9.5" />
        <path d="M9 6.5 12 9.5 15 6.5" opacity="0.55" />
      </svg>
    </span>
  )
}

function DropdownField({ label, testId, name, value, onChange, options }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const selected = options.find((option) => option.value === value) || options[0]

  useEffect(() => {
    if (!open) return undefined

    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return (
    <div className="grid gap-2 text-sm font-bold text-yellow-100/78">
      <span>{label}</span>
      <div ref={rootRef} className="relative">
        <button data-testid={testId} type="button" className={dropdownButtonClass} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
          <span>{selected.label}</span>
          <DropdownChevron open={open} />
        </button>
        {open && (
          <div className={dropdownMenuClass} role="listbox" aria-label={label}>
            {options.map((option) => {
              const active = option.value === value
              return (
                <button
                  key={option.value}
                  data-testid={`${testId}-option-${option.value}`}
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`${dropdownOptionClass} ${active ? dropdownOptionActiveClass : ''}`}
                  onClick={() => {
                    onChange({ target: { name, value: option.value } })
                    setOpen(false)
                  }}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function ProfileUnlockGate({ password, setPassword, onUnlock, unlocking, error }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 px-4 py-6 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="profile-unlock-title">
      <form data-testid="profile-unlock-gate" onSubmit={onUnlock} className="luxury-panel w-full max-w-md rounded p-6 shadow-2xl">
        <p className="gold-muted text-xs font-black uppercase tracking-[0.3em]">Member Center</p>
        <h2 id="profile-unlock-title" className="brand-title mt-2 text-2xl font-black">會員中心驗證</h2>
        <p className="mt-2 text-sm font-bold leading-6 text-yellow-100/62">請先輸入會員密碼，驗證後即可查看與設定個人資料。</p>
        <label className="mt-5 grid gap-2 text-sm font-bold text-yellow-100/78">
          {text.password}
          <input data-testid="profile-gate-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} className={textInputClass} placeholder={text.password} autoComplete="current-password" autoFocus />
        </label>
        {error && <p data-testid="profile-gate-error" className="mt-4 rounded border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-200">{error}</p>}
        <button data-testid="profile-gate-unlock" type="submit" disabled={unlocking || !password} className="gold-button mt-5 w-full rounded px-5 py-3 text-sm font-black disabled:opacity-60">{unlocking ? text.unlocking : text.unlock}</button>
      </form>
    </div>
  )
}
function SettingsModal({
  form,
  player,
  onChange,
  onClose,
  onSave,
  onUnlock,
  settingsPassword,
  setSettingsPassword,
  settingsUnlocked,
  unlocking,
  authLoading,
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-4 py-6 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="profile-settings-title">
      <div className="luxury-panel max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="gold-muted text-xs font-black uppercase tracking-[0.3em]">Private Settings</p>
            <h3 id="profile-settings-title" className="brand-title mt-1 text-2xl font-black">{text.basic}</h3>
            <p className="mt-2 text-sm font-bold text-yellow-100/58">{settingsUnlocked ? text.immutable : text.lockedHint}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded border border-yellow-200/20 px-3 py-2 text-sm font-black text-yellow-100 transition hover:border-yellow-200" aria-label={text.close}>
            ×
          </button>
        </div>

        {!settingsUnlocked ? (
          <form onSubmit={onUnlock} className="mt-5 grid gap-4">
            <label className="grid gap-2 text-sm font-bold text-yellow-100/78">
              {text.password}
              <input data-testid="profile-settings-password" type="password" value={settingsPassword} onChange={(event) => setSettingsPassword(event.target.value)} className={textInputClass} placeholder={text.password} autoComplete="current-password" autoFocus />
            </label>
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button type="button" onClick={onClose} className="rounded border border-yellow-200/20 px-5 py-3 text-sm font-black text-yellow-100 transition hover:border-yellow-200">{text.close}</button>
              <button data-testid="profile-settings-unlock" type="submit" disabled={unlocking || !settingsPassword} className="gold-button rounded px-5 py-3 text-sm font-black disabled:opacity-60">{unlocking ? text.unlocking : text.unlock}</button>
            </div>
          </form>
        ) : (
          <form onSubmit={onSave} className="mt-5 grid gap-4 md:grid-cols-2">
            <p className="rounded border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm font-bold text-emerald-200 md:col-span-2">{text.unlocked}</p>
            <label className="grid gap-2 text-sm font-bold text-yellow-100/78">
              {text.name}
              <input className={readOnlyInputClass} value={player?.realName || ''} readOnly />
            </label>
            <label className="grid gap-2 text-sm font-bold text-yellow-100/78">
              {text.birthday}
              <input className={readOnlyInputClass} value={player?.birthDate || ''} readOnly />
            </label>
            <p className="-mt-1 text-xs font-bold text-yellow-100/45 md:col-span-2">{text.immutable}</p>
            <DropdownField label={text.gender} testId="profile-settings-gender" name="gender" value={form.gender || 'PREFER_NOT_TO_SAY'} onChange={onChange} options={genderOptions} />
            <DropdownField label={text.walletPayment} testId="profile-settings-payment" name="walletPaymentMethod" value={form.walletPaymentMethod} onChange={onChange} options={paymentOptions} />
            <label className="grid gap-2 text-sm font-bold text-yellow-100/78 md:col-span-2">
              {text.address}
              <input data-testid="profile-settings-address" name="address" value={form.address} onChange={onChange} maxLength={255} className={textInputClass} />
            </label>
            <div className="flex flex-col-reverse gap-3 md:col-span-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={onClose} className="rounded border border-yellow-200/20 px-5 py-3 text-sm font-black text-yellow-100 transition hover:border-yellow-200">{text.close}</button>
              <button data-testid="profile-settings-save" type="submit" disabled={authLoading} className="gold-button rounded px-5 py-3 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-60">{authLoading ? text.saving : text.saveSettings}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

export default function Profile() {
  const dispatch = useDispatch()
  const player = useSelector((state) => state.auth.player)
  const authLoading = useSelector((state) => state.auth.loading)
  const authError = useSelector((state) => state.auth.error)
  const wallet = useSelector((state) => state.wallet)
  const checkin = useDailyCheckIn()
  const [form, setForm] = useState({
    nickname: '',
    avatarUrl: '',
    gender: 'PREFER_NOT_TO_SAY',
    address: '',
    walletPaymentMethod: 'STAR_COIN',
  })
  const [notice, setNotice] = useState('')
  const [avatarPreviewError, setAvatarPreviewError] = useState(false)
  const [socialBindings, setSocialBindings] = useState({})
  const [socialBindingsLoading, setSocialBindingsLoading] = useState(false)
  const [settingsModalOpen, setSettingsModalOpen] = useState(false)
  const [settingsUnlocked, setSettingsUnlocked] = useState(false)
  const [settingsPassword, setSettingsPassword] = useState('')
  const [unlocking, setUnlocking] = useState(false)
  const [profileUnlocked, setProfileUnlocked] = useState(false)
  const [profileUnlockError, setProfileUnlockError] = useState('')
  const [gameHistory, setGameHistory] = useState([])
  const [gameHistoryLoading, setGameHistoryLoading] = useState(false)
  const [gameHistoryError, setGameHistoryError] = useState('')
  const completion = useMemo(() => completionOf(player), [player])
  const gameStats = useMemo(() => buildGameStats(gameHistory), [gameHistory])
  const totalGameDuration = useMemo(() => gameStats.reduce((sum, stats) => sum + stats.totalDurationMs, 0), [gameStats])

  useEffect(() => {
    if (profileUnlocked) dispatch(fetchProfile())
  }, [dispatch, profileUnlocked])

  useEffect(() => {
    setForm({
      nickname: player?.nickname || '',
      avatarUrl: player?.avatarUrl || '',
      gender: player?.gender || 'PREFER_NOT_TO_SAY',
      address: player?.address || '',
      walletPaymentMethod: player?.walletPaymentMethod || 'STAR_COIN',
    })
    setAvatarPreviewError(false)
  }, [player?.address, player?.avatarUrl, player?.gender, player?.nickname, player?.walletPaymentMethod])

  useEffect(() => {
    if (!profileUnlocked || !player?.id) return undefined
    let active = true
    setSocialBindingsLoading(true)
    memberApi.getSocialBindings()
      .then((bindings) => {
        if (active) setSocialBindings(Object.fromEntries((bindings || []).map((item) => [item.provider, item])))
      })
      .catch(() => { if (active) setNotice('第三方帳號綁定狀態讀取失敗。') })
      .finally(() => { if (active) setSocialBindingsLoading(false) })
    return () => { active = false }
  }, [player?.id, profileUnlocked])

  useEffect(() => {
    if (!profileUnlocked || !player?.id) return undefined
    let active = true
    setGameHistoryLoading(true)
    setGameHistoryError('')
    gameApi.gameHistory({ gameType: 'all', page: 1, pageSize: PROFILE_GAME_FETCH_CAP })
      .then((res) => {
        if (active) setGameHistory(res?.items || [])
      })
      .catch(() => {
        if (active) {
          setGameHistory([])
          setGameHistoryError('遊戲紀錄暫時無法載入')
        }
      })
      .finally(() => { if (active) setGameHistoryLoading(false) })
    return () => { active = false }
  }, [player?.id, profileUnlocked])
  const handleChange = (event) => {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
  }

  const openSettingsModal = () => {
    setSettingsModalOpen(true)
    setSettingsUnlocked(true)
    setNotice('')
  }

  const closeSettingsModal = () => {
    setSettingsModalOpen(false)
    setSettingsUnlocked(false)
  }

  const handleUnlock = async (event) => {
    event.preventDefault()
    setUnlocking(true)
    setNotice('')
    try {
      await memberApi.verifyProfilePassword(settingsPassword)
      setProfileUnlocked(true)
      setSettingsUnlocked(true)
      setProfileUnlockError('')
    } catch (error) {
      setProfileUnlocked(false)
      setSettingsUnlocked(false)
      setProfileUnlockError(extractError(error) || text.settingsFailed)
    } finally {
      setUnlocking(false)
    }
  }

  const handleSavePublic = async (event) => {
    event.preventDefault()
    try {
      await dispatch(updateProfile({ nickname: form.nickname, avatarUrl: form.avatarUrl })).unwrap()
      setNotice(text.publicSaved)
    } catch {
      setNotice(text.publicFailed)
    }
  }

  const handleSaveSettings = async (event) => {
    event.preventDefault()
    try {
      await dispatch(updateProfile({
        gender: form.gender || 'PREFER_NOT_TO_SAY',
        address: form.address,
        walletPaymentMethod: form.walletPaymentMethod,
        currentPassword: settingsPassword,
      })).unwrap()
      closeSettingsModal()
      setNotice(text.settingsSaved)
    } catch {
      setNotice(text.settingsFailed)
    }
  }

  const handleAvatarFile = (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (!allowedAvatarTypes.includes(file.type)) {
      setNotice('頭像格式僅支援 JPG、PNG、GIF 或 WebP。')
      event.target.value = ''
      return
    }
    if (file.size > MAX_AVATAR_SIZE) {
      setNotice('頭像檔案不可超過 300KB。')
      event.target.value = ''
      return
    }
    const reader = new window.FileReader()
    reader.onload = () => {
      setForm((current) => ({ ...current, avatarUrl: reader.result }))
      setAvatarPreviewError(false)
      setNotice('頭像已載入，請記得儲存公開資料。')
    }
    reader.onerror = () => setNotice('頭像讀取失敗。')
    reader.readAsDataURL(file)
  }

  const handlePickAvatar = async (avatar) => {
    try {
      const avatarUrl = await readAssetAsDataUrl(avatar.src)
      setForm((current) => ({ ...current, avatarUrl }))
      setAvatarPreviewError(false)
      setNotice('頭像已選取，請記得儲存公開資料。')
    } catch {
      setNotice('頭像載入失敗。')
    }
  }

  const realNameDisplay = maskName(player?.realName || '王小明')
  const birthdayDisplay = maskBirthDate(player?.birthDate)
  const genderDisplay = genderLabels[player?.gender] || genderLabels.PREFER_NOT_TO_SAY
  const addressDisplay = settingStatus(player?.address)
  const paymentDisplay = settingStatus(player?.walletPaymentMethod)

  if (!profileUnlocked) {
    return (
      <AppShell>
        <section className="min-h-[calc(100vh-12rem)]" aria-hidden="true" />
        <ProfileUnlockGate
          password={settingsPassword}
          setPassword={setSettingsPassword}
          onUnlock={handleUnlock}
          unlocking={unlocking}
          error={profileUnlockError}
        />
      </AppShell>
    )
  }

  return (
    <AppShell>
      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <form onSubmit={handleSavePublic} className="luxury-panel rounded p-6">
          <p className="gold-muted text-xs font-black uppercase tracking-[0.3em]">Profile</p>
          <h2 className="brand-title mt-3 text-3xl font-black">{text.profile}</h2>
          <p className="mt-2 max-w-2xl text-sm font-bold leading-6 text-yellow-100/62">{text.subtitle}</p>

          <div className="mt-6 grid gap-5 md:grid-cols-[170px_minmax(0,1fr)]">
            <div className="grid content-start gap-3">
              <div className="aspect-square overflow-hidden rounded border border-yellow-200/20 bg-red-950/70">
                {form.avatarUrl && !avatarPreviewError ? (
                  <img src={form.avatarUrl} alt={text.avatar} className="h-full w-full object-cover" onError={() => setAvatarPreviewError(true)} />
                ) : (
                  <div className="grid h-full place-items-center bg-gradient-to-br from-red-900 to-yellow-900/60 text-5xl font-black text-yellow-100">
                    {(form.nickname || player?.username || 'P').slice(0, 1).toUpperCase()}
                  </div>
                )}
              </div>
              <label className="red-gold-button cursor-pointer rounded px-4 py-3 text-center text-sm font-black transition">
                {text.upload}
                <input type="file" accept="image/jpeg,image/png,image/gif,image/webp" className="sr-only" onChange={handleAvatarFile} />
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm font-bold text-yellow-100/78">
                {text.playerId}
                <input className="rounded border border-yellow-200/15 bg-red-950/70 px-4 py-3 text-white outline-none" value={player?.id || ''} readOnly />
              </label>
              <label className="grid gap-2 text-sm font-bold text-yellow-100/78">
                {text.nickname}
                <input name="nickname" className="rounded border border-yellow-200/15 bg-red-950/70 px-4 py-3 text-white outline-none focus:border-yellow-200" value={form.nickname} onChange={handleChange} required />
              </label>
              <div className="sm:col-span-2">
                <p className="text-sm font-bold text-yellow-100/78">{text.preset}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {avatarPresets.map((avatar) => (
                    <button key={avatar.id} type="button" onClick={() => handlePickAvatar(avatar)} className="h-14 w-14 overflow-hidden rounded border border-yellow-200/15 bg-red-950/70 transition hover:-translate-y-0.5 hover:border-yellow-200 focus:outline-none focus:ring-2 focus:ring-yellow-200/70" aria-label={`選擇 ${avatar.label} 頭像`}>
                      <img src={avatar.src} alt="" className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <section className="mt-6 border-t border-yellow-200/10 pt-6">
            <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
              <div>
                <p className="gold-muted text-xs font-black uppercase tracking-[0.3em]">Private Info</p>
                <h3 className="brand-title mt-1 text-2xl font-black">{text.basic}</h3>
                <p className="mt-2 text-sm font-bold text-yellow-100/55">{text.lockedHint}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded border border-yellow-200/15 bg-red-950/60 px-3 py-2 text-xs font-black text-yellow-100/70">{text.complete} {completion}%</span>
                <button data-testid="profile-settings-open" type="button" onClick={openSettingsModal} className="gold-button rounded px-5 py-3 text-sm font-black">{text.settingsButton}</button>
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <FieldDisplay label={text.name} value={realNameDisplay} />
              <FieldDisplay label={text.birthday} value={birthdayDisplay} />
              <FieldDisplay label={text.gender} value={genderDisplay} />
              <FieldDisplay label={text.address} value={addressDisplay} />
              <FieldDisplay label={text.walletPayment} value={paymentDisplay} />
            </div>
          </section>

          {authError && <p className="mt-4 rounded border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-200">{authError}</p>}
          {notice && <p data-testid="profile-notice" className="mt-4 rounded border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm font-bold text-emerald-200">{notice}</p>}
          <button data-testid="profile-save" type="submit" disabled={authLoading} className="gold-button mt-6 rounded px-5 py-3 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-60">{authLoading ? text.saving : text.savePublic}</button>
        </form>

        <aside className="grid content-start gap-4">
          <MetricCard label={text.balance} value={Number(wallet.balance || 0).toLocaleString()} tone="light" />
          <MetricCard label={text.frozen} value={Number(wallet.frozenAmount || 0).toLocaleString()} caption="進行中的遊戲或交易可能暫時凍結星幣。" />
          <div className="luxury-panel-soft rounded p-4">
            <p className="gold-muted text-xs font-black uppercase tracking-[0.25em]">Check-in</p>
            <p className="brand-title mt-2 text-2xl font-black">{checkin.consecutiveDays} {text.days}</p>
            <p className="mt-2 text-sm font-bold text-yellow-100/60">{checkin.hasCheckedInToday ? text.todayDone : text.todayTodo}</p>
          </div>
          <div className="luxury-panel-soft rounded p-4">
            <p className="gold-muted text-xs font-black uppercase tracking-[0.25em]">Security</p>
            <h3 className="brand-title mt-2 text-xl font-black">{text.security}</h3>
            <p className="mt-2 text-sm font-bold leading-6 text-yellow-100/60">{text.securityHint}</p>
          </div>
        </aside>
      </section>

      <section data-testid="profile-game-summary" className="luxury-panel-soft mt-6 rounded p-6">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <p className="gold-muted text-xs font-black uppercase tracking-[0.3em]">Game Journey</p>
            <h2 className="brand-title mt-1 text-2xl font-black">遊戲時長與成就</h2>
            <p className="mt-2 max-w-2xl text-sm font-bold leading-6 text-yellow-100/62">依最近 200 筆遊戲紀錄統計各遊戲累積時長、局數、勝場與已解鎖成就。</p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-xs font-black text-yellow-100/70 sm:min-w-[22rem]">
            <div className="rounded border border-yellow-200/15 bg-red-950/60 px-3 py-2">
              <span className="block text-yellow-100/45">總時長</span>
              <strong className="mt-1 block text-yellow-100">{formatDuration(totalGameDuration)}</strong>
            </div>
            <div className="rounded border border-yellow-200/15 bg-red-950/60 px-3 py-2">
              <span className="block text-yellow-100/45">總局數</span>
              <strong className="mt-1 block text-yellow-100">{gameStats.reduce((sum, stats) => sum + stats.rounds, 0).toLocaleString()}</strong>
            </div>
            <div className="rounded border border-yellow-200/15 bg-red-950/60 px-3 py-2">
              <span className="block text-yellow-100/45">成就</span>
              <strong className="mt-1 block text-yellow-100">{totalAchievements(gameStats).toLocaleString()}</strong>
            </div>
          </div>
        </div>

        {gameHistoryError && <p className="mt-4 rounded border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-200">{gameHistoryError}</p>}

        <div className="mt-5 grid gap-3 lg:grid-cols-3">
          {gameStats.map((stats) => (
            <article key={stats.key} className="rounded border border-yellow-200/15 bg-red-950/55 p-4 shadow-[inset_0_0_0_1px_rgba(255,226,145,.04)]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-yellow-100/45">{stats.focus}</p>
                  <h3 className="mt-1 text-lg font-black text-yellow-50">{stats.label}</h3>
                </div>
                <span className="rounded border border-yellow-200/20 bg-yellow-200/10 px-2 py-1 text-xs font-black text-yellow-100">{gameHistoryLoading ? '統計中' : formatDuration(stats.totalDurationMs)}</span>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs font-black text-yellow-100/68">
                <div className="rounded bg-black/18 px-2 py-2">
                  <span className="block text-yellow-100/40">局數</span>
                  <strong className="mt-1 block text-yellow-100">{stats.rounds}</strong>
                </div>
                <div className="rounded bg-black/18 px-2 py-2">
                  <span className="block text-yellow-100/40">勝場</span>
                  <strong className="mt-1 block text-yellow-100">{stats.wins}</strong>
                </div>
                <div className="rounded bg-black/18 px-2 py-2">
                  <span className="block text-yellow-100/40">最近</span>
                  <strong className="mt-1 block text-yellow-100">{formatDateShort(stats.lastPlayedAt)}</strong>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {(stats.achievements.length ? stats.achievements : ['尚未解鎖成就']).map((achievement) => (
                  <span key={achievement} className={stats.achievements.length ? 'rounded border border-emerald-300/25 bg-emerald-400/10 px-3 py-1 text-xs font-black text-emerald-100' : 'rounded border border-yellow-200/12 bg-black/12 px-3 py-1 text-xs font-black text-yellow-100/45'}>{achievement}</span>
                ))}
              </div>

              <p className="mt-4 text-xs font-bold text-yellow-100/45">最佳收益 {stats.bestProfit > 0 ? '+' : ''}{stats.bestProfit.toLocaleString()}｜累積損益 {stats.profit > 0 ? '+' : ''}{stats.profit.toLocaleString()}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="luxury-panel-soft mt-6 rounded p-6">
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
          <div>
            <p className="gold-muted text-xs font-black uppercase tracking-[0.3em]">Linked Accounts</p>
            <h2 className="brand-title mt-1 text-2xl font-black">{text.linked}</h2>
          </div>
          <p className="max-w-xl text-sm font-bold leading-6 text-yellow-100/62">{text.linkedCopy}</p>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          {socialProviders.map((provider) => {
            const binding = socialBindings[provider.id]
            const bound = Boolean(binding?.bound)
            return (
              <div key={provider.id} className={`rounded border p-4 transition hover:-translate-y-0.5 hover:border-yellow-200/60 ${provider.accentClass} ${provider.glowClass}`}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-lg font-black">{provider.label}</p>
                    <p className="mt-1 text-xs font-bold opacity-75">{socialBindingsLoading ? '讀取中...' : bound ? `${text.bound} ${binding.maskedAccountId || ''}` : text.unbound}</p>
                  </div>
                  <SocialProviderIcon provider={provider.id} className="h-14 w-14 drop-shadow-xl" />
                </div>
                <Link to={`/profile/social-bindings/${provider.id}`} className={bound ? 'red-gold-button mt-4 block w-full rounded px-4 py-3 text-center text-sm font-black' : 'gold-button mt-4 block w-full rounded px-4 py-3 text-center text-sm font-black'}>
                  {bound ? text.manage : text.bind}
                </Link>
              </div>
            )
          })}
        </div>
      </section>

      {settingsModalOpen && (
        <SettingsModal
          form={form}
          player={player}
          onChange={handleChange}
          onClose={closeSettingsModal}
          onSave={handleSaveSettings}
          onUnlock={handleUnlock}
          settingsPassword={settingsPassword}
          setSettingsPassword={setSettingsPassword}
          settingsUnlocked={settingsUnlocked}
          unlocking={unlocking}
          authLoading={authLoading}
        />
      )}
    </AppShell>
  )
}
