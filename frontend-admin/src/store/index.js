import { configureStore } from '@reduxjs/toolkit'
import adminAuthReducer from './slices/adminAuthSlice'

const store = configureStore({
  reducer: {
    adminAuth: adminAuthReducer,
  },
})

export default store
