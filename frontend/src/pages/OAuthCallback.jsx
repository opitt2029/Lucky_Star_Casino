import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useDispatch } from 'react-redux'
import { socialLoginMember } from '../store/slices/authSlice'
import { fetchRanks } from '../store/slices/rankSlice'
import { fetchDiamondBalance } from '../store/slices/diamondSlice'
import { fetchWallet } from '../store/slices/walletSlice'
import { getBackgroundStyle } from '../theme/backgroundTheme'

export default function OAuthCallback() {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const started = useRef(false)
  const [error, setError] = useState(searchParams.get('error') || '')

  useEffect(() => {
    if (started.current || error) return
    started.current = true
    const ticket = searchParams.get('ticket')
    if (!ticket) {
      setError('第三方登入回傳資料不完整，請重新登入。')
      return
    }
    window.history.replaceState({}, '', '/auth/callback')

    dispatch(socialLoginMember(ticket))
      .unwrap()
      .then(() => {
        dispatch(fetchWallet())
        dispatch(fetchDiamondBalance())
        dispatch(fetchRanks())
        navigate('/games', { replace: true })
      })
      .catch((message) => setError(message || '第三方登入失敗'))
  }, [dispatch, error, navigate, searchParams])

  return (
    <main
      className="theme-background grid min-h-screen place-items-center px-4 text-white"
      style={getBackgroundStyle('auth')}
    >
      <section className="luxury-panel w-full max-w-lg rounded p-8 text-center">
        <p className="gold-muted text-xs font-black uppercase tracking-[0.3em]">Secure Login</p>
        <h1 className="brand-title mt-3 text-3xl font-black">
          {error ? '第三方登入未完成' : '正在完成登入'}
        </h1>
        <p className={`mt-5 text-sm font-bold leading-6 ${error ? 'text-red-200' : 'text-yellow-100/70'}`}>
          {error || '正在交換一次性登入票據並載入會員資料，請稍候。'}
        </p>
        {error && (
          <Link to="/member?mode=login" className="gold-button mt-6 inline-block rounded px-5 py-3 text-sm font-black">
            返回登入
          </Link>
        )}
      </section>
    </main>
  )
}
