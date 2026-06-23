# 提示詞：多帳號 localStorage 數據未隔離 Bug

你是這個 Lucky Star Casino monorepo 的前端開發者。
專案：React + Redux 前端，`frontend/src/` 為前端根目錄。

---

## 問題根源

在同一台電腦切換登入不同帳號時，**幸運值（FortuneMeter）** 與 **百家樂咪牌偏好** 會殘留前一個帳號的數值，導致跨帳號繼承。

掃描所有 localStorage 用法後，問題集中在以下兩處：

### 已確認有 Bug 的 key

| 檔案 | key | 問題 |
|---|---|---|
| `frontend/src/casino-fx/fx/useFortuneMeter.js` | `lucky-star-fortune-v1:slot`<br>`lucky-star-fortune-v1:fishing`<br>`lucky-star-fortune-v1:baccarat` | key 不含玩家 ID，切換帳號後幸運值直接繼承 |
| `frontend/src/pages/Baccarat.jsx` L202 | `lucky-star-baccarat-squeeze-v1` | 咪牌模式偏好不含玩家 ID |

### 已確認無 Bug 的 key（已有玩家 ID 分隔，不需動）

- `lucky-star-checkin-dates-v1` — AppShell.jsx 已以 `playerId` 為 JSON 子 key，正確隔離
- `lucky-star-checkin-auto-open-v1` — 同上，已正確隔離
- `lucky-star-social-bindings-v1` — memberPreferences.js 已以 `playerId` 為子 key，正確隔離
- `accessToken` / `refreshToken` — 登入時覆蓋、登出時清除，無繼承問題
- 音效設定 / QuickToolbar 收合狀態 — 純 UI 偏好，跨帳號共用無害

---

## 修正 1：`useFortuneMeter.js`（最重要）

**檔案**：`frontend/src/casino-fx/fx/useFortuneMeter.js`

### 現狀（L9）
```js
export function useFortuneMeter(gameKey) {
  const storageKey = `${STORAGE_PREFIX}${gameKey}`
```

### 修正後
```js
export function useFortuneMeter(gameKey, playerId) {
  const storageKey = `${STORAGE_PREFIX}${gameKey}:${playerId ?? 'guest'}`
```

**說明**：
- `playerId` 為 `null` 時（未登入），fallback 為 `'guest'`，不影響訪客體驗。
- 切換帳號後，storageKey 不同，各帳號幸運值完全獨立。
- 舊 key（不含 playerId）的殘留數值會被忽略，不需主動清除。

### 呼叫端一起改

**`frontend/src/pages/SlotGame.jsx`**（L33、L44）：
```js
// 現狀（L33 附近）
const player = useSelector((state) => state.auth.player)
// 現狀（L44）
const fortune = useFortuneMeter('slot')

// 修正後
const fortune = useFortuneMeter('slot', player?.id)
```

**`frontend/src/pages/Fishing.jsx`**（L121、L123）：
```js
// 現狀（L121 已有）
const player = useSelector((state) => state.auth.player)
// 現狀（L123）
const fortune = useFortuneMeter('fishing')

// 修正後
const fortune = useFortuneMeter('fishing', player?.id)
```

**`frontend/src/pages/Baccarat.jsx`**（加在 `useFortuneMeter` 呼叫前）：
```js
// 現狀（L247）
const fortune = useFortuneMeter('baccarat')

// 修正後：player 已在 useSelector 取到（L2 附近需確認有無取 player，若無則加）
const player = useSelector((state) => state.auth.player)
const fortune = useFortuneMeter('baccarat', player?.id)
```

---

## 修正 2：百家樂咪牌模式（Baccarat.jsx）

**檔案**：`frontend/src/pages/Baccarat.jsx`

### 現狀（L202、L233、L432）
```js
const SQUEEZE_STORAGE_KEY = 'lucky-star-baccarat-squeeze-v1'
// L231-237 讀取：
const [squeezeMode, setSqueezeMode] = useState(() => {
  try {
    return localStorage.getItem(SQUEEZE_STORAGE_KEY) === 'true'
  } catch { return false }
})
// L432 寫入：
localStorage.setItem(SQUEEZE_STORAGE_KEY, String(next))
```

### 修正後

改成以 playerId 為 JSON 子 key（與 AppShell 的 checkIn 做法一致）：

```js
// key 不變，但讀寫改用 JSON 物件存多帳號
const SQUEEZE_STORAGE_KEY = 'lucky-star-baccarat-squeeze-v1'

// 讀取函式（新增在 Component 外）
function getSqueezeMode(playerId) {
  try {
    const all = JSON.parse(localStorage.getItem(SQUEEZE_STORAGE_KEY) || '{}')
    return all[playerId] === true
  } catch { return false }
}

function setSqueezeMode(playerId, value) {
  try {
    const all = JSON.parse(localStorage.getItem(SQUEEZE_STORAGE_KEY) || '{}')
    localStorage.setItem(SQUEEZE_STORAGE_KEY, JSON.stringify({ ...all, [playerId]: value }))
  } catch {}
}
```

`useState` 初始化改為：
```js
const player = useSelector((state) => state.auth.player)
const [squeezeMode, setSqueezeModeState] = useState(() => getSqueezeMode(player?.id))
```

切換咪牌時（L432 附近）改為：
```js
setSqueezeModeState(next)
setSqueezeMode(player?.id, next)  // 寫入（同名函式，注意命名與 state setter 區分）
```

> 注意：`useState` setter 和上面定義的工具函式名稱衝突，把 `useState` 的 setter 改名為 `setSqueezeModeState`，工具函式保持 `setSqueezeMode`。

---

## 同時確認：登出時是否需要清除幸運值

幸運值存在 localStorage，登出時**不需主動清除**，原因：
- key 已包含 `playerId`，下一個帳號天然看不到。
- 同一帳號再次登入時，幸運值延續是合理的遊戲設計（玩家期望繼續累積）。

---

## 驗證步驟

1. 帳號 A 登入，在老虎機下注讓幸運值升至 50 以上。
2. 登出，換帳號 B 登入。
3. 確認帳號 B 的幸運值從 0 開始，不繼承帳號 A 的數值。
4. 登出帳號 B，重新登入帳號 A，確認帳號 A 的幸運值仍為原本數值（持久化正常）。
5. 在百家樂開啟咪牌模式，登出換帳號 B，確認咪牌模式回到關閉狀態。
