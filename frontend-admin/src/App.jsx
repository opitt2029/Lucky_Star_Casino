import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useSelector } from 'react-redux'

import Login from './pages/Login'
import AdminLayout from './components/AdminLayout'

// SPA 路由不用 /admin 前綴：/admin/** 是 API 路徑（dev proxy 轉發 gateway），前綴撞了會被 proxy 吃掉
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Players = lazy(() => import('./pages/Players'))
const PlayerDetail = lazy(() => import('./pages/PlayerDetail'))
const CoinFlowReport = lazy(() => import('./pages/CoinFlowReport'))
const RtpReport = lazy(() => import('./pages/RtpReport'))
const GmGrant = lazy(() => import('./pages/GmGrant'))
const DiamondCards = lazy(() => import('./pages/DiamondCards'))
const ShopItems = lazy(() => import('./pages/ShopItems'))

function RouteFallback() {
  return (
    <div className="flex items-center justify-center py-20 text-slate-400" role="status">
      頁面載入中...
    </div>
  )
}

// 判斷的是 adminAuth（ADMIN JWT），與玩家端 PrivateRoute 的 auth 是兩套系統
function AdminPrivateRoute({ children }) {
  const isAuthenticated = useSelector((state) => state.adminAuth.isAuthenticated)
  return isAuthenticated ? children : <Navigate to="/login" replace />
}

// 前端角色守門只是體驗層（少一次 403 往返）；實際授權以後端 @PreAuthorize 為準
function SuperAdminRoute({ children }) {
  const role = useSelector((state) => state.adminAuth.role)
  return role === 'SUPER_ADMIN' ? children : <Navigate to="/" replace />
}

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/login" element={<Login />} />

        {/* 受保護區：共用側邊欄 Layout，內容由子路由 Outlet 渲染 */}
        <Route
          element={
            <AdminPrivateRoute>
              <AdminLayout />
            </AdminPrivateRoute>
          }
        >
          <Route
            path="/"
            element={
              <Suspense fallback={<RouteFallback />}>
                <Dashboard />
              </Suspense>
            }
          />
          <Route
            path="/players"
            element={
              <Suspense fallback={<RouteFallback />}>
                <Players />
              </Suspense>
            }
          />
          <Route
            path="/players/:playerId"
            element={
              <Suspense fallback={<RouteFallback />}>
                <PlayerDetail />
              </Suspense>
            }
          />
          <Route
            path="/reports/coin-flow"
            element={
              <Suspense fallback={<RouteFallback />}>
                <CoinFlowReport />
              </Suspense>
            }
          />
          <Route
            path="/reports/rtp"
            element={
              <Suspense fallback={<RouteFallback />}>
                <RtpReport />
              </Suspense>
            }
          />
          <Route
            path="/gm/grant"
            element={
              <SuperAdminRoute>
                <Suspense fallback={<RouteFallback />}>
                  <GmGrant />
                </Suspense>
              </SuperAdminRoute>
            }
          />
          <Route
            path="/diamond/cards"
            element={
              <Suspense fallback={<RouteFallback />}>
                <DiamondCards />
              </Suspense>
            }
          />
          <Route
            path="/shop/items"
            element={
              <Suspense fallback={<RouteFallback />}>
                <ShopItems />
              </Suspense>
            }
          />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
