import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useDispatch, useSelector } from 'react-redux'
import CoinRain from '../components/CoinRain'
import SocialProviderIcon from '../components/SocialProviderIcon'
import { registerSocialMember } from '../store/slices/authSlice'
import { fetchDiamondBalance } from '../store/slices/diamondSlice'
import { fetchRanks } from '../store/slices/rankSlice'
import { fetchWallet } from '../store/slices/walletSlice'
import { memberApi, extractError } from '../services/memberApi'
import { getBackgroundStyle } from '../theme/backgroundTheme'
import { getBirthDateMax, isAdultBirthDate } from '../utils/memberPreferences'

function suggestedUsername(preview) {
  const emailPrefix = preview.email?.split('@')[0] || ''
  const candidate = emailPrefix.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 50)
  return candidate.length >= 3 ? candidate : ''
}

export default function SocialRegister() {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const ticket = searchParams.get('ticket') || ''
  const { loading, error: authError } = useSelector((state) => state.auth)
  const [preview, setPreview] = useState(null)
  const [pageError, setPageError] = useState('')
  const [form, setForm] = useState({
    username: '',
    nickname: '',
    realName: '',
    email: '',
    birthDate: '',
    adultConfirmed: false,
  })
  const birthDateMax = getBirthDateMax()
  const ageError = form.birthDate && !isAdultBirthDate(form.birthDate)
  const providerName = useMemo(
    () => preview?.providerLabel || preview?.provider || '第三方帳戶',
    [preview],
  )

  useEffect(() => {
    let active = true
    if (!ticket) {
      setPageError('第三方註冊票據不完整，請重新操作。')
      return () => {
        active = false
      }
    }
    memberApi
      .getSocialRegistrationPreview(ticket)
      .then((data) => {
        if (!active) return
        setPreview(data)
        setForm((current) => ({
          ...current,
          username: suggestedUsername(data),
          nickname: data.displayName || '',
          realName: data.displayName || '',
          email: data.email || '',
        }))
      })
      .catch((requestError) => {
        if (active) setPageError(extractError(requestError) || '第三方註冊票據已失效')
      })
    return () => {
      active = false
    }
  }, [ticket])

  const handleChange = (event) => {
    const { name, type, checked, value } = event.target
    setForm((current) => ({ ...current, [name]: type === 'checkbox' ? checked : value }))
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setPageError('')
    if (!isAdultBirthDate(form.birthDate) || !form.adultConfirmed) {
      setPageError('註冊需完成年齡驗證，且必須年滿 18 歲。')
      return
    }
    try {
      await dispatch(registerSocialMember({ ticket, ...form })).unwrap()
      dispatch(fetchWallet())
      dispatch(fetchDiamondBalance())
      dispatch(fetchRanks())
      navigate('/games', { replace: true })
    } catch {
      // authSlice exposes the backend message.
    }
  }

  return (
    <main
      className="theme-background grid min-h-screen place-items-center px-4 py-10 text-white"
      style={getBackgroundStyle('auth')}
    >
      <CoinRain />
      <section className="luxury-panel w-full max-w-xl rounded p-6 sm:p-8">
        <div className="flex items-center gap-4">
          {preview && (
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded border border-yellow-200/25 bg-red-950/70">
              <SocialProviderIcon provider={preview.provider} className="h-6 w-6" />
            </span>
          )}
          <div>
            <p className="gold-muted text-xs font-black uppercase tracking-[0.3em]">
              Social Registration
            </p>
            <h1 className="brand-title mt-2 text-3xl font-black">完成第三方註冊</h1>
          </div>
        </div>

        {!preview && !pageError && (
          <p className="mt-6 text-sm font-bold text-yellow-100/70">正在確認第三方帳戶資料...</p>
        )}

        {preview && (
          <>
            <p className="mt-5 text-sm font-bold leading-6 text-yellow-100/70">
              已驗證 {providerName} 身分。設定遊戲帳號後即可進入大廳，不需要另外建立密碼。
            </p>
            <form onSubmit={handleSubmit} className="mt-6 grid gap-4">
              <label className="grid gap-2 text-sm font-bold text-yellow-100/78">
                遊戲帳號
                <input
                  name="username"
                  className="rounded border border-yellow-200/15 bg-red-950/70 px-4 py-3 text-white outline-none focus:border-yellow-200"
                  value={form.username}
                  onChange={handleChange}
                  minLength={3}
                  maxLength={50}
                  autoComplete="username"
                  required
                />
              </label>
              <label className="grid gap-2 text-sm font-bold text-yellow-100/78">
                顯示暱稱
                <input
                  name="nickname"
                  className="rounded border border-yellow-200/15 bg-red-950/70 px-4 py-3 text-white outline-none focus:border-yellow-200"
                  value={form.nickname}
                  onChange={handleChange}
                  minLength={2}
                  maxLength={50}
                  required
                />
              </label>
              <label className="grid gap-2 text-sm font-bold text-yellow-100/78">
                姓名
                <input
                  name="realName"
                  className="rounded border border-yellow-200/15 bg-red-950/70 px-4 py-3 text-white outline-none focus:border-yellow-200"
                  value={form.realName}
                  onChange={handleChange}
                  minLength={2}
                  maxLength={80}
                  autoComplete="name"
                  required
                />
                <span className="text-xs text-yellow-100/55">姓名註冊後不可自行更改，請確認與身分資料一致。</span>
              </label>
              <label className="grid gap-2 text-sm font-bold text-yellow-100/78">
                Email
                <input
                  name="email"
                  className="rounded border border-yellow-200/15 bg-red-950/70 px-4 py-3 text-white outline-none read-only:cursor-not-allowed read-only:opacity-70 focus:border-yellow-200"
                  value={form.email}
                  onChange={handleChange}
                  type="email"
                  readOnly={preview.emailLocked}
                  required
                />
                {preview.emailLocked && (
                  <span className="text-xs text-yellow-100/55">此 Email 已由 {providerName} 驗證。</span>
                )}
              </label>
              <label className="grid gap-2 text-sm font-bold text-yellow-100/78">
                出生日期
                <input
                  name="birthDate"
                  className="rounded border border-yellow-200/15 bg-red-950/70 px-4 py-3 text-white outline-none focus:border-yellow-200"
                  value={form.birthDate}
                  onChange={handleChange}
                  type="date"
                  max={birthDateMax}
                  required
                />
                <span className="text-xs text-yellow-100/55">生日只能在註冊時設定，日後如需修正請聯繫客服。</span>
              </label>
              <label className="flex items-start gap-3 rounded border border-yellow-200/15 bg-red-950/50 px-4 py-3 text-sm font-bold text-yellow-100/78">
                <input
                  name="adultConfirmed"
                  className="mt-1 h-4 w-4 accent-yellow-200"
                  checked={form.adultConfirmed}
                  onChange={handleChange}
                  type="checkbox"
                  required
                />
                <span>我確認已年滿 18 歲，並同意建立幸運星幣城會員。</span>
              </label>
              {ageError && (
                <p className="rounded border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-200">
                  出生日期未滿 18 歲，無法完成註冊。
                </p>
              )}
              {(pageError || authError) && (
                <p className="rounded border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-200">
                  {pageError || authError}
                </p>
              )}
              <button
                type="submit"
                disabled={loading}
                className="gold-button rounded px-5 py-3 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? '建立中...' : `使用 ${providerName} 建立會員`}
              </button>
            </form>
          </>
        )}

        {pageError && !preview && (
          <div className="mt-6">
            <p className="rounded border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-200">
              {pageError}
            </p>
            <Link
              to="/member?mode=login"
              className="gold-button mt-5 inline-block rounded px-5 py-3 text-sm font-black"
            >
              返回登入
            </Link>
          </div>
        )}
      </section>
    </main>
  )
}
