import { Link, useLocation } from 'react-router-dom'
import AppShell from '../components/AppShell'

export default function NotFound() {
  const location = useLocation()

  return (
    <AppShell>
      <section className="luxury-panel grid min-h-[58vh] content-center gap-6 overflow-hidden rounded p-6 text-center sm:p-10">
        <div>
          <p className="gold-muted text-xs font-black uppercase tracking-[0.35em]">404 Not Found</p>
          <h2 className="brand-title mt-4 text-4xl font-black sm:text-6xl">找不到這個入口</h2>
          <p className="mx-auto mt-4 max-w-2xl text-sm font-bold leading-7 text-yellow-100/72 sm:text-base">
            目前沒有對應「{location.pathname}
            」的頁面。你可以回到遊戲大廳、查看交易紀錄，或回首頁重新選擇服務。
          </p>
        </div>

        <div className="flex flex-wrap justify-center gap-3">
          <Link to="/" className="gold-button rounded px-5 py-3 text-sm font-black transition">
            回首頁
          </Link>
          <Link
            to="/games"
            className="red-gold-button rounded px-5 py-3 text-sm font-black transition"
          >
            遊戲大廳
          </Link>
          <Link
            to="/records"
            className="rounded border border-yellow-200/25 bg-red-950/70 px-5 py-3 text-sm font-black text-yellow-100 transition hover:border-yellow-200/70"
          >
            交易/遊戲紀錄
          </Link>
        </div>
      </section>
    </AppShell>
  )
}
