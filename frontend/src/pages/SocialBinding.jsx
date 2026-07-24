import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import AppShell from '../components/AppShell'
import SocialProviderIcon from '../components/SocialProviderIcon'
import { memberApi } from '../services/memberApi'
import { socialProviders } from '../utils/memberPreferences'

export default function SocialBinding() {
  const { provider: providerParam } = useParams()
  const [searchParams] = useSearchParams()
  const providerId = String(providerParam || '').toLowerCase()
  const provider = useMemo(
    () => socialProviders.find((item) => item.id === providerId),
    [providerId],
  )
  const [binding, setBinding] = useState(null)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [successOpen, setSuccessOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!provider) return undefined
    let active = true
    setLoading(true)
    setError('')
    const bindingSucceeded = searchParams.get('status') === 'success'
    setMessage(bindingSucceeded ? `${provider.label} 已完成綁定` : '')
    setSuccessOpen(bindingSucceeded)
    memberApi.getSocialBindings()
      .then((bindings) => {
        if (!active) return
        setBinding((bindings || []).find((item) => item.provider === provider.id) || null)
      })
      .catch(() => {
        if (active) setError('無法取得綁定狀態，請稍後再試。')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [provider, searchParams])

  if (!provider) return <Navigate to="/profile" replace />

  const beginBinding = async () => {
    setWorking(true)
    setError('')
    setMessage('')
    try {
      const start = await memberApi.startSocialBinding(provider.id)
      window.location.assign(start.authorizationUrl)
    } catch (bindingError) {
      setError(bindingError.response?.data?.message || '無法啟動綁定，請稍後再試。')
      setWorking(false)
    }
  }

  const removeBinding = async () => {
    setWorking(true)
    setError('')
    setMessage('')
    try {
      const next = await memberApi.removeSocialBinding(provider.id)
      setBinding(next)
      setMessage(provider.label + ' 已解除綁定')
      setSuccessOpen(false)
    } catch {
      setError('解除綁定失敗，請稍後再試。')
    } finally {
      setWorking(false)
    }
  }

  const bound = Boolean(binding?.bound)
  const panelClassName = ['luxury-panel rounded p-6', provider.accentClass, provider.glowClass]
    .filter(Boolean)
    .join(' ')
  const dialogClassName = ['luxury-panel w-full max-w-lg rounded p-6 text-center', provider.accentClass]
    .filter(Boolean)
    .join(' ')

  return (
    <AppShell>
      <section className="grid gap-5 lg:grid-cols-[0.42fr_0.58fr]">
        <div className={panelClassName}>
          <p className="gold-muted text-xs font-black uppercase tracking-[0.3em]">Account Link</p>
          <div className="mt-5 flex items-center gap-4">
            <SocialProviderIcon provider={provider.id} className="h-24 w-24 drop-shadow-2xl" />
            <div>
              <h1 className="brand-title text-3xl font-black">綁定 {provider.label}</h1>
              <p className="mt-2 text-sm font-bold text-yellow-100/70">
                {bound
                  ? '此帳戶已完成 OAuth 綁定，現在可以使用第三方登入。'
                  : '前往第三方官方授權頁，確認身分後會自動返回。'}
              </p>
            </div>
          </div>
        </div>

        <div className="luxury-panel-soft rounded p-6">
          <h2 className="brand-title text-2xl font-black">第三方帳戶授權</h2>
          <div className="mt-5 grid gap-3 text-sm font-bold text-yellow-100/72">
            <div className="rounded border border-yellow-200/15 bg-red-950/60 p-4">
              <p className="text-yellow-100">授權方式</p>
              <p className="mt-2 break-all text-yellow-100/58">
                {loading
                  ? '正在確認綁定狀態...'
                  : `使用 ${provider.label} OAuth 2.0 / OpenID Connect 驗證`}
              </p>
            </div>
            <div className="rounded border border-yellow-200/15 bg-red-950/60 p-4">
              <p className="text-yellow-100">接下來會發生什麼</p>
              <p className="mt-2 text-yellow-100/58">
                系統只保存第三方提供的穩定帳戶識別碼，不會取得或保存你的第三方密碼。
              </p>
            </div>
          </div>

          {message && (
            <p className="mt-4 rounded border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm font-bold text-emerald-200">
              {message}
            </p>
          )}
          {error && (
            <p className="mt-4 rounded border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-200">
              {error}
            </p>
          )}

          <div className="mt-6 flex flex-wrap gap-3">
            {bound ? (
              <button
                type="button"
                onClick={removeBinding}
                disabled={working || loading}
                className="red-gold-button rounded px-5 py-3 text-sm font-black disabled:cursor-not-allowed disabled:opacity-60"
              >
                {working ? '處理中...' : '解除綁定'}
              </button>
            ) : (
              <button
                type="button"
                onClick={beginBinding}
                disabled={working || loading}
                className="gold-button rounded px-5 py-3 text-sm font-black disabled:cursor-not-allowed disabled:opacity-60"
              >
                {working ? '正在前往授權...' : '使用 ' + provider.label + ' 完成綁定'}
              </button>
            )}
            <Link to="/profile" className="red-gold-button rounded px-5 py-3 text-sm font-black">
              回會員中心
            </Link>
          </div>
        </div>
      </section>

      {successOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-4 backdrop-blur-sm">
          <section className={dialogClassName} role="dialog" aria-modal="true" aria-labelledby="social-binding-success-title">
            <div className="mx-auto grid h-24 w-24 place-items-center rounded-full border border-yellow-200/30 bg-red-950/70 shadow-2xl shadow-yellow-200/10">
              <SocialProviderIcon provider={provider.id} className="h-16 w-16 drop-shadow-2xl" />
            </div>
            <p className="gold-muted mt-5 text-xs font-black uppercase tracking-[0.3em]">Binding Complete</p>
            <h2 id="social-binding-success-title" className="brand-title mt-2 text-3xl font-black">
              {provider.label} 綁定成功
            </h2>
            <p className="mx-auto mt-3 max-w-sm text-sm font-bold leading-6 text-yellow-100/72">
              {provider.label} 帳戶已安全加入會員中心，之後可以直接從登入頁使用第三方登入。
            </p>
            <div className="mt-5 grid gap-2 rounded border border-yellow-200/15 bg-red-950/60 p-4 text-left text-sm font-bold text-yellow-100/70">
              <p className="text-yellow-100">目前狀態：已完成綁定</p>
              <p>你可以回會員中心查看綁定卡片，或登出後測試第三方登入。</p>
            </div>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <button
                type="button"
                onClick={() => setSuccessOpen(false)}
                className="red-gold-button rounded px-5 py-3 text-sm font-black"
              >
                留在此頁
              </button>
              <Link to="/profile" className="gold-button rounded px-5 py-3 text-sm font-black">
                回會員中心
              </Link>
            </div>
          </section>
        </div>
      )}
    </AppShell>
  )
}
