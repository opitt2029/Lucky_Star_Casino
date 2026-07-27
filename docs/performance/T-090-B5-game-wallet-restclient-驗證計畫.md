# T-090 B5：game → wallet 的 HTTP client 調校 — 驗證計畫

> 承 `T-090-capacity-ladder-5000rps-report-20260722.md` §7.B1-續（分層歸因）與其審閱補充。
> **本文只定義「怎麼證明／怎麼驗收」，不含實作。** 實作要等 §2 的量測先做完——
> 目前那條路徑上**連一個數字都沒有被量到**，先改再量就是在猜。

---

## 0. 現況一句話

老虎機膝點的延遲主體在 **game-service 的 spin**（P99 100 併發 846ms → 150 併發 1399ms），
而 wallet 伺服器端只有 124–271ms。中間那 ~1.1s 目前**只有推論、沒有量測**——
因為 game 對 wallet 的 outbound 呼叫**完全沒有儀表**。

---

## 1. 已核對確認的事實（程式碼層面）

| 事實 | 證據 |
|---|---|
| `RestClient` 用靜態 `RestClient.builder()` 建立，**繞過 Boot 自動組態** | `backend/game-service/.../config/WalletClientConfig.java` |
| **沒有連線池設定、沒有任何逾時** | 同上，builder 只設了 `baseUrl` 與兩個 default header |
| classpath **沒有** Apache HttpClient5／OkHttp | `grep -rn "httpclient5\|httpcomponents\|okhttp" backend/*/pom.xml pom.xml` 無命中 |
| 每次中獎 spin 對 wallet 是 **2 次同步阻塞呼叫**（debit → credit） | `backend/game-service/.../client/WalletClient.java` |
| **outbound 呼叫零儀表** | game `/actuator/prometheus` 的 `http_client_requests*` 指標數 = **0**（`http_server_requests_seconds_count` 則有 5 個） |
| **game-service 沒有 resilience4j**（無斷路器、無 TimeLimiter） | `grep -rl resilience4j backend/` 只命中 **gateway-service** |

> ⚠️ 最後兩項是這次審閱新增的。第 5 項代表 B1-續 的 ~1.3s 是**相減推論**；
> 第 6 項代表 game→wallet 這段**沒有任何保護機制**。

---

## 2. 第一步：先讓它可被量測（優先於任何調校）

**改動**：`WalletClientConfig` 改為注入 Spring Boot 自動組態的 `RestClient.Builder`，
而不是呼叫靜態 `RestClient.builder()`。

**為什麼這是第一步而不是直接調池**：
- 立刻獲得 `http_client_requests`（Micrometer 自動儀表）→ **client 端 P99 從此是量出來的**；
- `spring.http.client.*` 的逾時設定開始生效（現在設了也沒用）；
- 這一步**本身不改變任何併發參數**，所以它是「加裝儀表」，不是「調校」——
  可以單獨上線、單獨驗證，不會把兩個變因混在一起。

**驗收**：game 的 `/actuator/prometheus` 出現 `http_client_requests_seconds_*`，
且能用 `histogram_quantile` 算出對 `/internal/wallet/debit`、`/internal/wallet/credit` 的 P99。

**關鍵判讀**（這才是整份計畫的核心問題）：

```
client 端 P99（game 量到的）  −  wallet 伺服器端 P99  =  花在「連線取得 + 網路 + 排隊」的時間
```

- 若這個差值**很大**（例如 >500ms）→ **確認瓶頸在 HTTP client 層**，進入 §3。
- 若這個差值**很小** → **B1-續 的歸因不成立**，延遲在 game 自己的處理邏輯裡，
  要回頭用 profiler／thread dump 找，**不要去調連線池**（調了也沒用）。

**這一步就可能推翻 B1-續 的結論——這正是要先做它的原因。**

---

## 3. 第二步：調校（只有 §2 確認差值很大才做）

三個旋鈕，**一次只動一個、每動一次重測一輪**（否則分不出是誰的功勞）：

| 旋鈕 | 值 | 為什麼 |
|---|---|---|
| **逾時** | connect 2s / read 5s（暫定） | **不論效能結論如何都要做**，見 §5 |
| **連線池上限** | 從預設往上，先試 50 | 對照組：game DB 池是 40，wallet 端能同時處理的量級相近 |
| **請求工廠** | 視 §2 結果決定是否引入 Apache HttpClient5 | 引入新依賴＝新風險，沒有數據支持就不要加 |

**每一輪的驗收指標**（缺一不可）：
1. `http_client_requests` P99 下降；
2. **accepted 吞吐上升**（現況天花板 ~190 req/s）——這才是使用者感受到的；
3. 膝點往右移（現況 150～250 req/s 之間）；
4. **T-091 九項對帳仍全 0**（動 HTTP client 不該影響帳務，但這是帳務系統，必驗）。

> 只有 1 改善、2 沒動，代表瓶頸只是**往後推**到別的地方了，不算解決——要繼續往下找。

---

## 4. 明天（2026-07-23）分機重測時要順便收的資料

分機重測的主目的是「拿到不被施壓機污染的容量數字」（見
[`T-090-遠端施壓機壓測計畫-20260723.md`](./T-090-遠端施壓機壓測計畫-20260723.md)），
但**同一輪就可以順手把 B5 的證據收齊**，不必另外再壓一次：

1. **膝點兩階（預期 250／500 req/s）跑到一半時，抓 game-service 的 thread dump**：
   ```powershell
   # 在 SUT 上跑；連抓 3 次、間隔 5 秒，避免只看到某個瞬間的切片
   1..3 | ForEach-Object {
       docker exec lucky-star-game-service jstack 1 > "game-threaddump-$_.txt"
       Start-Sleep -Seconds 5
   }
   ```
   **看什麼**：有多少條 `http-nio-*` 執行緒 park 在 `jdk.internal.net.http` /
   `java.net.http` / `RestClient` 的堆疊上。**若大量執行緒卡在那裡 → §2 的推論被證實。**
2. **逐服務 P99 分層**（沿用 B1-續 的做法，Prometheus `histogram_quantile`）：gateway / game spin /
   wallet 伺服器端三層，取膝點兩階的穩態窗。
3. **game 的執行緒池水位**：`tomcat_threads_busy_threads` vs `tomcat_threads_config_max_threads`。
   **若 busy 逼近 max，而 CPU 沒滿 → 執行緒全卡在等 I/O，就是 §2 的特徵。**

> 這三項都是**唯讀觀測**，不改任何設定，所以**不會污染分機重測的主要數字**。

---

## 5. 與效能無關、但要單獨處理的一項

**game → wallet 沒有逾時，也沒有斷路器。**

wallet 若卡住不回，game 的 Tomcat 執行緒會被**無限期**佔住，直到執行緒池耗盡、
game 整個服務失去回應——**一個服務的慢，會變成兩個服務的死**。

- 這與「要不要調連線池」**是兩件事**：即使 §2 顯示瓶頸不在 client，逾時還是該補。
- 補逾時會改變失敗語意：目前逾時的呼叫會走 `ResourceAccessException` →
  `WalletUnavailableException`。**settle 階段（派彩 credit）若因此失敗，必須確認
  ADR-009 的補償單機制有接住**（`WalletCompensationService.recordPending()`，
  且**冪等鍵不可換**，見 AGENTS.md 雷區 22）——這是動這一項時最容易出事的地方。
- 建議做法：先補逾時（低風險）、觀察補償單是否有異常增加，再考慮斷路器。

---

## 6. 順帶更正的一處措辭（已隨本 PR 修掉）

`T-090-load-test-report.md`「2026-07-22 open-model 首測」節原本寫
「game-service resilience4j circuit breaker `failed=0`、狀態 closed」。

指標本身沒錯，但**措辭會誤導**：resilience4j 只存在於 **gateway-service**，
那是 gateway 上一個「以下游服務命名」的斷路器實例（`game-service`），
保護的是 **gateway→game** 這一段。容易被讀成「game-service 自己有斷路器」，
進而以為 **game→wallet** 也有保護——**那一段既無斷路器也無逾時**（見 §5）。

---

## 7. 這份計畫要避免的事

- **不要跳過 §2 直接調池**。現在那條路徑上沒有任何數字，改了也不知道有沒有效。
- **不要一次動多個旋鈕**。逾時、池大小、換 HTTP 實作是三個獨立變因。
- **不要因為這個發現就去做 B 案**（debit+credit 併成單次往返）。B 案的實益是「2 次往返變 1 次」，
  若 §2 顯示每次往返的成本本來就該是 30ms，那 B 案省下的遠比調 client 少，
  卻要付出架構級金流改動的代價（rank 計分／稽核／補償／冪等，需 ADR + Testcontainers）。
