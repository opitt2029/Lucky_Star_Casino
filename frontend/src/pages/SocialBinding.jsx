import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import AppShell from '../components/AppShell'
import SocialProviderIcon from '../components/SocialProviderIcon'
import { memberApi } from '../services/memberApi'
import { socialProviders } from '../utils/memberPreferences'

export default function SocialBinding() {
  const { provider: providerParam } = useParams()
  const providerId = String(providerParam || '').toLowerCase()
  const provider = useMemo(
    () => socialProviders.find((item) => item.id === providerId),
    [providerId],
  )
  const [binding, setBinding] = useState(null)
  const [startInfo, setStartInfo] = useState(null)
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
    setMessage('')
    Promise.all([memberApi.getSocialBindings(), memberApi.startSocialBinding(provider.id)])
      .then(([bindings, start]) => {
        if (!active) return
        setBinding((bindings || []).find((item) => item.provider === provider.id) || null)
        setStartInfo(start)
      })
      .catch(() => {
        if (active) setError('確認連結暫時無法產生，請稍後再試。')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [provider])

  if (!provider) return <Navigate to="/profile" replace />

  const completeBinding = async () => {
    setWorking(true)
    setError('')
    setMessage('')
    try {
      const next = await memberApi.completeSocialBinding(provider.id)
      setBinding(next)
      setMessage(provider.label + ' 已完成綁定')
      setSuccessOpen(true)
    } catch {
      setError('綁定失敗，請稍後再試。')
    } finally {
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
  const authorizationUrl = startInfo?.authorizationUrl || ''
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
                  ? '目前已完成示範綁定，可以回會員中心查看狀態。'
                  : '確認連結產生後，按下完成綁定就會進入成功畫面。'}
              </p>
            </div>
          </div>
        </div>

        <div className="luxury-panel-soft rounded p-6">
          <h2 className="brand-title text-2xl font-black">確認你的綁定連結</h2>
          <div className="mt-5 grid gap-3 text-sm font-bold text-yellow-100/72">
            <div className="rounded border border-yellow-200/15 bg-red-950/60 p-4">
              <p className="text-yellow-100">本次確認連結</p>
              <p className="mt-2 break-all text-yellow-100/58">
                {loading ? '正在產生確認連結...' : authorizationUrl || '目前沒有可用的確認連結'}
              </p>
            </div>
            <div className="rounded border border-yellow-200/15 bg-red-950/60 p-4">
              <p className="text-yellow-100">接下來會發生什麼</p>
              <p className="mt-2 text-yellow-100/58">
                這是展示版綁定流程。系統會模擬完成驗證，讓你可以先確認使用者體驗與畫面狀態。
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
                {working ? '處理中...' : '解除示範綁定'}
              </button>
            ) : (
              <button
                type="button"
                onClick={completeBinding}
                disabled={working || loading || !authorizationUrl}
                className="gold-button rounded px-5 py-3 text-sm font-black disabled:cursor-not-allowed disabled:opacity-60"
              >
                {working ? '綁定中...' : '確認並完成 ' + provider.label + ' 綁定'}
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
              已經幫你把 {provider.label} 帳戶加入會員中心。之後登入或驗證帳戶時，玩家會更清楚知道這個帳戶已經準備好了。
            </p>
            <div className="mt-5 grid gap-2 rounded border border-yellow-200/15 bg-red-950/60 p-4 text-left text-sm font-bold text-yellow-100/70">
              <p className="text-yellow-100">目前狀態：已完成示範綁定</p>
              <p>你可以回會員中心查看綁定卡片，或留在此頁解除示範綁定後再試一次。</p>
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