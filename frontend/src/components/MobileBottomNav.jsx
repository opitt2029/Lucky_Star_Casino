import { NavLink } from 'react-router-dom'
import { useDispatch, useSelector } from 'react-redux'
import { setPendingNavigation } from '../store/slices/uiSlice'

const items = [
  { to: '/games', label: '大廳' },
  { to: '/rank', label: '排行' },
  { to: '/diamond', label: '錢包' },
  { to: '/inventory', label: '背包' },
  { to: '/profile', label: '我的' },
]

export default function MobileBottomNav() {
  const dispatch = useDispatch()
  const authStatus = useSelector((state) => state.auth.authStatus)
  const leaveGuard = useSelector((state) => state.ui.leaveGuard)

  if (authStatus !== 'authenticated') return null

  const handleNavigate = (path, event) => {
    if (!leaveGuard.active) return
    event.preventDefault()
    dispatch(setPendingNavigation(path))
  }

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-yellow-200/20 bg-red-950/95 px-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2 shadow-[0_-14px_40px_rgba(0,0,0,0.42)] backdrop-blur md:hidden"
      aria-label="手機版主要導覽"
    >
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          onClick={(event) => handleNavigate(item.to, event)}
          className={({ isActive }) =>
            [
              'grid min-h-12 place-items-center rounded px-1 text-xs font-black transition focus:outline-none focus:ring-2 focus:ring-yellow-200/70',
              isActive
                ? 'bg-yellow-200 text-red-950'
                : 'text-yellow-100/68 hover:bg-red-900/80 hover:text-yellow-100',
            ].join(' ')
          }
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  )
}
