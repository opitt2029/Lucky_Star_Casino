# 老虎機高併發壓測 — 容量階梯報告（2026-07-21）

> 觀測工具：**Prometheus**（指標蒐集）＋ **Grafana**（圖表）＋ **Apache JMeter 5.6.3**（施壓）
> 圖檔位置：`docs/performance/assets/loadtest-20260721/`（13 張 PNG＝1 張全景 + 12 張單面板，2 倍解析度，可直接拖進投影片）
> 原始資料：`tests/performance/results/ladder-20260721-160233/`（含每一階的 JMeter HTML dashboard 與 `results.jtl`）

---

## 1. 一句話結論

**在單機拓樸下，系統的處理天花板約 200 req/s（≈ 每秒 65 次拉霸）；超過之後 gateway 會「主動卸載」而不是崩潰，而且從 25 併發到 1,000 併發、35,255 局遊戲、46,058 筆帳務異動全程「零帳務違規」。**
真正的瓶頸不是 CPU，而是**資料庫連線池只開 10~15 條**——game-service 曾有 **49 條執行緒同時在排隊等連線**，等待時間最長 1.19 秒，這就是 P99 延遲的主要來源。

---

## 2. 測試環境（做簡報時務必照實說）

| 項目 | 內容 |
|---|---|
| 主機 | Windows 11 Pro、10 核 / 12 執行緒、32 GB RAM（測試當下可用約 1.7–2.9 GB） |
| 拓樸 | Docker Desktop 單機 15 容器：7 個後端服務 + MySQL 8.4 + PostgreSQL 16 + Redis 7 + Kafka + Kafka UI + Prometheus + Grafana |
| 被測入口 | Spring Cloud Gateway（`localhost:8080`），全部流量走 gateway，不直打後端 |
| 施壓工具 | Apache JMeter 5.6.3，測試計畫 `tests/performance/slot-1000-players.jmx` |
| 測試帳號 | **1,024 名**真實註冊並入金的玩家（每人 1,000,000 星幣，經 admin GM 發幣） |
| 觀測 | Prometheus 每 5 秒抓一次 `/actuator/prometheus`，7 個 target 全 UP；Grafana 11.1 出圖 |

> ⚠️ **重要限制**：JMeter 與被測系統跑在**同一台機器**，壓測工具本身也吃 CPU 與記憶體。
> 因此本報告的絕對數字是「這台機器上、這個拓樸的」水位，**不能當成正式環境的容量承諾**，
> 但「趨勢、轉折點、瓶頸位置」是有效的結論。

---

## 3. 測試方法：為什麼用「容量階梯」而不是只跑一個併發數

只跑單一併發數（例如 1,000）只能回答「這個數字過不過」，回答不了「容量到底在哪、哪裡是轉折點」。
所以本輪採**階梯式加壓**：同一套服務不重啟，從 25 併發一路加到 1,000 併發，每階跑 60 秒、階間冷卻 20 秒。

- 每階參數：`duration=60s`、`ramp-up=1s`、`pacing=1000ms`、單注 100 星幣
- 每階前每 3 階重發一次玩家 JWT（token 效期 15 分鐘，不重發會在中後段整批 401 汙染數據）
- 正式階梯開始前，已先跑 **2 輪暖機並棄置**（冷啟的 JVM／連線池會嚴重高估延遲）

執行指令（可重現）：

```powershell
powershell -File tools/observability/run-capacity-ladder.ps1 `
    -JMeter "<jmeter.bat 路徑>" -Steps @(25,50,100,150,300,600,1000) `
    -DurationSeconds 60 -DeclaredCapacity 150
```

---

## 4. 主結果表

| 併發 | 總樣本 | 被接受 | 吞吐(req/s) | P50(ms) | P95(ms) | **P99(ms)** | 429 卸載 | 卸載率 | 5xx | 冪等違規 | 超扣違規 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 25 | 3,869 | 3,869 | 67.3 | 26 | 86 | **174** | 0 | 0% | 0 | **0** | **0** |
| 50 | 7,449 | 7,449 | 127.4 | 30 | 190 | **345** | 0 | 0% | 0 | **0** | **0** |
| 100 | 10,770 | 10,770 | 194.3 | 105 | 540 | **860** | 0 | 0% | 0 | **0** | **0** |
| 150 | 11,014 | 10,886 | 201.0 | 289 | 1,059 | **1,471** | 128 | 1.2% | 0 | **0** | **0** |
| 300 | 15,366 | 10,357 | 194.8 | 270 | 1,164 | **1,669** | 5,009 | 32.6% | 0 | **0** | **0** |
| 600 | 20,239 | 10,929 | 208.9 | 371 | 1,175 | **1,672** | 9,310 | 46.0% | 0 | **0** | **0** |
| 1,000 | 30,649 | 12,680 | 246.4 | 551 | 1,391 | **1,977** | 17,969 | 58.6% | 1 | **0** | **0** |

**三個要講的重點：**

1. **吞吐在 100 併發就觸頂**（194 req/s），之後再怎麼加壓都停在 195–210 之間 → 這就是本機容量天花板。
2. **延遲 gate（P99 < 500 ms）在 50 併發還過得去（345 ms）**，100 併發起開始惡化（860 ms）。
   → 這台機器「延遲可接受」的服務容量約 **50–75 併發**。
3. **加壓到 40 倍（25→1,000）也沒有任何一筆帳務違規**，5xx 只有 1 筆（30,649 樣本中的一個 502，佔 0.003%）。

### 帳務正確性（本專案最重要的一條線）

| 檢查（T-091 對帳，9 項） | 結果 |
|---|---|
| 冪等鍵重複 | 0 |
| 餘額為負（超扣） | 0 |
| 交易鏈斷裂 / 金額不一致 | 0 |
| 凍結金額異常 | 0 |
| 錢包餘額 ≠ 最新交易 balance_after | 0 |
| 錢包餘額 ≠ 交易總和 | 3（**既知結構性誤報**：player 1001–1003 是 `seed_test_data.sql` 種子錢包，餘額 10,000、交易 0 筆、建立於 2026-06-23，與本次壓測無關） |

**本輪新增違規：0 筆。**

### 業務量與事件完整性

| 指標 | 數字 |
|---|---:|
| gateway 總業務請求 | 99,935（200：67,309／429：32,626／5xx：0） |
| wallet-service 處理請求 | 78,190 |
| game-service 處理請求 | 35,262 |
| 實際遊戲局數（`game_rounds`） | 35,255 |
| 錢包帳務筆數（`wallet_transactions`） | 46,058 |
| Transactional Outbox 事件 | 55,742 筆，**狀態全部 SENT、PENDING 0**（無事件遺失） |
| 實測老虎機 RTP | 3,259,800 ÷ 3,525,500 = **92.5%**（理論值 93.5%，35,255 局的抽樣落差合理） |
| wallet `debit` 平均耗時 | 48 ms |

---

## 5. 瓶頸在哪：資料庫連線池，不是 CPU

一般直覺會說「機器不夠力」，但 Prometheus 的數字說的是另一回事。

**CPU 沒有滿**（圖 ⑧）：各服務 process CPU 平均只有 1.4%–9.6%，尖峰最高 40%（gateway）。
（圖上 member-service 那三根 84%／73%／65% 的尖刺是「每 3 階重發 1,024 個 JWT」造成的 bcrypt 運算，不是壓測本身。）

**連線池滿了**（圖 ⑥ + 以下 PromQL 實測）：

| 服務 / 連線池 | 池上限 | 尖峰使用中 | **尖峰排隊等待** | 取連線最長等待 |
|---|---:|---:|---:|---:|
| game-service / HikariPool-1 | 10 | 10（**100% 滿**） | **49** | 1.19 s |
| wallet-service / HikariPool-1（Postgres 寫庫） | 15 | 15（**100% 滿**） | **18** | 1.12 s |
| member-service / HikariPool-1 | 10 | 10（**100% 滿**） | **15** | 1.43 s |
| rank / admin 各池 | 10 | 0–2 | 0 | ≤ 0.08 s |

> 白話解釋：連線池像餐廳只有 10 張桌子。客人（請求）再多，也只能同時服務 10 桌，
> 其他人全部在門口排隊——**排隊時間（最長 1.19 秒）直接變成使用者看到的延遲**。
> 這就是為什麼「CPU 只用 10%，P99 卻要 1.5 秒」。

**卸載機制是誰觸發的**：Resilience4j 熔斷器全程 `not_permitted_calls = 0`（沒開過），
所以那 32,626 筆 429 全部來自 gateway 的 **AIMD 併發限制器**（`concurrency-limit`），
也就是說系統是**照設計主動限流**，不是被打掛。這是好消息：429 有 `Retry-After`、不佔後端資源、對帳務零風險。

**次要觀察**：wallet 的 Outbox 待送事件尖峰堆到 **10,064 筆**，但壓測結束後已全數送出（PENDING 歸零）。
代表投遞跟得上，但「尖峰期會落後」——若要事件即時性更好，可提高 poller 批量或頻率。
Kafka consumer lag 尖峰 365 筆（wallet）／358 筆（admin），屬正常波動。

---

## 6. 建議改善順序（投影片可當「下一步」那頁）

| 優先 | 措施 | 預期效果 | 成本 |
|---|---|---|---|
| 1 | **把 game / wallet / member 的 HikariCP 池上限從 10–15 拉到 30–50**，並同步調高 PostgreSQL `max_connections` | 直接解掉排隊 49 的瓶頸，吞吐與 P99 應同時改善 | 改設定，最低 |
| 2 | 壓測機與被測系統**分離到不同機器** | 移除壓測工具本身佔用的 CPU/RAM 干擾，數字才具代表性 | 需第二台機器 |
| 3 | gateway AIMD 的初始 `max-in-flight` 與**實測容量對齊**（目前宣告 150、實測延遲可接受區間僅 50–75） | 卸載發生得更早也更準，避免「先讓延遲爛掉再卸載」 | 改設定 |
| 4 | Outbox poller 批量／頻率調校 | 降低尖峰積壓（曾達 1 萬筆） | 小 |
| 5 | 幫 429 卸載率與 Outbox 積壓**加 Prometheus 告警規則** | 從「事後看圖」進化到「即時知道」 | 小 |

---

## 7. 圖表清單 — 建議的 8 頁投影片

圖檔都在 `docs/performance/assets/loadtest-20260721/`，2 倍解析度、深色主題。

| 投影片 | 圖檔 | 這張圖要講的一句話 |
|---|---|---|
| 1. 系統總覽 | `00-dashboard-overview.png` | 「壓測期間所有關鍵指標一次看」——當封面／全景圖 |
| 2. 吞吐階梯 | `panel-01-①-吞吐量-業務請求-reqs-by-service.png` | 七個波峰＝七個併發階；gateway 尖峰 557 req/s，但下游一直停在 ~200 |
| 3. 延遲惡化 | `panel-02-②-端到端延遲-gateway-P50-P95-P99-秒.png` | P99 隨併發從 174 ms 一路爬到 1,977 ms，0.5 秒紅線在 100 併發被突破 |
| 4. 卸載而非崩潰 | `panel-03-③-回應碼分布-2xx-4xx-429-卸載-5xx-gateway.png` | 綠色（200）觸頂後，多出來的量全部變成褐色（429 限流），**5xx 幾乎為 0** |
| 5. 瓶頸定位 | `panel-06-⑥-DB-連線池-HikariCP-使用中-等待中-by-service.png` | 連線池 100% 滿載＋排隊 49 → 瓶頸在 DB 連線數 |
| 6. CPU 沒滿 | `panel-08-⑧-CPU-使用率-by-service.png` | 反證「不是機器不夠力」，強化上一頁的結論 |
| 7. 各層拆解 | `panel-04-④-各服務-P99-延遲拆解-秒-瓶頸在哪一層.png` | 時間花在哪一個服務身上一目了然 |
| 8. 事件與帳務 | `panel-10-⑩-wallet-Outbox-積壓-PENDING-事件筆數.png` | 尖峰積壓 1 萬筆但全部送達；配合「零帳務違規」收尾 |

其餘備用圖：`panel-05`（wallet debit/credit 耗時）、`panel-07`（JVM Heap）、`panel-09`（Kafka lag）、`panel-11`（熔斷器）、`panel-12`（同時處理中的請求數）。

---

## 8. 本輪順手修掉的環境問題（給重現的人）

跑壓測前卡了三個環境雷，都已修好並記錄：

1. **容器與 Docker network 脫鉤**：`lucky-star-postgres` 的 `NetworkSettings.Networks` 是空的，
   服務端報 `UnknownHostException: postgres`。解法＝完整 `docker compose down` 再 `up`（不要只 restart 單一容器）。
2. **舊 Postgres volume 缺 migration**：volume 建立於 `wallet_outbox`（藍圖 04 P2）之前，
   `init.sql` 只在**全新 volume** 才會跑，導致 wallet-service 開機即 `Schema-validation: missing table [wallet_outbox]` 無限重啟。
   解法＝手動補跑 `database/postgres/migration/V17__add_wallet_outbox.sql`。
3. **superadmin 密碼與 `.env` 不同步**：`AdminUserSeeder` 只在帳號不存在時播種，
   舊 volume 裡的密碼是以前的值 → GM 發幣 401、provisioning 中止。
   解法＝刪掉 `admin_users` 那列再重啟 admin-service，讓 seeder 依現行 `.env` 重建。
4. **本機 port 衝突**：另一組 `prac-*` 容器佔用 5433/6379/3307。
   解法＝改用不同的 host port 啟動（`MYSQL_PORT=3317 POSTGRES_PORT=5443 REDIS_PORT=6380 docker compose up -d`）；
   容器之間走 service name，內部連線完全不受影響。

---

## 9. 如何重現這份報告

```bash
# 0) 起環境（含 Prometheus + Grafana）
MYSQL_PORT=3317 POSTGRES_PORT=5443 REDIS_PORT=6380 docker compose --profile observability up -d

# 1) 匯入壓測用 Grafana dashboard
node tools/observability/import-dashboard.mjs \
     observability/grafana/provisioning/dashboards/lucky-star-loadtest.json

# 2) 準備 1,000 名已入金玩家（gateway 對 auth 有 5/s 限流，被擋掉的可再補跑一批合併）
PLAYERS=1000 CONCURRENCY=25 node tests/performance/provision-players.mjs

# 3) 跑容量階梯（腳本會自動每 3 階重發 token）
powershell -File tools/observability/run-capacity-ladder.ps1 \
    -JMeter "<jmeter.bat>" -Steps @(25,50,100,150,300,600,1000)

# 4) 依階梯的時間窗截 Grafana 圖（時間窗由步驟 3 的輸出提供）
node tools/observability/capture-grafana.mjs --uid lucky-star-loadtest \
     --from <startMs> --to <endMs> --out <輸出資料夾>

# 5) 帳務對帳
docker exec -i lucky-star-postgres psql -U <user> -d <db> \
     < tests/performance/accounting-reconciliation.sql
```

---

## 10. 本次新增的工具

| 檔案 | 用途 |
|---|---|
| `observability/grafana/provisioning/dashboards/lucky-star-loadtest.json` | 壓測專用 Grafana dashboard（12 個面板，全部排除 `/actuator/*` 自我觀測流量） |
| `tools/observability/import-dashboard.mjs` | 用 Grafana API 匯入 dashboard，並自動替換成本機實際的 Prometheus datasource uid |
| `tools/observability/capture-grafana.mjs` | 用 Playwright（Chromium headless）把每個面板截成 2 倍解析度 PNG，免裝 grafana-image-renderer |
| `tools/observability/summarize-jtl.mjs` | 直接從 `.jtl` 重算統計並輸出 JSON（不解析 markdown，格式改了也不會爆） |
| `tools/observability/run-capacity-ladder.ps1` | 階梯式加壓主腳本，自動重發 token、逐階收集、產出 summary JSON/Markdown |
| `tools/observability/run-loadtest-with-charts.ps1` | 單輪壓測 + 依該輪實際時間窗自動出圖 |

> 注意：`tools/observability/*.ps1` 存成 **UTF-8 with BOM**。Windows PowerShell 5.1 會把無 BOM 的
> UTF-8 當成 ANSI 解讀，中文註解變亂碼後會直接觸發語法錯誤（`Missing expression after ','`）。
