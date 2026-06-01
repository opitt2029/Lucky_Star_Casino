import { useState } from 'react'
import { useDispatch } from 'react-redux'
import { useSelector } from 'react-redux'
import { Link, useNavigate } from 'react-router-dom'
import { loginMember } from '../store/slices/authSlice'
import { fetchRanks } from '../store/slices/rankSlice'
import { fetchWallet } from '../store/slices/walletSlice'
import CoinRain from '../components/CoinRain'
import { getBackgroundStyle } from '../theme/backgroundTheme'

export default function Login() {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const { loading, error } = useSelector((state) => state.auth)
  const [form, setForm] = useState({ username: 'test', password: 'test1234' })

  const handleChange = (event) => {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }))
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    try {
      await dispatch(loginMember(form)).unwrap()
      dispatch(fetchWallet())
      dispatch(fetchRanks())
      navigate('/games')
    } catch {
      // authSlice already exposes the message in state.error
    }
  }

  return (
    <div className="theme-background grid min-h-screen text-white lg:grid-cols-[1fr_520px]" style={getBackgroundStyle('auth')}>
      <CoinRain />
      <section
        className="theme-artwork flex min-h-[46vh] items-end border-b border-white/10 p-6 sm:p-10 lg:min-h-screen lg:border-b-0 lg:border-r"
        style={getBackgroundStyle('authHero')}
      >
        <div className="max-w-3xl">
          <p className="text-xs font-black uppercase tracking-[0.35em] text-zinc-500">Lucky Star Casino</p>
          <h1 className="mt-4 text-4xl font-black tracking-tight sm:text-6xl">黑白系遊戲前端工作台</h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-zinc-400">
            React 18、Vite、Tailwind CSS、Redux Toolkit、API 與 WebSocket 基底已整合。測試帳號為 test / test1234。
          </p>
        </div>
      </section>

      <section className="flex items-center px-6 py-10 sm:px-10">
        <div className="w-full rounded border border-white/10 bg-zinc-900 p-6">
          <p className="text-xs font-black uppercase tracking-[0.3em] text-zinc-500">Sign In</p>
          <h2 className="mt-3 text-2xl font-black">登入平台</h2>
          <form onSubmit={handleSubmit} className="mt-6 grid gap-4">
            <label className="grid gap-2 text-sm font-bold text-zinc-300">
              帳號
              <input
                name="username"
                className="rounded border border-white/10 bg-black px-4 py-3 text-white outline-none focus:border-white"
                value={form.username}
                onChange={handleChange}
                autoComplete="username"
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
                autoComplete="current-password"
                required
              />
            </label>
            {error && <p className="rounded border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-200">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="mt-2 rounded bg-white px-5 py-3 text-sm font-black text-zinc-950 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? '登入中...' : '登入'}
            </button>
            <Link to="/register" className="text-center text-sm font-bold text-zinc-400 transition hover:text-white">
              建立測試帳號
            </Link>
          </form>
        </div>
      </section>
    </div>
  )
}
