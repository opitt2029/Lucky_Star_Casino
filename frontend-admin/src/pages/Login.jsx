import { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import { loginAdmin, clearAuthError } from '../store/slices/adminAuthSlice'

export default function Login() {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const { isAuthenticated, loading, error } = useSelector((state) => state.adminAuth)

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  // 已登入（或登入成功後 state 更新）就進後台，避免停留在登入頁
  useEffect(() => {
    if (isAuthenticated) navigate('/', { replace: true })
  }, [isAuthenticated, navigate])

  // 離開頁面時清掉殘留錯誤，避免下次進來還顯示舊訊息
  useEffect(() => () => dispatch(clearAuthError()), [dispatch])

  function handleSubmit(e) {
    e.preventDefault()
    if (loading || !username || !password) return
    dispatch(loginAdmin({ username, password }))
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-lg bg-white p-8 shadow-lg"
      >
        <h1 className="mb-1 text-xl font-bold">幸運星幣城 管理後台</h1>
        <p className="mb-6 text-sm text-slate-500">請以後台帳號登入（ADMIN JWT）</p>

        <label className="mb-4 block">
          <span className="mb-1 block text-sm font-medium">帳號</span>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
          />
        </label>

        <label className="mb-6 block">
          <span className="mb-1 block text-sm font-medium">密碼</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
          />
        </label>

        {error && (
          <p className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-600" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || !username || !password}
          className="w-full rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? '登入中...' : '登入'}
        </button>
      </form>
    </div>
  )
}
