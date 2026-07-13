# 提示詞 A：捕魚機優化（同事 1）

你是這個 Lucky Star Casino monorepo 的後端+前端開發者。
專案：Java 21 / Spring Boot 3.3.5 後端；React + Redux 前端。
套件根 com.luckystar；前端入口在 frontend/src/。

你只處理「捕魚機」相關任務，不要動老虎機（SlotGame、SlotMachine、SlotService、SlotSymbol）。

---

## 任務 1：長按連發 + 空白鍵射擊（前端）

### 現狀

`frontend/src/components/FishingArena.jsx`
- 射擊只走 `onClick`（L177-208），每次點擊才開火一發。
- 沒有長按滑鼠左鍵的連發邏輯。
- 沒有鍵盤支援。

### 目標

A) 支援「長按左鍵」在準心所指位置持續開火（瞄準離最近的魚）。
B) 支援「長按空白鍵」同效果（遊標所在方向）。
C) 新增「自動射擊 切換鈕」（ArenaRef 外、炮台下方），開啟後自動對畫面最近一條魚連發。

### 實作指引

1. `FishingArena.jsx`：
   - 加 `mousedown`/`mouseup` 監聽 `arenaRef`（或 window），按下時啟動 `setInterval`（~120ms 一發），抬起時 `clearInterval`。
   - 要先呼叫 `fire(fishCode)` 判斷是否 `ok`，才播放音效與子彈動畫。
   - 加 `keydown`/`keyup` 監聽 `window`：`key === ' '`（Space）同理。
   - 連發時自動選最近的未捕獲魚（依螢幕座標計算距離）當目標，沒有魚時也讓砲台轉向中央。
2. 自動射擊按鈕：加在 `FishingArena` return 最下方（`absolute` 定位），state 放在 `FishingArena` 內部。
3. 不要改動 `useFishingSession.js` 的 `SHOTS_PER_SEC` / `BURST_CAPACITY`，前端 interval 速率不要超過 8 發/秒，否則後端 token bucket 會拒絕。

---

## 任務 2：爆擊機制（前後端）

### 現狀

後端：`backend/game-service/src/main/java/com/luckystar/game/`
- `fishing/FishSpecies.java`：魚種定義（code, name, multiplier, hitRate, ...）
- `service/FishingService.java`：`processShots` 計算命中/未中，目前無爆擊欄位
- `dto/FishingShotsResponse.java` + 內部 ShotResult：目前有 shotSeq, hit, payout, accepted

前端：
- `FishingArena.jsx` L112-142：`handleResults` 依 `r.hit && r.payout > 0` 顯示特效

### 目標

後端：每發命中時，以爆擊機率獨立觸發「爆擊」，爆擊時傷害乘以倍率。
前端：爆擊命中時顯示「CRITICAL!」大字特效 + 金色粒子爆發，payout float 字改為橘紅色更大字。

### 實作指引（後端）

1. `FishingService`（或 `FishSpecies`）加常數：`CRIT_CHANCE = 0.15`（15%），`CRIT_MULT = 2.0`。
2. `processShots` 計算命中後，多擲一次 RNG（同場次 ProvablyFairRng stream），若觸發爆擊則 `payout *= CRIT_MULT`（整數截斷）並設 `critical = true`。
3. `dto/FishingShotsResponse` 的 `ShotResult` 新增欄位：`boolean critical`（序列化為 JSON）。
4. RTP 統計：爆擊後 payout 已含倍率，`GameRtpStat` 正常累計即可，不需特別改。
5. 確保所有新欄位有向後相容預設值（`false`），以免舊版前端報 NPE。

### 實作指引（前端）

1. `FishingArena.jsx` `handleResults`（L112-142）：在 `r.hit && r.payout > 0` 後判斷 `r.critical`，若 `true` 呼叫 `spawnCritFloat(xPct, yPct, payout)` 取代普通 `spawnFloat`。
2. 新增 `spawnCritFloat`：float 元素加 CSS class `fishing-payout-float--crit`，字體更大、橘紅色。
3. 同時呼叫 `play?.('winBig')` 或自訂 `'critHit'` 音效（若 SoundEngine 已有 `winBig` 則直接用）。
4. 在 `Fishing.jsx` `onCatch` 回呼中，若 `effMult` 因爆擊加乘，`FortuneMeter` 的 `reportRound` 傳 `true` 即可（不另外改）。

---

## 任務 3：結算流程簡化（前端）

### 現狀

`Fishing.jsx` L39-117：`ShotVerifyPanel` 元件在結算後顯示逐發驗證按鈕，玩家必須手動點「驗證」。這會干擾遊戲節奏，設計上改成「後端自動驗 / 前端不顯示驗證面板」。

### 目標

結算畫面只顯示：本場下注、本場派彩、總射擊數、退回星幣、serverSeed（供玩家自行核對）。
移除 `ShotVerifyPanel` 的顯示，但保留其 Component 定義（別刪），只把 `Fishing.jsx` settled 狀態區塊中的 `<ShotVerifyPanel ... />` 那行刪除或隱藏即可。
serverSeed 仍展示在 `<p>` 標籤（L225-228），讓有需要的玩家可自行去驗證工具核對。

---

## 任務 4：操作說明彈窗（前端）

### 現狀

`Fishing.jsx` 側欄有 `GameRuleCard`，規則文字已有（`fishingRules` / `fishingPayouts`），但沒有一個「點擊開啟全螢幕說明」的新手引導彈窗。

### 目標

在進場畫面（`phase === 'idle'`）的標題下方加一個「查看操作說明」按鈕，點擊後展示 Modal 彈窗，內容包含：
1. 炮台倍率與注額說明（銅10/銀50/金100）
2. 魚種賠率表（直接重用 `fishingPayouts` 陣列）
3. 特殊功能說明（長按連發、自動射擊、收網結算）
4. 爆擊說明（CRITICAL! 爆擊 x2 派彩）

Modal 實作：用 `useState(showHelp)` 控制顯示，彈窗 style 與現有 `luxury-panel` class 保持一致；加關閉 ✕ 按鈕。
可直接寫在 `Fishing.jsx` 尾端（不需另建 Component 檔）。

---

## 衝突說明（不要動這些檔）

- `frontend/src/pages/SlotGame.jsx`
- `frontend/src/components/SlotMachine.jsx`
- `frontend/src/store/slices/gameSlice.js`
- `backend/game-service/src/main/java/com/luckystar/game/slot/` 下所有檔案
- `backend/game-service/src/main/java/com/luckystar/game/service/SlotService.java`
- `frontend/src/casino-fx/fx/useFortuneMeter.js`（同事 2 在改）

> ⚠️ **協調點**：同事 2 會修改 `useFortuneMeter` 的函式簽名，加入 `playerId` 參數。
> 請等同事 2 推上去後，在 `Fishing.jsx` L123 的 `useFortuneMeter('fishing')` 呼叫補上 `player?.id` 第二參數。

---

## 驗證

```bash
mvn -pl backend/game-service test
```

手動測試：
- 長按左鍵連發、空白鍵連發、自動射擊切換
- 命中時有機率出現 CRITICAL! 字樣（橘紅大字）
- 結算畫面無逐發驗證按鈕
- 操作說明彈窗可開關
