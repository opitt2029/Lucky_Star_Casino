import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useDispatch, useSelector } from 'react-redux'
import { fetchProfile } from './store/slices/authSlice'

import Home from './pages/Home'
import Member from './pages/Member'
import Lobby from './pages/Lobby'
import SlotGame from './pages/SlotGame'
import Baccarat from './pages/Baccarat'
import Rank from './pages/Rank'
import Profile from './pages/Profile'
import Transactions from './pages/Transactions'
import CasinoShop from './pages/CasinoShop'
import PageTransition from './components/PageTransition'

function PrivateRoute({ children }) {
  const isAuthenticated = useSelector((state) => state.auth.isAuthenticated)
  const location = useLocation()
  return isAuthenticated ? children : <Navigate to="/member" replace state={{ from: location }} />
}

export default function App() {
  const dispatch = useDispatch()
  const { isAuthenticated, player } = useSelector((state) => state.auth)

  // 頁面重整後 token 還在，但 player 是 null，自動重新抓一次 profile
  useEffect(() => {
    if (isAuthenticated && !player) {
      dispatch(fetchProfile())
    }
  }, [dispatch, isAuthenticated, player])

  return (
    <BrowserRouter>
      <PageTransition>
        <Routes>
          {/* Public routes */}
          <Route path="/" element={<Home />} />
          <Route path="/member" element={<Member />} />
          <Route path="/login" element={<Navigate to="/member?mode=login" replace />} />
          <Route path="/register" element={<Navigate to="/member?mode=register" replace />} />

          {/* Protected routes */}
          <Route
            path="/games"
            element={
              <PrivateRoute>
                <Lobby />
              </PrivateRoute>
            }
          />
          <Route
            path="/game/slot"
            element={
              <PrivateRoute>
                <SlotGame />
              </PrivateRoute>
            }
          />
          <Route
            path="/game/baccarat"
            element={
              <PrivateRoute>
                <Baccarat />
              </PrivateRoute>
            }
          />
          <Route
            path="/shop"
            element={
              <PrivateRoute>
                <CasinoShop />
              </PrivateRoute>
            }
          />
          <Route
            path="/rank"
            element={
              <PrivateRoute>
                <Rank />
              </PrivateRoute>
            }
          />
          <Route
            path="/profile"
            element={
              <PrivateRoute>
                <Profile />
              </PrivateRoute>
            }
          />
          <Route
            path="/transactions"
            element={
              <PrivateRoute>
                <Transactions />
              </PrivateRoute>
            }
          />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </PageTransition>
    </BrowserRouter>
  )
}
