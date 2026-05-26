import { createSlice } from '@reduxjs/toolkit'

const initialState = {
  accessToken: localStorage.getItem('accessToken') || null,
  player: null,
  isAuthenticated: false,
}

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    loginSuccess(state, action) {
      const { accessToken, player } = action.payload
      state.accessToken = accessToken
      state.player = player
      state.isAuthenticated = true
      localStorage.setItem('accessToken', accessToken)
    },
    logout(state) {
      state.accessToken = null
      state.player = null
      state.isAuthenticated = false
      localStorage.removeItem('accessToken')
    },
    setPlayer(state, action) {
      state.player = action.payload
      state.isAuthenticated = true
    },
  },
})

export const { loginSuccess, logout, setPlayer } = authSlice.actions
export default authSlice.reducer
