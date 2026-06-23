# 提示詞 B：老虎機第一部分——機率修復 + 幸運值保底（同事 2）

你是這個 Lucky Star Casino monorepo 的後端+前端開發者。
專案：Java 21 / Spring Boot 3.3.5 後端；React + Redux 前端。
套件根 com.luckystar；前端入口在 frontend/src/。

你只處理「老虎機」的機率與幸運值問題，不要動捕魚機（FishingArena、Fishing、FishingService）。

---

## 背景與問題

**後端**：`backend/game-service/src/main/java/com/luckystar/game/slot/SlotSymbol.java`
- 目前五種符號權重（共 100）：CHERRY 30 / LEMON 26 / BELL 20 / STAR 14 / SEVEN 10
- 唯一賠付線：中央橫線三格同符號
- 理論 RTP 約 17.7%、命中率約 5.6%（`SlotSymbol.java` L24 有說明）
- 玩家連轉 20 次不中獎完全符合數學，但用戶體驗極差

**前端**：`frontend/src/casino-fx/fx/useFortuneMeter.js`
- 幸運值存在 localStorage key `lucky-star-fortune-v1:slot`（L6）
- 不含玩家 ID，切換帳號後幸運值會被前一個帳號繼承（Bug）
- `value === 100` 時，程式碼只是顯示 aura 特效，沒有任何保底觸發（L51）

---

## 任務 1：調整老虎機中獎機率（後端）

### 目標

讓 RTP 從 ~17.7% 提升到約 70–75%（業界常見娛樂級設定）。
做法：調整 `SlotSymbol.java` 的權重，讓中獎符號出現更頻繁。

### 調整方式

下列數值可讓命中率提升到約 30%、RTP 約 72%，請依此修改 `SlotSymbol` enum：

```java
CHERRY(45, 2, 0x1F352),   // 最常見
LEMON(30, 3, 0x1F34B),
BELL(16, 5, 0x1F514),
STAR(7,  8, 0x2B50),
SEVEN(5, 8, 0x0037, 0xFE0F, 0x20E3);
```

注意：
- `display` / `lineMultiplier` / codePoint 參數不要動，只改第一個參數（weight）。
- `TOTAL_WEIGHT` 是自動計算的靜態欄位，不需手動改。
- 更改後跑 `SlotSymbolTest.java` 確保測試仍綠燈。

---

## 任務 2：幸運值保底機制（前端 + 後端）

### 目標

當幸運值 = 100（`fortune.full === true`）時，下一次 spin 必須觸發中獎（保底）。

---

### 前端：`useFortuneMeter.js` 修正

#### 問題 A：帳號切換繼承（多帳號 Bug）

`storageKey` 目前是 `lucky-star-fortune-v1:slot`，不帶玩家 ID。

**修正**：`useFortuneMeter` 的 signature 改為接收 `playerId`：

```js
export function useFortuneMeter(gameKey, playerId) {
  const storageKey = `lucky-star-fortune-v1:${gameKey}:${playerId ?? 'guest'}`
```

呼叫端 `frontend/src/pages/SlotGame.jsx`（L44）：

```js
const player = useSelector((state) => state.auth.player)
const fortune = useFortuneMeter('slot', player?.id)
```

呼叫端 `frontend/src/pages/Fishing.jsx`（L123）：

```js
const fortune = useFortuneMeter('fishing', player?.id)
// player 已在 L121 取出，直接用即可
```

> ⚠️ **協調點**：`Fishing.jsx` 的呼叫端改動由同事 1 補上。
> 你只需改 `useFortuneMeter.js` 的函式簽名，並改 `SlotGame.jsx` 的呼叫。

#### 問題 B：`full` 時沒有保底觸發

前端 `reportRound` 在 `won === true` 時已會把幸運值清零（`useFortuneMeter.js` L39-42），邏輯本身正確。問題在於「幸運值滿了卻不保底中獎」——後端沒有收到 `guaranteed = true` 參數。以下需要串接前後端。

---

### 前端：保底參數傳遞

**`frontend/src/pages/SlotGame.jsx`** `handleSpinRound`（L54-64）：

```js
const handleSpinRound = async () => {
  setVisualLock(true)
  fortune.addCharge(resolvedBet)
  try {
    const spinResult = await dispatch(spinSlot({ bet: resolvedBet, guaranteed: fortune.full })).unwrap()
    dispatch(setBalance(spinResult.wallet))
    return spinResult
  } finally {
    window.setTimeout(() => setVisualLock(false), 2900)
  }
}
```

**`frontend/src/store/slices/gameSlice.js`** 的 `spinSlot` thunk：確認 `guaranteed` 有跟著 `bet` 一起傳入 API 呼叫。

---

### 後端：保底 spin 邏輯

**1. `SpinRequest.java`**（`backend/game-service/src/main/java/com/luckystar/game/dto/SpinRequest.java`）

新增欄位：

```java
private boolean guaranteed = false;
```

**2. `SlotController.java`**

把 `guaranteed` 從 request body 傳入 `SlotService.spin()`。

**3. `SlotService.java`** `spin()` 方法

若 `guaranteed == true`，呼叫 `slotMachine.guaranteedSpin(stream, bet)` 取代 `slotMachine.spin(stream, bet)`。

**4. `SlotMachine.java`** 新增方法：

```java
public SlotOutcome guaranteedSpin(RandomStream stream, long bet) {
    // 先跑一次普通 spin；若已中獎直接回傳
    SlotOutcome outcome = spin(stream, bet);
    if (outcome.win()) return outcome;
    // 未中獎：強制中線設為最低倍率符號（CHERRY × 3）
    SlotSymbol[][] board = new SlotSymbol[ROWS][REELS];
    for (int row = 0; row < ROWS; row++)
        for (int col = 0; col < REELS; col++)
            board[row][col] = SlotSymbol.CHERRY;
    return evaluate(board, bet);
}
```

保底直接用最低倍率 CHERRY（2x）確保派彩合理，不破壞 RTP 過多。

**5. `SpinResponse.java`**

新增欄位 `boolean guaranteed`，讓前端可據此顯示「幸運保底觸發！」橫幅。

**6. `SlotGame.jsx` `handleSettled`**（L68-100）

```js
const handleSettled = (spinResult) => {
  if (!spinResult || spinResult.game !== 'slot') return
  // ... 現有邏輯 ...
  if (spinResult.guaranteed && won) {
    setBanner((prev) => ({ trigger: prev.trigger + 1, text: '幸運保底觸發！', level: 3 }))
  }
}
```

保底觸發後，`fortune.reportRound(true)` 會自動把幸運值清零（已有邏輯，不需另改）。

---

## 衝突說明（不要動這些檔）

- `frontend/src/components/FishingArena.jsx`
- `frontend/src/pages/Fishing.jsx`（你只需在這裡加 `player?.id` 呼叫，其他由同事 1 負責）
- `frontend/src/hooks/useFishingSession.js`
- `backend/game-service` 中 `fishing/` 和 `service/FishingService.java` 下的所有檔案

---

## 驗證

```bash
mvn -pl backend/game-service test
```

手動測試：
1. 連轉 10 次左右應可看到至少 2-3 次中獎（機率調整生效）
2. 登出換帳號後，幸運值從 0 開始（不繼承前帳號）
3. 把幸運值蓄滿（連續下注讓 `value = 100`），下一次 spin 必定中獎並顯示「幸運保底觸發！」橫幅
