# 提示詞：瀏覽器「上一頁」防呆機制

你是這個 Lucky Star Casino monorepo 的前端開發者。
專案：React + Redux 前端，React Router v6，`frontend/src/` 為前端根目錄。

---

## 問題描述

玩家在遊戲頁面（老虎機 `/game/slot`、百家樂 `/game/baccarat`、捕魚機 `/game/fishing`）
按瀏覽器「上一頁」時，有機率導致帳號被登出。

### 根因分析

`frontend/src/App.jsx` 的 `PrivateRoute`（L24-28）：
```jsx
function PrivateRoute({ children }) {
  const isAuthenticated = useSelector((state) => state.auth.isAuthenticated)
  const location = useLocation()
  return isAuthenticated ? children : <Navigate to="/member?mode=login" replace state={{ from: location }} />
}
```

`frontend/src/store/slices/authSlice.js` 的 `initialState`（L5-13）：
```js
const initialState = {
  accessToken: localStorage.getItem('accessToken') || null,
  isAuthenticated: Boolean(localStorage.getItem('accessToken')),
  ...
}
```

**問題流程**：
1. 玩家在遊戲頁面按「上一頁」→ React Router popstate 觸發 → 導航至前一頁（可能是登入頁 `/member`）。
2. `/member` 頁面的登入表單在某些情況下會呼叫 logout（例如：token 過期被 axios interceptor 攔截、或 `/member` 頁有清除 token 的 side effect）。
3. 一旦 localStorage 中 `accessToken` 被清除，Redux `isAuthenticated` 變 false，後續任何 PrivateRoute 都會重新導向登入。

**另一個觸發場景**：捕魚機有進行中的場次（`phase === 'playing'`），按上一頁離開後 `useFishingSession` 的 cleanup effect 沒有結算，場次懸空。

---

## 修正方向

### 方案 A：在遊戲頁加「離開確認」攔截（主要修正）

對三個遊戲頁面（`SlotGame.jsx`、`Baccarat.jsx`、`Fishing.jsx`）加 `popstate` 攔截：
當有進行中遊戲時，按上一頁彈出確認框，取消則留在原頁，確認才允許離開。

React Router v6.4+ 提供 `unstable_useBlocker`（或較新版本的 `useBlocker`），可在路由層攔截導航。

### 方案 B：`/member` 頁避免登出副作用（防禦性修正）

確保 `/member` 頁（`frontend/src/pages/Member.jsx`）和 `memberApi.js` 的 axios interceptor
在 token 仍有效的情況下，不會主動呼叫 logout。

---

## 實作指引

### Step 1：新增通用 hook `useGameLeaveGuard`

**新建**：`frontend/src/hooks/useGameLeaveGuard.js`

```js
import { useEffect } from 'react'

/**
 * 遊戲頁離開防呆：active 為 true 時，瀏覽器上一頁/關閉頁籤前彈出確認。
 * active: 是否有進行中的遊戲（false 時完全不攔截）
 * message: 確認框文字
 */
export function useGameLeaveGuard(active, message = '確定要離開遊戲嗎？進行中的遊戲可能遺失。') {
  useEffect(() => {
    if (!active) return undefined

    // 攔截頁籤關閉 / 重整
    const handleBeforeUnload = (e) => {
      e.preventDefault()
      e.returnValue = message  // Chrome 需要設定 returnValue
    }

    // 攔截瀏覽器上一頁（popstate）
    // 先把目前路由推一次 history，讓 back 按第一次只是回到「剛剛推的這筆」
    window.history.pushState(null, '', window.location.href)
    const handlePopState = () => {
      const confirmed = window.confirm(message)
      if (confirmed) {
        // 使用者確認離開：再往前跳兩步（抵消剛才 pushState 的那步 + 真正的回上一頁）
        window.history.go(-2)
      } else {
        // 使用者取消：重新推一次，讓 back 按鈕繼續有效攔截
        window.history.pushState(null, '', window.location.href)
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    window.addEventListener('popstate', handlePopState)

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      window.removeEventListener('popstate', handlePopState)
    }
  }, [active, message])
}
```

### Step 2：在各遊戲頁引入 hook

**`frontend/src/pages/SlotGame.jsx`**

在 `handleSpinRound` 前加：
```js
import { useGameLeaveGuard } from '../hooks/useGameLeaveGuard'

// 在 Component 內，loading 或 visualLock 為 true 時視為「進行中」
useGameLeaveGuard(loading || visualLock, '轉輪進行中，確定要離開嗎？離開後本局下注不返還。')
```

**`frontend/src/pages/Baccarat.jsx`**

```js
import { useGameLeaveGuard } from '../hooks/useGameLeaveGuard'

// 在 Component 內，找到「有下注但尚未開牌」的狀態（betting phase）
// 依現有 state 判斷：loading 中或有待定下注時攔截
useGameLeaveGuard(loading, '下注進行中，確定要離開嗎？')
```

**`frontend/src/pages/Fishing.jsx`**

```js
import { useGameLeaveGuard } from '../hooks/useGameLeaveGuard'

// phase === 'playing' 時攔截（有進行中場次）
useGameLeaveGuard(
  phase === 'playing',
  '捕魚場次進行中，確定要離開嗎？離開後局內餘額將在 30 分鐘內自動結算退回。'
)
```

### Step 3：修正 `memberApi.js` axios interceptor 防止誤觸登出

**檔案**：`frontend/src/services/memberApi.js`

找到 axios response interceptor（L69-71 附近）：
```js
localStorage.removeItem('accessToken')
localStorage.removeItem('refreshToken')
```

確認這段只在 **401 Unauthorized** 時執行，不應在其他 HTTP 錯誤（400、404、500）時清除 token：

```js
// 確認 interceptor 結構如下（只 401 才登出）：
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('accessToken')
      localStorage.removeItem('refreshToken')
      // 可選：dispatch logout action 或導向登入頁
    }
    return Promise.reject(error)
  }
)
```

若目前 interceptor 對所有 error 都清除 token，修正為只在 401 時清除。

---

## 注意事項

- `window.history.pushState` 的攔截方式在 iOS Safari 上有已知限制：第一次按上一頁無法攔截，第二次才有效。這是瀏覽器安全限制，無法完全規避，可在確認框說明文字中補充提示。
- `beforeunload` 的自訂訊息文字在 Chrome 86+ 已不顯示（統一顯示瀏覽器預設文字），這是瀏覽器安全政策，不影響攔截功能本身。
- 捕魚機的 `useGameLeaveGuard` 訊息中提到「30 分鐘自動結算」，對應後端 `FishingService.IDLE_TIMEOUT_MINUTES`，確保文案一致。

---

## 驗證步驟

1. 開始一局老虎機（轉輪動畫進行中），按瀏覽器上一頁 → 應彈出確認框。
2. 點「取消」→ 應停留在老虎機頁面，帳號不登出。
3. 點「確認」→ 應正常導回上一頁，帳號保持登入狀態。
4. 老虎機轉輪結束（`visualLock = false`）後，按上一頁 → 應直接離開，不出現確認框。
5. 捕魚機開場後（`phase === 'playing'`），按上一頁 → 彈出確認框，文案含「自動結算」說明。
6. 關閉瀏覽器分頁（進行中遊戲時）→ 彈出瀏覽器原生「確定離開？」提示。
