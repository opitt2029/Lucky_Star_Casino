import { configureStore } from '@reduxjs/toolkit'
import authReducer from './slices/authSlice'
import walletReducer from './slices/walletSlice'
import gameReducer from './slices/gameSlice'
import rankReducer from './slices/rankSlice'

const store = configureStore({
  reducer: {
    auth: authReducer,
    wallet: walletReducer,
    game: gameReducer,
    rank: rankReducer,
  },
})

export default store
