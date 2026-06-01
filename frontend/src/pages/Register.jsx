import { useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Link } from 'react-router-dom'
import { useNavigate } from 'react-router-dom'
import { registerMember } from '../store/slices/authSlice'
import { fetchWallet } from '../store/slices/walletSlice'
import CoinRain from '../components/CoinRain'
import { getBackgroundStyle } from '../theme/backgroundTheme'
import { getBirthDateMax, isAdultBirthDate } from '../utils/memberPreferences'

export default function Register() {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const { loading, error } = useSelector((state) => state.auth)
  const [notice, setNotice] = useState('')
  const [form, setForm] = useState({
    username: '',
    nickname: '',
    email: '',
    password: '',
    birthDate: '',
    adultConfirmed: false,
  })
  const birthDateMax = getBirthDateMax()
  const ageError = form.birthDate && !isAdultBirthDate(form.birthDate)

  const handleChange = (event) => {
    const { name, type, checked, value } = event.target
    setForm((current) => ({ ...current, [name]: type === 'checkbox' ? checked : value }))
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!isAdultBirthDate(form.birthDate) || !form.adultConfirmed) {
      setNotice('註冊需完成年齡驗證，且必須年滿 18 歲。')
      return
    }
    try {
      await dispatch(registerMember(form)).unwrap()
      dispatch(fetchWallet())
      navigate('/games')
    } catch {
      // authSlice already exposes the message in state.error
    }
  }

  return (
    <div
      className="theme-background grid min-h-screen place-items-center px-4 py-10 text-white"
      style={getBackgroundStyle('auth')}
    >
      <CoinRain />
      <div className="w-full max-w-xl rounded border border-white/10 bg-zinc-900 p-6">
        <p className="text-xs font-black uppercase tracking-[0.3em] text-zinc-500">Register</p>
        <h1 className="mt-3 text-3xl font-black">建立會員基底</h1>
        <form onSubmit={handleSubmit} className="mt-6 grid gap-4">
          <label className="grid gap-2 text-sm font-bold text-zinc-300">
            帳號
            <input
              name="username"
              className="rounded border border-white/10 bg-black px-4 py-3 text-white outline-none focus:border-white"
              placeholder="lucky-player"
              value={form.username}
              onChange={handleChange}
              minLength={3}
              required
            />
          </label>
          <label className="grid gap-2 text-sm font-bold text-zinc-300">
            暱稱
            <input
              name="nickname"
              className="rounded border border-white/10 bg-black px-4 py-3 text-white outline-none focus:border-white"
              placeholder="Lucky Player"
              value={form.nickname}
              onChange={handleChange}
              minLength={2}
              required
            />
          </label>
          <label className="grid gap-2 text-sm font-bold text-zinc-300">
            Email
            <input
              name="email"
              className="rounded border border-white/10 bg-black px-4 py-3 text-white outline-none focus:border-white"
              placeholder="player@example.com"
              value={form.email}
              onChange={handleChange}
              type="email"
              required
            />
          </label>
          <label className="grid gap-2 text-sm font-bold text-zinc-300">
            密碼
            <input
              name="password"
              className="rounded border border-white/10 bg-black px-4 py-3 text-white outline-none focus:border-white"
              value={form.password}
              onChange={handleChange}
              type="password"
              minLength={8}
              pattern="(?=.*[A-Za-z])(?=.*\d).{8,}"
              title="至少 8 碼，並包含英文與數字"
              required
            />
          </label>
          <label className="grid gap-2 text-sm font-bold text-zinc-300">
            出生日期
            <input
              name="birthDate"
              className="rounded border border-white/10 bg-black px-4 py-3 text-white outline-none focus:border-white"
              value={form.birthDate}
              onChange={handleChange}
              type="date"
              max={birthDateMax}
              required
            />
          </label>
          <label className="flex items-start gap-3 rounded border border-white/10 bg-black px-4 py-3 text-sm font-bold text-zinc-300">
            <input
              name="adultConfirmed"
              className="mt-1 h-4 w-4 accent-white"
              checked={form.adultConfirmed}
              onChange={handleChange}
              type="checkbox"
              required
            />
            <span>我確認已年滿 18 歲，並同意建立會員帳號。</span>
          </label>
          {notice && (
            <p className="rounded border border-yellow-400/30 bg-yellow-500/10 px-4 py-3 text-sm font-bold text-yellow-100">
              {notice}
            </p>
          )}
          {ageError && (
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
            className="rounded bg-white px-5 py-3 text-sm font-black text-zinc-950 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? '建立中...' : '建立帳號'}
          </button>
          <Link
            to="/login"
            className="text-center text-sm font-bold text-zinc-400 transition hover:text-white"
          >
            返回登入
          </Link>
        </form>
      </div>
    </div>
  )
}
