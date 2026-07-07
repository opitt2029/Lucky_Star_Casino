import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useDispatch, useSelector } from 'react-redux'
import { logout } from '../store/slices/adminAuthSlice'

const NAV_ITEMS = [
  { to: '/', label: '總覽', end: true },
  { to: '/players', label: '玩家管理' },
  { to: '/reports/coin-flow', label: '星幣流通量' },
  { to: '/reports/rtp', label: 'RTP 監控' },
  { to: '/diamond/cards', label: '鑽石點數卡' },
  { to: '/shop/items', label: '商城目錄' },
  // GM 發幣是敏感操作，OPERATOR 連入口都不顯示（後端另有 @PreAuthorize 擋 403）
  { to: '/gm/grant', label: 'GM 發幣', superAdminOnly: true },
]

const ROLE_LABEL = {
  SUPER_ADMIN: '超級管理員',
  OPERATOR: '營運人員',
}

export default function AdminLayout() {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const { username, role } = useSelector((state) => state.adminAuth)

  const visibleItems = NAV_ITEMS.filter((item) => !item.superAdminOnly || role === 'SUPER_ADMIN')

  function handleLogout() {
    dispatch(logout())
    navigate('/login', { replace: true })
  }

  return (
    <div className="flex min-h-screen">
      {/* 側邊欄 */}
      <aside className="flex w-56 shrink-0 flex-col bg-slate-900 text-slate-200">
        <div className="border-b border-slate-700 px-4 py-5">
          <div className="text-lg font-bold text-white">幸運星幣城</div>
          <div className="text-xs text-slate-400">管理後台</div>
        </div>
        <nav className="flex-1 space-y-1 px-2 py-4">
          {visibleItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `block rounded px-3 py-2 text-sm transition-colors ${
                  isActive ? 'bg-slate-700 text-white' : 'hover:bg-slate-800 hover:text-white'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-700 px-4 py-4 text-sm">
          <div className="text-white">{username}</div>
          <div className="mb-3 text-xs text-slate-400">{ROLE_LABEL[role] || role}</div>
          <button
            type="button"
            onClick={handleLogout}
            className="w-full rounded bg-slate-700 px-3 py-1.5 text-xs hover:bg-slate-600"
          >
            登出
          </button>
        </div>
      </aside>

      {/* 內容區 */}
      <main className="flex-1 overflow-x-auto p-6">
        <Outlet />
      </main>
    </div>
  )
}
