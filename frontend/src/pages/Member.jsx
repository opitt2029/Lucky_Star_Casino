import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useDispatch, useSelector } from 'react-redux'
import DecorativeAsset from '../components/DecorativeAsset'
import CoinRain from '../components/CoinRain'
import { loginMember, registerMember } from '../store/slices/authSlice'
import { fetchRanks } from '../store/slices/rankSlice'
import { fetchWallet } from '../store/slices/walletSlice'
import { getBackgroundStyle } from '../theme/backgroundTheme'
import { getBirthDateMax, isAdultBirthDate, socialProviders } from '../utils/memberPreferences'

const defaultLogin = { username: 'test', password: 'test1234' }
const defaultRegister = {
  username: '',
  nickname: '',
  email: '',
  password: '',
  birthDate: '',
  adultConfirmed: false,
}

export default function Member() {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const { loading, error, isAuthenticated } = useSelector((state) => state.auth)
  const initialMode = searchParams.get('mode') === 'register' ? 'register' : 'login'
  const [mode, setMode] = useState(initialMode)
  const [loginForm, setLoginForm] = useState(defaultLogin)
  const [registerForm, setRegisterForm] = useState(defaultRegister)
  const [memberNotice, setMemberNotice] = useState('')
  const from = location.state?.from?.pathname || '/games'
  const birthDateMax = getBirthDateMax()
  const registerAgeError = registerForm.birthDate && !isAdultBirthDate(registerForm.birthDate)

  const pageCopy = useMemo(
    () =>
      mode === 'register'
        ? {
            eyebrow: 'Register',
            title: '建立會員帳號',
            submit: '建立帳號',
            switchText: '已有帳號，前往登入',
          }
        : {
            eyebrow: 'Sign In',
            title: '登入會員',
            submit: '登入',
            switchText: '尚未註冊，建立帳號',
          },
    [mode]
  )

  useEffect(() => {
    setMode(initialMode)
  }, [initialMode])

  useEffect(() => {
    if (isAuthenticated && location.state?.from) {
      navigate(from, { replace: true })
    }
  }, [from, isAuthenticated, location.state, navigate])

  const switchMode = () => {
    const nextMode = mode === 'login' ? 'register' : 'login'
    setSearchParams({ mode: nextMode })
    setMode(nextMode)
    setMemberNotice('')
  }

  const handleLoginChange = (event) => {
    setLoginForm((current) => ({ ...current, [event.target.name]: event.target.value }))
  }

  const handleRegisterChange = (event) => {
    const { name, type, checked, value } = event.target
    setRegisterForm((current) => ({ ...current, [name]: type === 'checkbox' ? checked : value }))
  }

  const syncAfterAuth = () => {
    dispatch(fetchWallet())
    dispatch(fetchRanks())
  }

  const handleLoginSubmit = async (event) => {
    event.preventDefault()
    try {
      await dispatch(loginMember(loginForm)).unwrap()
      syncAfterAuth()
      navigate(from, { replace: true })
    } catch {
      // authSlice exposes the message in state.error
    }
  }

  const handleSocialLogin = (provider) => {
    setMemberNotice(`${provider.label} 登入入口已建立，請先用帳密登入後到會員中心完成綁定。`)
  }

  const handleRegisterSubmit = async (event) => {
    event.preventDefault()
    if (!isAdultBirthDate(registerForm.birthDate) || !registerForm.adultConfirmed) {
      setMemberNotice('註冊需完成年齡驗證，且必須年滿 18 歲。')
      return
    }
    try {
      await dispatch(registerMember(registerForm)).unwrap()
      syncAfterAuth()
      navigate(from, { replace: true })
    } catch {
      // authSlice exposes the message in state.error
    }
  }

  return (
    <div className="theme-background min-h-screen text-white" style={getBackgroundStyle('auth')}>
      <CoinRain />
      <header className="mx-auto flex max-w-7xl items-center justify-between px-4 py-5 sm:px-6 lg:px-8">
        <Link to="/" className="brand-title font-black tracking-tight">
          幸運星幣城
        </Link>
        <Link to="/" className="red-gold-button rounded px-4 py-2 text-sm font-black transition">
          回首頁
        </Link>
      </header>

      <main className="mx-auto grid max-w-7xl items-center gap-8 px-4 pb-12 pt-4 sm:px-6 lg:grid-cols-[1fr_520px] lg:px-8">
        <section className="grid gap-6">
          <div>
            <p className="gold-muted text-xs font-black uppercase tracking-[0.35em]">
              Member Access
            </p>
            <h1 className="brand-title mt-4 max-w-3xl text-4xl font-black tracking-tight sm:text-6xl">
              會員頁是遊戲入口的門禁
            </h1>
            <p className="mt-5 max-w-2xl text-base font-bold leading-8 text-yellow-100/70">
              註冊或登入後，才能進入遊戲大全、各遊戲網頁與賭場商城。測試帳號 test / test1234
              已預填，可直接登入檢查流程。
            </p>
          </div>
          <DecorativeAsset assetKey="memberHero" className="min-h-[340px]" />
        </section>

        <section className="luxury-panel rounded p-6">
          <div className="grid grid-cols-2 gap-2 rounded bg-red-950/70 p-1">
            <button
              type="button"
              onClick={() => {
                setSearchParams({ mode: 'login' })
                setMode('login')
              }}
              className={[
                'rounded px-4 py-3 text-sm font-black transition',
                mode === 'login' ? 'gold-button' : 'text-yellow-100/62 hover:text-yellow-100',
              ].join(' ')}
            >
              登入
            </button>
            <button
              type="button"
              onClick={() => {
                setSearchParams({ mode: 'register' })
                setMode('register')
              }}
              className={[
                'rounded px-4 py-3 text-sm font-black transition',
                mode === 'register' ? 'gold-button' : 'text-yellow-100/62 hover:text-yellow-100',
              ].join(' ')}
            >
              註冊
            </button>
          </div>

          <p className="gold-muted mt-6 text-xs font-black uppercase tracking-[0.3em]">
            {pageCopy.eyebrow}
          </p>
          <h2 className="brand-title mt-3 text-2xl font-black">{pageCopy.title}</h2>

          {mode === 'login' ? (
            <form onSubmit={handleLoginSubmit} className="mt-6 grid gap-4">
              <label className="grid gap-2 text-sm font-bold text-yellow-100/78">
                帳號
                <input
                  name="username"
                  className="rounded border border-yellow-200/15 bg-red-950/70 px-4 py-3 text-white outline-none focus:border-yellow-200"
                  value={loginForm.username}
                  onChange={handleLoginChange}
                  autoComplete="username"
                  required
                />
              </label>
              <label className="grid gap-2 text-sm font-bold text-yellow-100/78">
                密碼
                <input
                  name="password"
                  className="rounded border border-yellow-200/15 bg-red-950/70 px-4 py-3 text-white outline-none focus:border-yellow-200"
                  value={loginForm.password}
                  onChange={handleLoginChange}
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </label>
              <div className="grid gap-2 sm:grid-cols-3">
                {socialProviders.map((provider) => (
                  <button
                    key={provider.id}
                    type="button"
                    onClick={() => handleSocialLogin(provider)}
                    className={`rounded border px-3 py-3 text-sm font-black transition hover:brightness-125 ${provider.accentClass}`}
                  >
                    {provider.label}
                  </button>
                ))}
              </div>
              {memberNotice && (
                <p className="rounded border border-yellow-200/25 bg-yellow-200/10 px-4 py-3 text-sm font-bold text-yellow-100">
                  {memberNotice}
                </p>
              )}
              {error && (
                <p className="rounded border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-200">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={loading}
                className="gold-button mt-2 rounded px-5 py-3 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? '登入中...' : pageCopy.submit}
              </button>
            </form>
          ) : (
            <form onSubmit={handleRegisterSubmit} className="mt-6 grid gap-4">
              <label className="grid gap-2 text-sm font-bold text-yellow-100/78">
                帳號
                <input
                  name="username"
                  className="rounded border border-yellow-200/15 bg-red-950/70 px-4 py-3 text-white outline-none focus:border-yellow-200"
                  placeholder="lucky-player"
                  value={registerForm.username}
                  onChange={handleRegisterChange}
                  minLength={3}
                  required
                />
              </label>
              <label className="grid gap-2 text-sm font-bold text-yellow-100/78">
                暱稱
                <input
                  name="nickname"
                  className="rounded border border-yellow-200/15 bg-red-950/70 px-4 py-3 text-white outline-none focus:border-yellow-200"
                  placeholder="Lucky Player"
                  value={registerForm.nickname}
                  onChange={handleRegisterChange}
                  minLength={2}
                  required
                />
              </label>
              <label className="grid gap-2 text-sm font-bold text-yellow-100/78">
                Email
                <input
                  name="email"
                  className="rounded border border-yellow-200/15 bg-red-950/70 px-4 py-3 text-white outline-none focus:border-yellow-200"
                  placeholder="player@example.com"
                  value={registerForm.email}
                  onChange={handleRegisterChange}
                  type="email"
                  required
                />
              </label>
              <label className="grid gap-2 text-sm font-bold text-yellow-100/78">
                密碼
                <input
                  name="password"
                  className="rounded border border-yellow-200/15 bg-red-950/70 px-4 py-3 text-white outline-none focus:border-yellow-200"
                  value={registerForm.password}
                  onChange={handleRegisterChange}
                  type="password"
                  minLength={8}
                  pattern="(?=.*[A-Za-z])(?=.*\d).{8,}"
                  title="至少 8 碼，並包含英文與數字"
                  required
                />
              </label>
              <label className="grid gap-2 text-sm font-bold text-yellow-100/78">
                出生日期
                <input
                  name="birthDate"
                  className="rounded border border-yellow-200/15 bg-red-950/70 px-4 py-3 text-white outline-none focus:border-yellow-200"
                  value={registerForm.birthDate}
                  onChange={handleRegisterChange}
                  type="date"
                  max={birthDateMax}
                  required
                />
              </label>
              <label className="flex items-start gap-3 rounded border border-yellow-200/15 bg-red-950/50 px-4 py-3 text-sm font-bold text-yellow-100/78">
                <input
                  name="adultConfirmed"
                  className="mt-1 h-4 w-4 accent-yellow-200"
                  checked={registerForm.adultConfirmed}
                  onChange={handleRegisterChange}
                  type="checkbox"
                  required
                />
                <span>我確認已年滿 18 歲，並同意建立會員帳號。</span>
              </label>
              {memberNotice && (
                <p className="rounded border border-yellow-200/25 bg-yellow-200/10 px-4 py-3 text-sm font-bold text-yellow-100">
                  {memberNotice}
                </p>
              )}
              {registerAgeError && (
                <p className="rounded border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-200">
                  出生日期未滿 18 歲，無法完成註冊。
                </p>
              )}
              {error && (
                <p className="rounded border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-200">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={loading}
                className="gold-button mt-2 rounded px-5 py-3 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? '建立中...' : pageCopy.submit}
              </button>
            </form>
          )}

          <button
            type="button"
            onClick={switchMode}
            className="gold-muted mt-5 w-full text-center text-sm font-bold transition hover:text-yellow-100"
          >
            {pageCopy.switchText}
          </button>
        </section>
      </main>
    </div>
  )
}
