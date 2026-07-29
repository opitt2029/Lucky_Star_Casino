import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useDispatch, useSelector } from 'react-redux'
import DecorativeAsset from '../components/DecorativeAsset'
import CoinRain from '../components/CoinRain'
import { LoginForm, RegisterForm } from '../features/auth/AuthForms'
import usePostAuthSync from '../hooks/usePostAuthSync'
import { loginMember, registerMember } from '../store/slices/authSlice'
import { getBackgroundStyle } from '../theme/backgroundTheme'
import { getBirthDateMax, isAdultBirthDate, socialProviders } from '../utils/memberPreferences'
import { pathFromLocationState, saveOAuthReturnTo } from '../utils/authNavigation'
import { memberApi, extractError } from '../services/memberApi'

const useMockApi = import.meta.env.VITE_USE_MOCK_API !== 'false'
const demoMode = import.meta.env.VITE_DEMO_MODE === 'true'
const demoUsername = import.meta.env.VITE_DEMO_USERNAME || (useMockApi ? 'test' : '')
const demoPassword = import.meta.env.VITE_DEMO_PASSWORD || (useMockApi ? 'test1234' : '')
const defaultLogin = demoMode
  ? { username: demoUsername, password: demoPassword }
  : { username: '', password: '' }
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
  const syncAfterAuth = usePostAuthSync()
  const [searchParams, setSearchParams] = useSearchParams()
  const { loading, error, sessionError, isAuthenticated } = useSelector((state) => state.auth)
  const initialMode = searchParams.get('mode') === 'register' ? 'register' : 'login'
  const [mode, setMode] = useState(initialMode)
  const [loginForm, setLoginForm] = useState(defaultLogin)
  const [registerForm, setRegisterForm] = useState(defaultRegister)
  const [memberNotice, setMemberNotice] = useState('')
  const [socialLoading, setSocialLoading] = useState('')
  const from = pathFromLocationState(location.state?.from)
  const birthDateMax = getBirthDateMax()
  const registerAgeError = registerForm.birthDate && !isAdultBirthDate(registerForm.birthDate)
  const displayError = error || sessionError
  const hasDemoCredentials = demoMode && Boolean(demoUsername && demoPassword)

  useEffect(() => {
    setMode(initialMode)
    setMemberNotice('')
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

  const handleSocialLogin = async (provider) => {
    setSocialLoading(provider.id)
    setMemberNotice('')
    saveOAuthReturnTo(from)
    try {
      const start = await memberApi.startSocialLogin(provider.id)
      window.location.assign(start.authorizationUrl)
    } catch (socialError) {
      setMemberNotice(
        extractError(socialError) ||
          `${provider.label} 登入或註冊目前無法啟動，請稍後再試。`,
      )
      setSocialLoading('')
    }
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

  const pageCopy =
    mode === 'register'
      ? { eyebrow: 'Create Account', title: '建立會員帳號', switchText: '已有帳號，前往登入' }
      : { eyebrow: 'Member Login', title: '登入會員', switchText: '尚未註冊，建立帳號' }

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
            <p className="gold-muted text-xs font-black uppercase tracking-[0.35em]">Member Access</p>
            <h1 className="brand-title mt-4 max-w-3xl text-4xl font-black tracking-tight sm:text-6xl">
              登入後開始遊玩
            </h1>
            <p className="mt-5 max-w-2xl text-base font-bold leading-8 text-yellow-100/70">
              登入或建立帳號後，就能進入遊戲大廳、鑽石錢包與會員中心。
              {hasDemoCredentials && (
                <span className="block">展示模式帳號 {demoUsername} / {demoPassword} 已預填。</span>
              )}
            </p>
          </div>
          <DecorativeAsset assetKey="memberHero" className="min-h-[340px]" />
        </section>

        <section className="luxury-panel rounded p-6">
          <div className="grid grid-cols-2 gap-2 rounded bg-red-950/70 p-1">
            {['login', 'register'].map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => {
                  setSearchParams({ mode: item })
                  setMode(item)
                  setMemberNotice('')
                }}
                className={[
                  'rounded px-4 py-3 text-sm font-black transition',
                  mode === item ? 'gold-button' : 'text-yellow-100/62 hover:text-yellow-100',
                ].join(' ')}
              >
                {item === 'login' ? '登入' : '註冊'}
              </button>
            ))}
          </div>

          <p className="gold-muted mt-6 text-xs font-black uppercase tracking-[0.3em]">
            {pageCopy.eyebrow}
          </p>
          <h2 className="brand-title mt-3 text-2xl font-black">{pageCopy.title}</h2>

          {mode === 'login' ? (
            <LoginForm
              form={loginForm}
              onChange={handleLoginChange}
              onSubmit={handleLoginSubmit}
              loading={loading}
              error={displayError}
              notice={memberNotice}
              providers={socialProviders}
              socialLoading={socialLoading}
              onSocialLogin={handleSocialLogin}
            />
          ) : (
            <RegisterForm
              form={registerForm}
              onChange={handleRegisterChange}
              onSubmit={handleRegisterSubmit}
              loading={loading}
              error={displayError}
              notice={memberNotice}
              birthDateMax={birthDateMax}
              ageError={registerAgeError}
              providers={socialProviders}
              socialLoading={socialLoading}
              onSocialLogin={handleSocialLogin}
            />
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
