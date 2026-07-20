# Provably Fair 公平性驗證展示頁 — 設計文件

- 日期：2026-07-20
- 狀態：已核准，待寫實作計畫
- 相關：T-030（Provably Fair RNG）、T-036（RNG 驗證 API）、ADR-003/ADR-004（捕魚機）

---

## 1. 問題

後端的 commit-reveal 機制（T-030/T-036）已完整實作並可用，但**前端沒有任何頁面呈現它**：

- `gameApi.spinSlot()` 只打 `POST /api/v1/game/slot/spin`（單次模式，承諾與揭露在同一個回應裡），
  看不到「先鎖定、後下注」的時間差。
- 沒有任何頁面呼叫 `GET /api/v1/game/verify/{roundId}`。
- mock 模式（前端預設 `VITE_USE_MOCK_API !== 'false'`）的 `serverSeedHash` 是
  `mock-hash-<random>`，與 seed 無數學關係——mock 下的「驗證通過」是演出來的，不是算出來的。

導致 30 分鐘簡報中「公平性可驗證」這段沒有畫面可演，且腳本寫的「切 mock 模式」備援方案是假的。

## 2. 目標與非目標

**目標**

1. 新增一個獨立展示頁，把 ①承諾 → ②下注 → ③開獎 → ④揭露 → ⑤驗證 五個步驟拆開呈現，
   每一步都對應一次真實的 API 呼叫。
2. 涵蓋老虎機、百家樂、捕魚機三種遊戲，共用同一套五步驟骨架。
3. mock 模式下驗證必須是**真的密碼學計算**（Web Crypto SHA-256），斷網或後端掛掉也能演，
   且台上說的每句話都成立。
4. 提供「模擬伺服器作弊」演示：餵一個竄改過的 serverSeed 給驗證端點，讓
   `commitmentValid` 真的變成 false。

**非目標**

- 不改造現有 `SlotGame.jsx` / `Baccarat.jsx` / `Fishing.jsx` 的玩法流程。
- 不改現有 `mockApi.js` 的 slot / baccarat / fishing 玩法（見 §4 方案取捨）。
- 不做捕魚機的 Pixi 漁場；展示頁的捕魚以列表呈現每發結果。
- 不新增後端程式碼——後端 API 已齊備。

## 3. 後端契約（已存在，本頁只是消費者）

### 老虎機（commit-ahead 兩階段）

| 步驟 | 端點 | 回應重點 | 扣款 |
|---|---|---|---|
| ①承諾 | `POST /api/v1/game/slot/round`<br>body `{bet, clientSeed}` | `{roundId, game, bet, serverSeedHash, clientSeed}`<br>**不含 serverSeed** | 否 |
| ②③開獎 | `POST /api/v1/game/slot/round/{roundId}/settle` | `{roundId, grid, bet, multiplier, payout, winningCells, wallet, serverSeed, serverSeedHash, clientSeed, nonce}` | **是** |

`roundId` 在 ① 就鎖定本局，② 不需再帶任何參數。④揭露的 `serverSeed` 就在 settle 回應裡。

### 百家樂（兩階段）

| 步驟 | 端點 | 回應重點 | 扣款 |
|---|---|---|---|
| ①②承諾+下注 | `POST /api/v1/game/baccarat/bet`<br>body `{player, banker, tie, clientSeed}` | `{roundId, game, totalBet, serverSeedHash, clientSeed}` | **是** |
| ③④開獎+揭露 | `POST /api/v1/game/baccarat/{roundId}/result` | `{roundId, playerCards, bankerCards, playerScore, bankerScore, result, totalBet, totalPayout, rebate, wallet, serverSeed, serverSeedHash, clientSeed, nonce}` | 否（派彩） |

**與老虎機的差異**：百家樂在 `/bet` 就扣款，老虎機在 `/settle` 才扣。頁面文案需分別標示，
不可混用同一句「下注時不扣款」。

### 捕魚機（場次級）

| 步驟 | 端點 | 回應重點 |
|---|---|---|
| ①承諾 | `POST /api/v1/game/fishing/session/start`<br>`{buyIn, cannonLevel, betPerShot, clientSeed}` | 含 `serverSeedHash`，**不含 serverSeed** |
| ②③射擊 | `POST /api/v1/game/fishing/{sessionId}/shots` | 每發 `ShotResult{crit, damage, hpRemaining, killed, captured}` |
| ④揭露 | `POST /api/v1/game/fishing/{sessionId}/end` | 結算並揭露 `serverSeed` |
| ⑤驗證 | `GET /api/v1/game/fishing/{sessionId}/verify-shot?shotSeq&fishType&betPerShot` | `FishingShotVerifyResponse{commitmentValid, hit, payout, riskControlled, serverSeed, serverSeedHash, clientSeed, message}` |

捕魚的驗證是**逐發**的，不是逐局；`⑤` 對已結算場次的任一 `shotSeq` 重放。

### 驗證端點（老虎機 / 百家樂共用）

`GET /api/v1/game/verify/{roundId}?serverSeed=<optional>`
→ `VerificationResponse{roundId, gameType, serverSeed, serverSeedHash, clientSeed, nonce,
usedProvidedSeed, commitmentValid, resultMatches, valid, recomputed, stored, message}`

`serverSeed` 參數選填。省略時用對局已揭露值；帶入時 `usedProvidedSeed=true`，
這正是「模擬作弊」演示的機制——帶一個錯的 seed 進去，`commitmentValid` 會是 false。

## 4. 方案取捨：mock 模式的密碼學

後端 RNG（`ProvablyFairRng` / `RandomStream`）是純 SHA-256，無 HMAC、無 JDK 專屬 API：

- 承諾：`commitment = SHA-256(serverSeed)`，小寫 hex。
- 隨機串流：逐塊雜湊 `SHA-256("serverSeed:clientSeed:nonce:block")`，block 由 0 遞增，
  每塊提供 32 bytes。`nextDouble()` 取 4 bytes big-endian ÷ 2³²；
  `nextInt(bound)` 取 4 bytes 並以拒絕取樣（`limit = 2³² - 2³² mod bound`）消除取模偏差。

因此瀏覽器 Web Crypto 可完全重現。

**選定方案 A：獨立的 `provablyFairMock.js`**

新增一支自足模組，只服務本頁；**完全不動現有 `mockApi.js` 的三個玩法**。

- 理由：現有 mock 玩法是 `Math.random()` 驅動且已上線在用。把它們改成確定性 stream
  等於重寫三個玩法的隨機來源，並需重新確認雷區 14 的所有對齊基準——風險與工作量
  不成比例。展示頁自己產生的局是真正可驗證的，這已滿足目標 3。
- 數值來源沿用 `contracts/*.json`（`slot-paytable` / `baccarat-rules` /
  `fishing-species` / `fishing-combat`），與 `mockApi.js` 同源，不另建一份數值。

**已否決 — 方案 B：全面改造 mockApi 為確定性 stream 驅動**
一致性最高（`Records` 的歷史局也能驗證），但動到三個已上線玩法，回歸風險高一階。
若日後要做，應獨立成另一個 spec。

**已否決 — 方案 C：mock 回固定「驗證通過」**
等同在簡報中宣稱一件不成立的事，不予考慮。

### 誠實性要求（硬性）

mock 模式下的「重算」是前端拿同一支函式再跑一次，**必然相符**；真後端才是
「獨立儲存的紀錄 vs 重算」比對。兩者的證明力不同。

因此頁面固定顯示模式徽章：`真實後端` / `本機模擬`。
`本機模擬` 徽章旁附一行說明：承諾雜湊為真實 SHA-256 計算，但結果比對為同一份前端邏輯重跑，
不構成對後端的獨立驗證。**此徽章與說明不得為了畫面簡潔而移除。**

## 5. 架構

```
frontend/src/pages/ProvablyFair.jsx              路由 /provably-fair（lazy，PrivateRoute）
  ├─ 模式徽章（真實後端 / 本機模擬）
  ├─ 遊戲切換：老虎機 / 百家樂 / 捕魚機
  └─ 依選擇掛載對應 Panel

frontend/src/components/fairness/
  ├─ StepRail.jsx        五步驟進度：已完成 / 進行中 / 未達
  ├─ SeedCard.jsx        hash / seed 顯示、可複製、揭露後做雜湊對照高亮
  ├─ VerdictPanel.jsx    commitmentValid / resultMatches / valid 三顆燈 + message
  └─ ResultDiff.jsx      recomputed vs stored 並排逐欄比對

frontend/src/components/fairness/panels/
  ├─ SlotFairPanel.jsx       /slot/round → /slot/round/{id}/settle → /verify/{id}
  ├─ BaccaratFairPanel.jsx   /baccarat/bet → /{id}/result → /verify/{id}
  └─ FishingFairPanel.jsx    /session/start → /shots → /end → /{sid}/verify-shot

frontend/src/services/fairnessApi.js         真 API / mock 切換（照 gameApi.js 既有寫法）
frontend/src/services/provablyFairMock.js    Web Crypto SHA-256 + RandomStream 移植
```

### 職責邊界

- **`provablyFairMock.js`**：純函式，不碰 DOM、不碰 localStorage 以外的東西。
  對外只暴露與真實 API 同形狀的回應。可獨立單元測試。
- **`fairnessApi.js`**：唯一的真/mock 分歧點。Panel 不知道自己在哪個模式。
- **Panel**：擁有自己的流程狀態機，決定何時呼叫哪一步。不共用狀態。
- **`components/fairness/*`**：純展示元件，只吃 props。

### 狀態管理

流程狀態用 local `useState`，**不進 redux**——本頁自成一格，沒有跨頁共享需求。

例外：真實模式下老虎機 `settle`、百家樂 `bet`、捕魚 `session/start` 會真的動到餘額，
故這些呼叫成功後 dispatch 一次錢包更新（`walletSlice`），並在頁面標示「本局為真實下注」。

### mock RNG 的非同步處理

Web Crypto 的 `crypto.subtle.digest` 是 async，而後端 `RandomStream` 的消費端是同步的。

作法：mock 的串流介面設計為 **async**（`await stream.nextInt(bound)`），
區塊在位元組用罄時才按需計算，與後端 `RandomStream.nextByte()` 的延伸邏輯一一對應。
連帶三個遊戲的 mock 結果推導函式也是 async。

**不採用「預先算好 N 塊位元組池」**：`nextInt` 使用拒絕取樣，理論上單次呼叫可消耗
任意多位元組，任何固定的 N 都存在（機率極低但真實的）耗盡風險。按需延伸沒有這個破綻，
也更貼近後端實作。

## 6. 五步驟的畫面敘事

| 步驟 | 畫面重點 | 台上要說的一句話 |
|---|---|---|
| ①承諾 | 顯示 `serverSeedHash`，旁邊一個明顯的「serverSeed：尚未揭露」鎖定狀態 | 結果現在就已經決定了，但我不能告訴你是什麼 |
| ②下注 | 玩家輸入 `clientSeed`（可自訂），送出注額 | 你的種子也參與運算，我無法單方面決定結果 |
| ③開獎 | 盤面 / 牌局 / 每發結果 | — |
| ④揭露 | `serverSeed` 原文出現，並即時展示 `SHA-256(serverSeed)` 與 ① 的雜湊逐字元比對 | 這就是我一開始鎖定的那個值 |
| ⑤驗證 | `VerdictPanel` 三顆燈 + `ResultDiff` 並排比對 | 重算出來的跟紀錄一模一樣 |

### 作弊演示

⑤ 旁邊一顆「模擬伺服器作弊」按鈕：以竄改過的 serverSeed 呼叫
`/verify/{roundId}?serverSeed=<tampered>`，畫面應轉為紅色，`commitmentValid=false`，
並顯示後端回的訊息「承諾雜湊不符：提供的 serverSeed 與本局公布的 serverSeedHash 不相符」。

此按鈕在 mock 模式下同樣有效（本機 SHA-256 比對必然失敗）。

## 7. 錯誤處理

| 情境 | 處理 |
|---|---|
| 真實模式後端不可用 | 該步驟顯示錯誤與端點路徑，並提示可切換 mock 模式；不靜默失敗 |
| 餘額不足 | 送出前擋下並顯示「星幣不足」（三鐵則之餘額守門） |
| 承諾階段成功但結算失敗 | 保留 `roundId` 與承諾雜湊，允許重試結算，不清空畫面 |
| `roundId` 不存在（驗證 404） | 顯示後端 `RoundNotFoundException` 訊息 |
| 捕魚已有進行中場次 | 先呼叫 `/session/active` 偵測，提示先結算舊場次 |
| mock 位元組池耗盡 | 拋出明確錯誤（實作 bug，不掩蓋） |

## 8. 測試

- `provablyFairMock.test.js`：
  - 承諾雜湊為真：`SHA-256(seed)` 對照已知向量。
  - 確定性：同一 `(serverSeed, clientSeed, nonce)` 兩次產生相同序列。
  - 竄改必失敗：改動 seed 任一字元後 `commitmentValid=false`。
  - `nextInt` 分布無取模偏差（大樣本卡方或區間計數）。
- Panel 層以 React Testing Library 測五步驟狀態機的推進與錯誤分支
  （比照既有 `FishingControlDock.test.jsx` 的寫法）。
- 後端不新增測試——本 spec 不改後端。

## 9. 進場點

- 路由 `/provably-fair`，於 `App.jsx` 以 `lazy` 註冊、包 `PrivateRoute`（真實模式需登入）。
- 大廳（`Lobby.jsx`）加一個入口卡片。
- 具體文案與視覺在實作計畫階段定案。

## 10. 待實作計畫決定的事項

- `StepRail` 的視覺形式（橫向 stepper vs 縱向時間軸）。
- 捕魚展示場次的預設參數（buyIn / cannonLevel / betPerShot / 射擊發數）。
- Lobby 入口卡片的文案與擺放位置。
