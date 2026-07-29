import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useDispatch, useSelector } from 'react-redux'
import { fetchProfile } from './store/slices/authSlice'

import Home from './pages/Home'
import Member from './pages/Member'
import ErrorBoundary from './components/ErrorBoundary'
import PageTransition from './components/PageTransition'
import QuickToolbar from './components/QuickToolbar'
import FriendFloatingPanel from './components/FriendFloatingPanel'
import MobileBottomNav from './components/MobileBottomNav'
import SupportModal from './components/SupportModal'
import GlobalAnnouncementHost from './casino-fx/announce/GlobalAnnouncementHost'

const Lobby = lazy(() => import('./pages/Lobby'))
const SlotGame = lazy(() => import('./pages/SlotGame'))
const Baccarat = lazy(() => import('./pages/Baccarat'))
const Fishing = lazy(() => import('./pages/Fishing'))
const Rank = lazy(() => import('./pages/Rank'))
const Profile = lazy(() => import('./pages/Profile'))
const SocialBinding = lazy(() => import('./pages/SocialBinding'))
const OAuthCallback = lazy(() => import('./pages/OAuthCallback'))
const SocialRegister = lazy(() => import('./pages/SocialRegister'))
const Records = lazy(() => import('./pages/Records'))
const CasinoShop = lazy(() => import('./pages/CasinoShop'))
const Inventory = lazy(() => import('./pages/Inventory'))
const CheckIn = lazy(() => import('./pages/CheckIn'))
const Diamond = lazy(() => import('./pages/Diamond'))
const Topup = lazy(() => import('./pages/Topup'))
const TopupPayment = lazy(() => import('./pages/TopupPayment'))
const ProvablyFair = lazy(() => import('./pages/ProvablyFair'))
const NotFound = lazy(() => import('./pages/NotFound'))

const enableDevTools = import.meta.env.VITE_ENABLE_DEV_TOOLS === 'true'
const Fairness = enableDevTools ? lazy(() => import('./pages/Fairness')) : null
const IntegrationTestPage = enableDevTools
  ? lazy(() => import('./pages/IntegrationTestPage'))
  : null

function RouteFallback() {
  return (
    <div className="route-fallback" role="status" aria-live="polite">
      <span className="route-fallback__mark" aria-hidden="true" />
      <span>頁面載入中...</span>
    </div>
  )
}

function LazyPage({ children }) {
  const location = useLocation()
  return (
    <ErrorBoundary key={location.pathname}>
      <Suspense fallback={<RouteFallback />}>{children}</Suspense>
    </ErrorBoundary>
  )
}

function PrivateRoute({ children }) {
  const authStatus = useSelector((state) => state.auth.authStatus)
  const location = useLocation()

  if (authStatus === 'checking') return <RouteFallback />
  if (authStatus === 'authenticated') return children

  return <Navigate to="/member?mode=login" replace state={{ from: location }} />
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
  const isGamePage = location.pathname.startsWith('/game/')
  const isPublicAuthPage =
    location.pathname === '/' ||
    location.pathname.startsWith('/member') ||
    location.pathname.startsWith('/auth/callback')

  if (isStandaloneTool) return null

  return (
    <>
      <GlobalAnnouncementHost />
      {!isGamePage && (
        <>
          <div className="hidden md:block">
            <QuickToolbar />
          </div>
          <div className="hidden md:block">
            <FriendFloatingPanel />
          </div>
          {!isPublicAuthPage && <MobileBottomNav />}
        </>
      )}
      <SupportModal />
    </>
  )
}

export default function App() {
  const dispatch = useDispatch()
  const { authStatus, accessToken, player, profileLoading } = useSelector((state) => state.auth)

  useEffect(() => {
    if (authStatus === 'checking' && accessToken && !player && !profileLoading) {
      dispatch(fetchProfile())
    }
  }, [accessToken, authStatus, dispatch, player, profileLoading])

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
            path="/auth/callback"
            element={
              <LazyPage>
                <OAuthCallback />
              </LazyPage>
            }
          />
          <Route
            path="/auth/social/register"
            element={
              <LazyPage>
                <SocialRegister />
              </LazyPage>
            }
          />
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
            path="/topup/pay/:orderId"
            element={
              <ProtectedPage>
                <TopupPayment />
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
          <Route
            path="*"
            element={
              <LazyPage>
                <NotFound />
              </LazyPage>
            }
          />
        </Routes>
      </PageTransition>
      <SiteChrome />
    </BrowserRouter>
  )
}
