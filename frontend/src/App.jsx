import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useDispatch, useSelector } from 'react-redux'
import { fetchProfile } from './store/slices/authSlice'

import Home from './pages/Home'
import Member from './pages/Member'
import PageTransition from './components/PageTransition'
import QuickToolbar from './components/QuickToolbar'
import FriendFloatingPanel from './components/FriendFloatingPanel'
import SupportModal from './components/SupportModal'

const Lobby = lazy(() => import('./pages/Lobby'))
const SlotGame = lazy(() => import('./pages/SlotGame'))
const Baccarat = lazy(() => import('./pages/Baccarat'))
const Fishing = lazy(() => import('./pages/Fishing'))
const Rank = lazy(() => import('./pages/Rank'))
const Profile = lazy(() => import('./pages/Profile'))
const SocialBinding = lazy(() => import('./pages/SocialBinding'))
const Records = lazy(() => import('./pages/Records'))
const CasinoShop = lazy(() => import('./pages/CasinoShop'))
const Inventory = lazy(() => import('./pages/Inventory'))
const CheckIn = lazy(() => import('./pages/CheckIn'))
const Diamond = lazy(() => import('./pages/Diamond'))
const Topup = lazy(() => import('./pages/Topup'))
const ProvablyFair = lazy(() => import('./pages/ProvablyFair'))

const enableDevTools = import.meta.env.VITE_ENABLE_DEV_TOOLS === 'true'
const Fairness = enableDevTools ? lazy(() => import('./pages/Fairness')) : null
const IntegrationTestPage = enableDevTools ? lazy(() => import('./pages/IntegrationTestPage')) : null

function RouteFallback() {
  return (
    <div className="route-fallback" role="status" aria-live="polite">
      <span className="route-fallback__mark" aria-hidden="true" />
      <span>?頛銝?..</span>
    </div>
  )
}

function LazyPage({ children }) {
  return <Suspense fallback={<RouteFallback />}>{children}</Suspense>
}

function PrivateRoute({ children }) {
  const isAuthenticated = useSelector((state) => state.auth.isAuthenticated)
  const location = useLocation()
  return isAuthenticated ? children : <Navigate to="/member?mode=login" replace state={{ from: location }} />
}

function ProtectedPage({ children }) {
  return (
    <PrivateRoute>
      <LazyPage>{children}</LazyPage>
    </PrivateRoute>
  )
}

function SiteChrome() {
  const location = useLocation()
  const isStandaloneTool = enableDevTools && location.pathname.startsWith('/dev/integration')

  if (isStandaloneTool) return null

  return (
    <>
      <QuickToolbar />
      <FriendFloatingPanel />
      <SupportModal />

    </>
  )
}

export default function App() {
  const dispatch = useDispatch()
  const { isAuthenticated, player } = useSelector((state) => state.auth)

  useEffect(() => {
    if (isAuthenticated && !player) {
      dispatch(fetchProfile())
    }
  }, [dispatch, isAuthenticated, player])

  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <PageTransition>
        <Routes>
          {/* Public routes */}
          <Route path="/" element={<Home />} />
          <Route path="/member" element={<Member />} />
          <Route path="/login" element={<Navigate to="/member?mode=login" replace />} />
          <Route path="/register" element={<Navigate to="/member?mode=register" replace />} />
          <Route
            path="/shop"
            element={
              <LazyPage>
                <CasinoShop />
              </LazyPage>
            }
          />

          {/* Protected routes */}
          <Route
            path="/check-in"
            element={
              <ProtectedPage>
                <CheckIn />
              </ProtectedPage>
            }
          />
          <Route
            path="/games"
            element={
              <ProtectedPage>
                <Lobby />
              </ProtectedPage>
            }
          />
          <Route
            path="/diamond"
            element={
              <ProtectedPage>
                <Diamond />
              </ProtectedPage>
            }
          />
          <Route
            path="/topup"
            element={
              <ProtectedPage>
                <Topup />
              </ProtectedPage>
            }
          />
          <Route
            path="/game/slot"
            element={
              <ProtectedPage>
                <SlotGame />
              </ProtectedPage>
            }
          />
          <Route
            path="/game/baccarat"
            element={
              <ProtectedPage>
                <Baccarat />
              </ProtectedPage>
            }
          />
          <Route
            path="/game/fishing"
            element={
              <ProtectedPage>
                <Fishing />
              </ProtectedPage>
            }
          />
          <Route
            path="/rank"
            element={
              <ProtectedPage>
                <Rank />
              </ProtectedPage>
            }
          />
          <Route
            path="/profile"
            element={
              <ProtectedPage>
                <Profile />
              </ProtectedPage>
            }
          />
          <Route
            path="/profile/social-bindings/:provider"
            element={
              <ProtectedPage>
                <SocialBinding />
              </ProtectedPage>
            }
          />
          <Route
            path="/inventory"
            element={
              <ProtectedPage>
                <Inventory />
              </ProtectedPage>
            }
          />
          <Route
            path="/records"
            element={
              <ProtectedPage>
                <Records />
              </ProtectedPage>
            }
          />
          <Route
            path="/provably-fair"
            element={
              <ProtectedPage>
                <ProvablyFair />
              </ProtectedPage>
            }
          />

          {enableDevTools && Fairness && (
            <Route
              path="/dev/fairness"
              element={
                <ProtectedPage>
                  <Fairness />
                </ProtectedPage>
              }
            />
          )}
          {enableDevTools && IntegrationTestPage && (
            <Route
              path="/dev/integration"
              element={
                <ProtectedPage>
                  <IntegrationTestPage />
                </ProtectedPage>
              }
            />
          )}
          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </PageTransition>
      <SiteChrome />
    </BrowserRouter>
  )
}
