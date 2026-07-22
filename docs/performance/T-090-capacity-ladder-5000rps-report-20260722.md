# 老虎機容量階梯壓測 — 加壓到 5,000 req/s（2026-07-22）

> 觀測工具：**Prometheus**（指標蒐集）＋ **Grafana**（圖表）＋ **Apache JMeter 5.6.3**（施壓）
> 原始資料：各階 `tests/performance/results/<runId>/results.jtl`（≤1,000 req/s 階另有 JMeter HTML dashboard）
> ；ladder 層彙整見 `results/ladder-20260722-154847/`。各階 runId 對照見 §4.2 下方清單。
> 前情：`T-090-capacity-ladder-report-20260721.md`（closed-loop 舊方法學）、
> `T-090-load-test-report.md` §「2026-07-22 open-model 首測」（open-model 首次誠實實測）

---

## 0. 這一輪要回答什麼

前兩輪的問題是「**容量到底在哪**」——#240/#242 給出互相矛盾的數字，2026-07-22 open-model 首測
又推翻了「150 併發」的宣告。這一輪把目標拉到 **offered 5,000 req/s**，不是為了宣告 5,000 可用，
而是為了把「上升 → 觸頂 → 卸載 → 施壓機自己先撐不住」整條曲線一次量完，並且**把每一段的
受限原因分清楚**（SUT 受限 vs 施壓機受限）。

---

## 1. 這一輪 harness 改了什麼（先講，因為它改變了數字的讀法）

### 1.1 目標速率與執行緒數解耦（本輪核心改動）

先前 `target_rps` 恆等於 `threads`（`run-slot-load-test.ps1` 寫死 `-Jtarget_rps=$Threads`）。
要打 5,000 req/s 就得開 5,000 條 JMeter 執行緒，**施壓機自己會先變成瓶頸**（P3 早已警告
「JMeter 與 SUT 同機」）。故本輪新增：

| 檔案 | 新參數 | 意義 |
|---|---|---|
| `tests/performance/run-slot-load-test.ps1` | `-TargetRps` | open-model 目標速率（iterations/s）。`0` = 沿用舊耦合 `target_rps == Threads`，**完全向後相容** |
| `tests/performance/run-slot-load-test.ps1` | `-NoHtmlReport` | 跳過 JMeter 內建 HTML dashboard。高階單階數十萬樣本時，報表產生器是整輪最慢也最吃記憶體的一段；所有數字都由原始 `.jtl` 重算，HTML 只是選配工件 |
| `tools/observability/run-capacity-ladder.ps1` | `-OfferedRpsSteps` | 每階的目標 **offered HTTP req/s** |
| `tools/observability/run-capacity-ladder.ps1` | `-ThreadsPerStep` / `-FixedThreads` | 每階的執行緒數，與目標速率脫鉤 |
| `tools/observability/run-capacity-ladder.ps1` | `-HtmlReportMaxOfferedRps` | 超過此 offered 速率的階自動加 `-NoHtmlReport` |

### 1.2 「RPS」在本報告的定義（**看數字前務必先讀這段**）

一個 JMeter iteration 會送 **2 支 spin sampler**（`01 Primary` + `02 Secondary`），
而 `PreciseThroughputTimer` 掛在 sampler 02 底下、**每個 iteration 觸發一次**。所以：

```
offered HTTP req/s（本報告的「RPS」） = target_rps（iterations/s） × 2
```

本輪 `-OfferedRpsSteps` 直接以 **gateway 收到的 HTTP req/s** 為單位，腳本內部自動換算
`target_rps = ceil(offered / 2)`。這解掉了 open-model 首測報告裡「`target_rps=150` 實際 offered ≈ 300」
的口徑混淆——**但也代表本輪的階梯數字不能直接與 2026-07-21 那份（以 threads 為軸）逐列對齊**。

### 1.3 為什麼每階要各自指定執行緒數

`slot-1000-players.jmx` 設 `response_timeout_ms=5000`：後端超過 5 秒沒回，該筆算
`SocketTimeoutException` 失敗，而**那條執行緒被卡滿 5 秒**。因此施壓機能發出的速率上限約為

```
max offered ≈ threads / 平均週期時間
```

過載時多數請求是 gateway 的快速 429（毫秒級）、少數被接受的請求可能吃滿 5 秒。以本輪頂階
（2,500 執行緒、offered 目標 5,000）估算，平均週期需 ≤ 0.5 s 才發得出去。**若某階「實際 offered」
明顯低於「目標 offered」，那一階量到的是施壓機發不出來，不是 SUT 的容量。** 表中同時列出
兩個欄位就是為了讓這件事無所遁形。

---

## 2. 測試環境

| 項目 | 內容 |
|---|---|
| 主機 | Windows 11 Pro、10 核 / 12 執行緒、32 GB RAM（開跑前可用約 4.9 GB） |
| 拓樸 | Docker Desktop 單機：7 個後端服務 + MySQL 8.4 + PostgreSQL 16 + Redis 7 + Kafka + Kafka UI + Prometheus + Grafana |
| 被測入口 | Spring Cloud Gateway（`localhost:8080`），全部流量走 gateway |
| 施壓工具 | Apache JMeter 5.6.3（本輪重新安裝於 `D:\tools\apache-jmeter-5.6.3`），測試計畫 `tests/performance/slot-1000-players.jmx` |
| 測試帳號 | **2,500 名**真實註冊並入金的玩家（每人 1,000,000 星幣，經 admin GM 發幣），playerId 全不重複 |
| 程式碼版本 | develop `d8f9370`（#246，熱路徑連線池統一 40） |
| 觀測 | Prometheus 每 5 秒抓 `/actuator/prometheus`；Grafana 11.1 |

### 2.1 開跑前修掉的兩個「會讓整輪作廢」的環境問題

1. **容器跑的是舊 code**：開測前用 actuator 實測連線池為 game=24 / wallet=42，但 develop
   `d8f9370` 的設定是 game=40 / wallet=40+10 / member=40 —— image 建於該 commit 之前。
   若不重建，整份報告會把舊 build 的數字標成「develop HEAD」。已 `docker compose build` 重建
   game/wallet/member 並重啟，**實測確認 game=40、wallet=50（40 Postgres + 10 MySQL）**。
   （member-service 的 `hikaricp.connections.max` 在無流量時未註冊，屬既有現象、非本輪回歸。）
2. **provisioning 撞 gateway auth 限流**：`/api/v1/auth/**` 預設 5/s、burst 10，2,500 名玩家的
   註冊/登入會被大量 429（open-model 首測那輪就只成功 956/1000）。本輪開測前把
   `AUTH_RATE_LIMIT_REPLENISH=500`／`AUTH_RATE_LIMIT_BURST=1000` 以 shell 環境變數傳給
   `docker compose up -d gateway-service`（**不寫進 `.env`，重啟即自動回到預設 5/10**）。
   壓測本身用預先簽好的 JWT、不打 `/auth`，故**此旋鈕不影響被測路徑的量測結果**。
   結果：2,500/2,500 全數 provisioning 成功。

---

## 3. 方法

- 階梯：offered **50 → 100 → 150 → 250 → 500 → 1,000 → 2,000 → 3,500 → 5,000 req/s**，共 9 階
- 每階 **120 秒**，percentile 只取**穩態窗**（丟掉每階前 **30 秒**暖機，P2）
- 每階執行緒數：100 / 100 / 150 / 250 / 500 / 800 / 1,200 / 1,800 / 2,500
- 階間以 `Wait-ForQuiescence` poll 到 backlog 排空（wallet outbox PENDING==0 且 consumer lag==0）才進下一階（P4）
- 每 2 階重發一次玩家 JWT（token 效期 15 分鐘，不重發會在中後段整批 401 汙染數據）
- 正式階梯前先跑 1 輪暖機並**棄置**（冷啟的 JVM／連線池會嚴重高估延遲）
- 宣告容量 `DeclaredCapacity=150`（沿用 D1-final），故僅最低幾階走驗收模式，其餘走韌性模式

執行指令（可重現）：

```powershell
# 注意：陣列參數不能經 `powershell -File` 傳（AGENTS.md 雷區 27），要直接呼叫
& .\tools\observability\run-capacity-ladder.ps1 `
    -JMeter 'D:\tools\apache-jmeter-5.6.3\bin\jmeter.bat' `
    -OfferedRpsSteps @(50,100,150,250,500,1000,2000,3500,5000) `
    -ThreadsPerStep  @(100,100,150,250,500,800,1200,1800,2500) `
    -DurationSeconds 120 -WarmupSeconds 30 -DeclaredCapacity 150 `
    -RefreshTokensEverySteps 2 -HtmlReportMaxOfferedRps 1000
```

---

## 4. 結果

### 4.1 一句話結論

**打不到 5,000 req/s——但擋住我們的不是被測系統，是同機的施壓機。**
JMeter 在這台筆電上最多只能真的送出約 **1,330 req/s**，目標拉到 2,000／3,500／5,000 都一樣打不上去。
在能打到的範圍內，系統的行為是乾淨的：**accepted 吞吐天花板約 190 req/s、膝點在 150～250 req/s 之間**，
超過之後 gateway 以 429 卸載而不是崩潰，**全程 9 階、434,001 筆樣本（98,404 筆被接受）、
零冪等違規、零超扣違規、5xx 僅 8 筆（佔被接受請求 0.008%），T-091 SQL 對帳實質 0 違規**。

### 4.2 主結果表

單位：offered = 打進 gateway 的 HTTP req/s；accepted 吞吐 = 扣掉 429 之後真正被處理的 req/s。
percentile 只取穩態窗（已切掉每階前 30 秒）。

| 目標 offered | 執行緒 | 樣本 | **實際 offered** | 被接受 | **accepted 吞吐** | P50 | P95 | **P99** | max | 429 卸載 | 卸載率 | 5xx | 失敗 | 冪等違規 | 超扣違規 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 50 | 100 | 4,348 | 50.3 | 4,348 | **50.3** | 38 | 120 | **212** | 488 | 0 | 0% | 0 | 0 | **0** | **0** |
| 100 | 100 | 8,750 | 100.2 | 8,749 | **100.1** | 33 | 91 | **170** | 435 | 1 | 0.0% | 0 | 0 | **0** | **0** |
| 150 | 150 | 12,801 | 149.2 | 12,797 | **149.2** | 48 | 132 | **197** | 378 | 4 | 0.0% | 0 | 0 | **0** | **0** |
| 250 | 250 | 21,719 | 252.8 | 16,276 | **189.5** | 413 | 1,020 | **1,410** | 2,228 | 5,443 | 25.1% | 0 | 0 | **0** | **0** |
| 500 | 500 | 41,711 | 502.0 | 14,229 | **171.2** | 404 | 894 | **1,242** | 2,359 | 27,482 | 65.9% | 0 | 0 | **0** | **0** |
| 1,000 | 800 | 83,271 | 1,012.8 | 11,155 | **135.7** | 523 | 1,152 | **1,554** | 2,940 | 72,116 | 86.6% | 0 | 0 | **0** | **0** |
| 2,000 | 1,200 | 110,954 | **1,333.0** ⚠️ | 9,941 | **119.4** | 525 | 1,216 | **1,688** | 2,871 | 101,013 | 91.0% | 4 | 4 | **0** | **0** |
| 3,500 | 1,800 | 35,721 | **409.3** ⚠️ | 10,502 | **120.3** | 368 | 1,042 | **1,450** | 2,781 | 25,219 | 70.6% | 1 | 1 | **0** | **0** |
| 5,000 | 2,500 | 114,726 | **1,331.5** ⚠️ | 10,407 | **120.8** | 499 | 1,331 | **1,883** | 2,724 | 104,319 | 90.9% | 3 | 3 | **0** | **0** |

⚠️ = 實際 offered 遠低於目標 → **該階量到的是施壓機的上限，不是 SUT 的容量**（見 §4.4）。

各階原始資料對照（`tests/performance/results/<runId>/results.jtl`）：

| 目標 offered | runId |
|---:|---|
| 50 | `20260722-153140` |
| 100 | `20260722-153352` |
| 150 | `20260722-153742` |
| 250 | `20260722-154123` |
| 500 | `20260722-154934` |
| 1,000 | `20260722-155322` |
| 2,000 | `20260722-155756` |
| 3,500 | `20260722-160141` |
| 5,000 | `20260722-160554` |

（另有暖機輪 `20260722-152225` 與作廢的 500 階 `20260722-154539`，皆不列入。）

### 4.3 曲線怎麼讀（三段）

**第一段：線性區（50 → 150 req/s）**
實際 offered 幾乎等於目標，卸載 0%、P99 穩定在 **170～212 ms**、無任何失敗。
150 req/s 這階 P99 197 ms、0 卸載 —— **舊的「150 併發」宣告，在這個口徑下是成立的**。

**第二段：膝點與過載（250 → 1,000 req/s）**
250 req/s 起卸載跳到 25.1%、P99 從 197 ms 暴增到 **1,410 ms**（7 倍）。accepted 吞吐在 250 這階
達到最高 **189.5 req/s**，之後不升反降（171 → 136 → 119），因為卸載本身也要消耗 gateway 的處理能力。
**這台機器的老虎機處理天花板 ≈ 190 req/s（≈ 每秒 95 次拉霸，一次 iteration 兩 spin）。**

**第三段：施壓機先撐不住（2,000 → 5,000 req/s）**
目標 2,000 時實際只送出 1,333 req/s，3,500 時 409 req/s，5,000 時 1,331 req/s ——
**三階都沒打到目標，且 accepted 吞吐鎖死在 ~120 req/s**。SUT 的行為沒有惡化（P99 沒失控、5xx 個位數、
帳務全對），惡化的是施壓端。

### 4.4 為什麼打不到 5,000（這是本輪最重要的結論）

三個原因疊在一起，**全部在施壓側**：

1. **執行緒被慢請求卡住**。`response_timeout_ms=5000`，被接受但慢的請求會佔住執行緒最久 5 秒。
   施壓機能送出的速率上限 ≈ `threads / 平均週期時間`。過載時多數是毫秒級 429、少數吃滿秒級延遲，
   平均週期被少數慢請求拉高，2,500 執行緒也撐不出 5,000 req/s。
2. **JMeter 與 SUT 搶同一顆 CPU**。各階 `jmeterHostJavaCpuPct` 從 8.3%（50 階）一路升到
   **34～40%**（250 階以上），遠超 P3 訂的 25% 警戒線。施壓機吃掉的每一分 CPU 都是從被測系統身上拿的。
3. **3,500 階的 409 req/s 是離群值**。同樣的施壓機，1,800 執行緒（409/s）竟然比 1,200 執行緒（1,333/s）
   和 2,500 執行緒（1,331/s）都差 3 倍以上。合理解釋是該階撞上 JMeter 自身的 GC／執行緒排程病態
   （2 GB heap + 1,800 執行緒），**不是 SUT 在那個點特別慢**（同階 P99 1,450 ms 反而比 2,000 階的
   1,688 ms 更低）。這一階的數字**不可單獨引用**。

> **所以「系統能不能扛 5,000 req/s」這個問題，本輪沒有回答，也無法在這台機器上回答。**
> 要回答它，施壓機必須搬到獨立機器（見 §7 建議 1）。

### 4.5 與前兩輪的對照

| 輪次 | 條件 | accepted 吞吐 | P99 | 卸載率 |
|---|---|---:|---:|---:|
| 2026-07-22 open-model 首測（舊 build，池 24/32） | offered ≈ 303 req/s | ~93 req/s | 1,427 ms | 69.3% |
| **本輪（develop `d8f9370`，池 40/50）** | offered 502 req/s | **171.2 req/s** | **1,242 ms** | 65.9% |
| **本輪** | offered 252.8 req/s | **189.5 req/s** | 1,410 ms | 25.1% |

**在更高的施壓量（502 vs 303 req/s）下，accepted 吞吐從 93 拉到 171（+84%）、P99 反而從 1,427 降到 1,242 ms。**
連線池 24/32 → 40/50（#246）的效果得到證實：**瓶頸確實是連線池排隊，不是 CPU**。

同時修正一個歷史誤讀：open-model 首測把「150」判為 FAIL，那個 150 是 `target_rps`（= offered ≈ 303 req/s）。
本輪在**真正的 offered 150 req/s** 下是 P99 197 ms、0% 卸載、完全通過。**兩份報告不衝突，是橫軸口徑不同。**

---

## 5. 帳務對帳（T-091）

壓測結束後對 PostgreSQL 寫庫跑 `tests/performance/accounting-reconciliation.sql` 九項檢查。
（`run-accounting-reconciliation.ps1` 需要本機 `psql`，本機未安裝，改以
`docker exec -i lucky-star-postgres psql -U lucky_user -d lucky_star_casino` 餵同一份 SQL，內容完全相同。）

| 檢查 | 違規數 | 判定 |
|---|---:|---|
| duplicate_idempotency_keys | 0 | ✅ |
| frozen_amount_exceeds_balance | 0 | ✅ |
| negative_wallet_balances | 0 | ✅ |
| nonzero_frozen_amounts | 0 | ✅ |
| transaction_delta_mismatches | 0 | ✅ |
| transactions_without_wallet | 0 | ✅ |
| wallet_balance_matches_latest_transaction | 0 | ✅ |
| **transaction_chain_breaks** | **3** | ⚠️ 誤報，見下 |
| **wallet_balance_matches_transaction_sum** | **3** | ⚠️ 已知誤報，見下 |

**結論：實質 0 帳務違規。** 兩項非零都經逐筆查證為對帳腳本本身的口徑問題，不是真的帳不平：

1. **`transaction_chain_breaks = 3`：對帳 SQL 的排序鍵在毫秒級併發下不可靠。**
   三筆全部落在同一名玩家 **2890**。實際資料是：

   | id | type | amount | balance_before | balance_after | created_at |
   |---:|---|---:|---:|---:|---|
   | 58495 | DEBIT | 100 | 1,000,000 | 999,900 | 07:22:51.256333 |
   | 58494 | DEBIT | 100 | 1,000,100 | 1,000,000 | 07:22:51.271647 |

   `id` 較小的 58494 反而有較晚的 `created_at`（相差 15 ms）。對帳 SQL 用
   `ORDER BY created_at, id` 排序，就把真實順序 58494 → 58495 排反了，於是
   `balance_before` 接不上前一筆的 `balance_after`。**改用 `ORDER BY id`（真正的寫入順序）
   重跑同一個檢查，違規數 = 0。** 金額本身完全正確：1,000,100 → 1,000,000 → 999,900，
   沒有任何一塊星幣被憑空生出或吃掉。
2. **`wallet_balance_matches_transaction_sum = 3`：種子錢包的結構性誤報（已知）。**
   三筆是錢包 **1001 / 1002 / 1003**，各有 `balance=10000` 但 `wallet_transactions` **0 筆**——
   它們是 seed 資料、不是壓測玩家。此誤報在 `T-090-壓測前準備清單.md §5` 已記載。
   把「有交易紀錄的玩家」單獨拉出來重算 `first balance_before + Σ signed amount = balance`，
   **不合的玩家數 = 0**。

> 也就是說：**98,404 筆被接受的下注、含大量 429 卸載與 8 筆 5xx 的情況下，帳本完全對平。**
> 冪等鍵 UNIQUE（雷區 8）與 debit 的條件 UPDATE + 行鎖（T-090 B2）在這個壓力下都守住了。

---

## 6. 誠實標註的方法學限制

1. **JMeter 與 SUT 同機**：單機 12 執行緒同時扛 JMeter（頂階 2,500 條執行緒）與 14 個容器。
   JMeter 偷走的 CPU 會**同時推高 P99、壓低 accepted 吞吐**。各階 `jmeterHostJavaCpuPct`
   （見 `ladder-summary.json`）> 25% 者，該階數字需打折看待。**本報告的絕對數字是同機悲觀下界，
   不可當成正式環境的容量承諾**；有效的結論是趨勢、轉折點與瓶頸位置。
2. **5 秒回應逾時是硬切**：超過 5 秒的被接受請求一律記為 `SocketTimeoutException` 失敗。
   這是「客戶端等不下去」而非後端錯誤，但**該筆的扣款可能已在後端成功提交**——玩家被扣款卻沒
   拿到回應。這正是 §5 對帳必須跑的原因。
3. **本輪與 2026-07-21 報告的橫軸口徑不同**（offered req/s vs threads），不可逐列對齊比較。
4. **本輪跑了兩段**：第 1～4 階（50/100/150/250）與第 5～9 階（500～5000）是兩次 ladder 執行，
   中間服務未重啟、設定未變、玩家與 token 同一批。第 5～9 階另有一次因外部中斷而作廢的 500 階
   （`results/20260722-154539`，資料不完整，**不列入本報告**）。所有數字皆由各階原始 `results.jtl`
   以 `summarize-jtl.mjs` 統一重算（暖機窗 30 秒），非拼湊自兩份 `ladder-summary.json`。

---

## 7. 改善建議（依優先度）

### A. 量測面 —— 沒有這幾項，下面的優化都驗證不了

**A1（最高優先）把施壓機搬離被測機器。**
本輪最硬的結論是「**打不到 5,000，因為施壓機先死**」：JMeter 自身 CPU 34～40%（P3 警戒線 25%）、
實際 offered 卡在 ~1,330 req/s。只要 JMeter 還跟 7 個服務搶同一顆 CPU，
**任何高於 ~1,000 req/s 的數字都不是系統容量**。兩個做法：
- 首選：另一台機器（或同網段的另一台筆電）跑 JMeter 打 gateway，`-HostName` 指過去即可，腳本不用改。
- 次選：`docker compose` 對 SUT 容器套 `cpuset` 隔離（#244 §P3 已有設計），把 JMeter 與服務釘在不同核心。

**A2 對帳 SQL 的排序鍵改成 `ORDER BY id`。**
`transaction_chain_breaks` 用 `ORDER BY created_at, id`，在毫秒級併發下會把真實順序排反（§5 已實證）。
`id` 是序列、就是真正的寫入順序，改掉之後這項檢查才有信噪比。同時把零交易的種子錢包
（1001/1002/1003）從 `wallet_balance_matches_transaction_sum` 排除。
**現況是每輪壓測都要人工解釋 6 筆誤報——這種「已知誤報」放久了會讓人對紅字麻痺，真的出事時反而看不見。**

**A3 階梯腳本要對「統計算不出來」硬失敗。**
本輪 2,000 與 5,000 兩階的 `summarize-jtl.mjs` 因 `Math.min(...arr)` 展開數十萬元素而
`RangeError: Maximum call stack size exceeded`，階梯腳本**安靜地把整列寫成空白**就繼續跑下去。
本輪已修掉 root cause（改用迴圈求 min/max），但**防呆還沒補**：建議 `run-capacity-ladder.ps1`
在 `$stats.samples` 為 null 時直接 `Write-Error` 並標記該階作廢，別讓空白列混進報告。

**A4 環境快照要驗「容器跑的是不是這個 commit」。**
本輪開測前才發現容器是 #246 之前的舊 image（實測 pool 24/42 ≠ 設定 40/50），差一點就把舊 build
的數字標成 develop HEAD。建議 `capture-environment.ps1` 比對「image 建置時的 git SHA」與當前 HEAD，
不一致就中止階梯。（順帶：member-service 在無流量時 `hikaricp.connections.max` 未註冊，
快照會缺一格，建議快照前先打一發 warm-up 請求。）

### B. 系統面 —— 真正把容量往上推

**B1 先量清楚 190 req/s 這道新天花板卡在哪。**
連線池 24/32 → 40/50 讓 accepted 吞吐 +84%（93 → 171 req/s），證明**原本的瓶頸確實是連線池排隊**。
但現在 250 req/s 就出現膝點，代表瓶頸已經移位。下一輪要同時抓三個指標判斷移到哪：
- `hikaricp.connections.pending` 若仍居高 → 池還是不夠，可再往上調（Postgres 預算尚有餘裕：
  game 40 + wallet 40 + rank 10 + admin 5 = 95 < max_connections 200）。
- 若 pending ≈ 0 但 CPU 到頂 → 瓶頸變成算力，加池沒用。
- 若 pending ≈ 0 且 CPU 未滿 → 瓶頸是**單筆交易的延遲**，這時 **B 案（老虎機每局 debit+credit
  併成單次 wallet 往返）才值得做**。B 案是架構級金流改動（牽動 rank 計分／稽核／補償／冪等，
  需 ADR + Testcontainers），**在數據指向它之前不該動**。

**B1-續（2026-07-22 下午分層歸因，run `ladder-20260722-150429`）：三指標量完了，落在「pending≈0 且 CPU 未滿」這格，但延遲不在 wallet DB，在 game→wallet 的 HTTP client。**
上面 B1 的三指標本輪實測：營運區間（≤150 併發）`hikaricp.connections.pending` **game/wallet/member 全 0**、CPU 每階平均 **65–68%**（尖峰 ~80%，未飽和）。照 B1 的判準即落入第三格「單筆交易延遲」。但**再往下做分層歸因，發現延遲不在原本猜的 wallet DB/outbox**：

| 層（膝點 100→150 併發，Prometheus histogram_quantile P99） | 100 | 150 |
|---|---:|---:|
| gateway | 883ms | 1424ms |
| **game spin** | **846ms** | **1399ms** ← 延遲主體 |
| wallet 伺服器端 | 124ms | 271ms |
| wallet debit / credit 平均耗時 | 24 / 29ms | 30 / 35ms |

- **wallet 伺服器端很快**（debit/credit 含同步寫 `wallet_outbox` 才 ~30ms、P99 才 124–271ms）→ **否證「outbox 同步寫入成本」與「Postgres WAL 天花板」是膝點主因**。
- game 自己的 DB 池 @150：`active 23/40、pending 0`（沒滿）；風控已 Redis 快取化（sub-ms）；`game.result` 走 `kafkaTemplate.send()` **非同步**（無 `.get()`）→ game 這些本地資源都不是瓶頸。
- ∴ **~1.3s 花在 game 每個 spin 對 wallet 的 2 次序列 HTTP 呼叫上**，而 `WalletClientConfig` 的 `RestClient` **完全沒設連線池／逾時**（jar 未 bundle Apache HttpClient5，退回 JDK `HttpClient` 預設）。wallet 30ms 很快、但 game 執行緒卡在 outbound 連線處理（CPU 沒吃、只是 park 等 I/O）；吞吐鎖死 ~190–220/s 反推 game→wallet 有效並發僅個位數，吻合「未調校 client」特徵。

**修正後的下一步建議**：**先調 game→wallet 的 `RestClient` 連線池（低風險純設定，與 B4 對 gateway HttpClient 的建議同型）**，而非先動高風險的 B 案——B 案的實益其實是「把 2 次往返砍成 1 次」，不是省 DB。定案前補一份 **load 中的 game thread dump** 實錘（看 150 條執行緒是否 park 在 `jdk.internal.net.http`／`RestClient`）。

**B2 用本輪曲線重訂 gateway 的卸載門檻。**
現在 250 req/s 就卸載 25%，而 accepted 吞吐要到 189.5 req/s（250 階）才觸頂——
**門檻略低於實際容量，等於提早把還吃得下的請求丟掉**。建議把閾值對齊「accepted 吞吐開始下降的點」
（本輪約 190～200 req/s），可望把可用吞吐再往上帶一點。反向的風險也要一起看：閾值訂太高，
P99 會從 200 ms 直接掉進 1.4 秒區，使用者體感更差——**這是個明確的取捨，要用曲線談，不要憑感覺調**。

**B3 給過載時的延遲加上天花板。**
膝點之後 P99 直接跳到 1.2～1.9 秒（且 max 接近 3 秒），代表請求進來就一直排、沒有排隊上限。
建議在 gateway 或 game-service 加 **bounded queue + 快速失敗**：滿了就立刻回 429，
而不是讓玩家等 2 秒才拿到結果。**對玩家來說「馬上告訴我現在很忙」遠比「轉圈 2 秒」好。**

**B4 5xx 共 8 筆（0.008%）值得追一次。**
全部落在 2,000／3,500／5,000 三個超載階。2026-07-22 首測那筆 502 已查為
gateway(Netty) ↔ game-service 的 keep-alive 連線在高併發下被中途關閉。本輪比例同屬雜訊等級，
但既然重現了，可以順手調 gateway HttpClient 連線池（`maxIdleTime` / 背景驅逐）驗證是否歸零。

### C. 這輪不建議做的事

- **不要為了「衝到 5,000」而放大 JMeter 執行緒數**。本輪 3,500 階用 1,800 執行緒只發出 409 req/s，
  比 1,200 執行緒的 1,333 req/s 還差 3 倍——執行緒開越多，JMeter 自己的 GC 與排程開銷越可能反噬。
  **執行緒不是油門，是併發上限。**
- **不要在同機環境下宣告任何「可對外引用的容量數字」**。本輪所有絕對值都是同機悲觀下界。
