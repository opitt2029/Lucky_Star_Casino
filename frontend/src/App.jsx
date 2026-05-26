import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useSelector } from 'react-redux'

import Login from './pages/Login'
import Register from './pages/Register'
import Lobby from './pages/Lobby'
import SlotGame from './pages/SlotGame'
import Baccarat from './pages/Baccarat'
import Rank from './pages/Rank'
import Profile from './pages/Profile'
import Transactions from './pages/Transactions'

function PrivateRoute({ children }) {
  const isAuthenticated = useSelector((state) => state.auth.isAuthenticated)
  return isAuthenticated ? children : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />

        {/* Protected routes */}
        <Route
          path="/"
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
    </BrowserRouter>
  )
}
