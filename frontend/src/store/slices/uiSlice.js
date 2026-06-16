import { createSlice } from '@reduxjs/toolkit'

// 全域 UI 狀態：目前用於跨元件控制「客服說明」彈窗。
// 彈窗 markup 在 App 根層的 SupportModal，AppShell 頭像下拉與 QuickToolbar「客服」
// 兩個入口都 dispatch openSupport，行為一致、且不受 AppShell 是否掛載影響。
const initialState = {
  supportOpen: false,
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
  },
})

export const { openSupport, closeSupport } = uiSlice.actions
export default uiSlice.reducer
