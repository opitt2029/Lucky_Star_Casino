import { createSlice } from '@reduxjs/toolkit'

// 全域 UI 狀態：控制跨元件彈窗（客服說明、遊戲離開確認）。
const initialState = {
  supportOpen: false,
  // 遊戲離開防呆：active 時 AppShell 導航列攔截點擊並彈出確認視窗。
  leaveGuard: {
    active: false,
    message: '',
    pendingPath: null, // 使用者點的目標路由
  },
}

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    openSupport(state) {
      state.supportOpen = true
    },
    closeSupport(state) {
      state.supportOpen = false
    },
    activateLeaveGuard(state, action) {
      state.leaveGuard.active = true
      state.leaveGuard.message = action.payload?.message || '遊戲進行中，確定要離開嗎？'
      state.leaveGuard.pendingPath = null
    },
    deactivateLeaveGuard(state) {
      state.leaveGuard = initialState.leaveGuard
    },
    setPendingNavigation(state, action) {
      state.leaveGuard.pendingPath = action.payload
    },
    clearPendingNavigation(state) {
      state.leaveGuard.pendingPath = null
    },
  },
})

export const {
  openSupport,
  closeSupport,
  activateLeaveGuard,
  deactivateLeaveGuard,
  setPendingNavigation,
  clearPendingNavigation,
} = uiSlice.actions
export default uiSlice.reducer
