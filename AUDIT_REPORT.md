# Lucky Star Casino — 後端程式碼品質審計報告

> 審計日期：2026-05-28
> 最後驗證與更新：2026-05-28
> 審計範圍：所有 `backend/*/src/main/java` + `application.yml`
> Package root：`com.luckystar`
> Java 21 + Spring Boot 3.3.5
> Services：member-service (8081), gateway-service (8080), wallet-service (8082), game-service (8083), rank-service (8084), admin-service (8086)

---

## 🔍 驗證與修復狀態（2026-05-28 更新）

報告原始 34 項中經實際讀程式碼驗證後，狀態如下：

### ✅ 已修復（P0 + P1，2026-05-28 完成）

#### P0（HIGH，第一輪）

| # | 嚴重度 | 項目 | 修改檔案 |
|---|---|---|---|
| **#13** | HIGH | AvatarUrl SVG XSS — 改為 MIME 白名單（jpeg/png/gif/webp） | `member-service/.../validation/AvatarUrlValidator.java` |
| **#17** | HIGH | Gateway CORS localhost fallback — 改 `${VAR:?...}` 強制必填 | `gateway-service/.../resources/application.yml` |
| **#19** | HIGH | JWT role claim 遺漏導致 Gateway RBAC 失效 — `buildToken()` 補 role claim、`AuthService` 同步更新、refresh 重查 DB | `member-service/.../security/JwtTokenProvider.java`、`service/AuthService.java` |

#### P1（MED/HIGH，第二輪）

| # | 嚴重度 | 項目 | 修改檔案 |
|---|---|---|---|
| **#4** | MED | `AuthController.logout` 的 `Long.parseLong` 包 `try/catch` → 401 而非 500 | `member-service/.../controller/AuthController.java` |
| **#5** | MED | `PlayerService.updateProfile` 加 `@Transactional`；`getProfile` 加 `@Transactional(readOnly=true)` | `member-service/.../service/PlayerService.java` |
| **#11** | MED | `Member.passwordHash` 加 `@JsonIgnore` + Lombok `@ToString(exclude=...)` 雙層防禦 | `member-service/.../entity/Member.java` |
| **#14** | HIGH | auth 端點加 `RequestRateLimiter`（Spring Cloud Gateway 內建 RedisRateLimiter，5 req/sec, burst 10，by IP） | `gateway-service/.../config/RateLimitConfig.java`（新檔）、`resources/application.yml` |
| **#18** | MED | Gateway CORS `allowedHeaders` 從 `"*"` 改白名單 `[Authorization, Content-Type, X-Requested-With]` | `gateway-service/.../resources/application.yml` |
| **#21** | MED | 新增 `FilterOrder` 常數類，集中定義所有 GlobalFilter 的 order | `gateway-service/.../filter/FilterOrder.java`（新檔）、`JwtAuthenticationGlobalFilter.java` |
| **#24** | MED | Gateway Redis 黑名單查詢 fail-closed：`.onErrorResume` 視 Redis 故障為 token revoked | `gateway-service/.../filter/JwtAuthenticationGlobalFilter.java` |

詳見 `backend/member-service/CHANGELOG.md` 的 `[Security Audit P0]` 與 `[Security Audit P1]` 段落。

#### 新增環境變數（可選，gateway-service）
- `AUTH_RATE_LIMIT_REPLENISH`（預設 `5`）— 每秒補充 token 數
- `AUTH_RATE_LIMIT_BURST`（預設 `10`）— burst 容量上限

### ❌ 經驗證為誤判（不需修復）

| # | 原報告說 | 實際狀態 |
|---|---|---|
| #7 | Fat Controller 風險 | AuthController 完全委派 AuthService，無 token 邏輯 |
| #9 | `/internal/**` permitAll 繞過 | SecurityConfig 已用 `addFilterBefore` 確保 InternalSecretFilter 早於 Security chain 執行 |
| #10 | InternalSecretFilter timing attack | 已使用 `MessageDigest.isEqual()` |
| #12 | UpdateProfile Mass Assignment | DTO 僅含 nickname/avatar，無敏感欄位 |
| #15 | JWT secret 長度未驗證 | JJWT 0.12.6 `Keys.hmacShaKeyFor()` 內建 `WeakKeyException`，啟動即失敗 |
| #6 | Repository 輸入長度限制 | DTO 層已有 `@Size(max=50)`（LoginRequest/RegisterRequest） |

### ⚠️ 無對應程式碼可修（推論性項目）

wallet-service、game-service、rank-service、admin-service **目前僅有 `Application.java` 和少數 config**，沒有 Controller / Service / Entity 等業務邏輯實作。以下推論項目須等對應服務實作後再回頭審：

- #25 Wallet double-spend、#26 Outbox Pattern、#27 Wallet Kafka manual ack
- #30 game-service Kafka listener 無 try/catch
- #31 rank-service `consecutive_days` 時區問題
- #32 admin-service read replica 誤用、#33 admin-service Kafka manual ack
- #34 Redis 無密碼（屬基礎設施配置，非程式碼）
- #35 / #36 Kafka offset / retry 配置（屬基礎設施配置）
- #37 / #38 跨服務 tracing / 全域 Kafka manual ack

### ⏳ 剩餘 — 待修（P2 與 P3 技術債）

| 優先 | # | 嚴重度 | 項目 | 預估 |
|:---:|---|---|---|---|
| **P2** | #8 | MED | 所有 List 端點加 `Pageable` 參數（目前 member-service 的 list 端點尚未實作） | 對應端點實作時一併 |
| **P2** | #16 | LOW | Hikari `maximum-pool-size: 10` 評估上調至 15-20 | 依壓測結果 |
| **P3** | — | — | Refresh token rotation 已實作；可考慮加 token family 偵測重放 | 4 hr |
| **P3** | #37 | MED | 引入 Micrometer Tracing + Zipkin/Jaeger | 4 hr |

### 修正後的統計

| 項目 | 數量 |
|---|---|
| 原報告總計 | 34 |
| ✅ 已修復（P0 + P1） | 10（#4, #5, #11, #13, #14, #17, #18, #19, #21, #24） |
| ❌ 誤判 | 6（#6, #7, #9, #10, #12, #15） |
| ⚠️ 無對應程式碼（業務邏輯尚未實作） | 11（wallet/game/rank/admin/跨服務基礎設施） |
| ⏳ P2/P3 技術債 | 4 |
| 📋 其他低優先 / 推論 | 3 |

### 已知獨立議題（不在本次審計範圍）

- ~~`member-service/src/test/.../AuthServiceLoginTest.java` 與 `RefreshTokenServiceTest.java` 引用不存在的 method（`setActive`、`getRefreshTokenExpiryMs`、`getMemberIdFromToken`），在本次修改前已編譯失敗，需另開 task 同步測試與 source schema~~
  - ✅ **已解決並驗證（2026-05-29）**：實際編譯與執行確認，這兩個測試已改為對齊現行 source（改用 `setStatus("ACTIVE")`、`JwtTokenProvider.getClaims/getRemainingTtlMs/getJti`、`TokenRedisService`），不再引用上述舊 method。
  - 驗證指令：`mvn -pl backend/member-service test` → **Tests run: 69, Failures: 0, Errors: 0, Skipped: 0, BUILD SUCCESS**（全套件綠燈，含 14 個測試類）。
  - 上述「編譯失敗」描述為更早期狀態，現已不成立。

---

## 摘要統計

| 服務 | HIGH | MED | LOW | 小計 |
|------|:----:|:---:|:---:|:----:|
| member-service | 5 | 5 | 2 | **12** |
| gateway-service | 3 | 4 | 0 | **7** |
| wallet-service | 3 | 0 | 0 | **3** |
| game-service | 1 | 1 | 1 | **3** |
| rank-service | 1 | 0 | 0 | **1** |
| admin-service | 0 | 2 | 0 | **2** |
| 跨服務共通 | 3 | 3 | 0 | **6** |
| **總計** | **16** | **15** | **3** | **34** |

---

## member-service

### Category 1 — 硬編碼值

| # | 檔案 (path:line) | Severity | Category | 說明 | 修正方式 |
|---|---|---|---|---|---|
| 1 | `backend/member-service/src/main/resources/application.yml` | MED | 硬編碼值 | Redis host/port 使用 `${REDIS_HOST:localhost}` / `${REDIS_PORT:6379}`，有本機 fallback，若 env var 未設將連到 localhost Redis | 改為 `${REDIS_HOST:?REDIS_HOST is required}` 讓啟動失敗而非靜默用錯誤主機 |
| 2 | `backend/member-service/src/main/resources/application.yml` | LOW | 硬編碼值 | `datasource.url` 的 `serverTimezone=Asia/Taipei` 硬編在 URL 字串裡，時區應可外部化 | 將時區獨立為 `${DB_TIMEZONE:Asia/Taipei}` env var |

### Category 2 — 潛在 Bug

| # | 檔案 (path:line) | Severity | Category | 說明 | 修正方式 |
|---|---|---|---|---|---|
| 3 | `backend/member-service/src/main/java/com/luckystar/member/service/AuthService.java` | HIGH | 潛在 Bug ✅ **已修** | `login()` 無 `@Transactional`：先做 DB 查詢、再寫 Redis refresh token，Redis 失敗時登入仍返回成功但 token 根本沒存；使用者自認已登入卻無法 refresh | **已修**：加 `@Transactional(readOnly = true)` + try-catch 包裹 `saveRefreshToken()`，Redis 失敗明確拋 RuntimeException（非靜默成功）；補測試 `login_disabledByRedis_throws` / `login_redisWriteFails_throws`。 |
| 4 | `backend/member-service/src/main/java/com/luckystar/member/service/AuthService.java:101` | MED | 潛在 Bug | `Long.parseLong(claims.getSubject())` 未 catch `NumberFormatException`，JWT subject 若不是數字直接拋 500，應為 401 | `try { … } catch (NumberFormatException e) { throw new InvalidTokenException(…); }` |
| 5 | `backend/member-service/src/main/java/com/luckystar/member/service/PlayerService.java` | MED | 潛在 Bug | `updateProfile()` 無 `@Transactional`，中途失敗可能造成部分欄位已更新 | 加 `@Transactional` |
| 6 | `backend/member-service/src/main/java/com/luckystar/member/repository/MemberRepository.java` | LOW | 潛在 Bug | `findByUsername()` / `existsByUsername()` 無輸入長度限制；攻擊者可傳超大字串造成 index 掃描效能問題 | 在 DTO 層加 `@Size(max=50)` 驗證（`LoginRequest` 應已有，確認 `RegisterRequest` 亦套用） |

### Category 3 — 架構與設計

| # | 檔案 (path:line) | Severity | Category | 說明 | 修正方式 |
|---|---|---|---|---|---|
| 7 | `backend/member-service/src/main/java/com/luckystar/member/controller/AuthController.java` | MED | 架構 | 確認 token 建立邏輯是否全在 `AuthService`；若 Controller 直接呼叫 `JwtTokenProvider` 則為 Fat Controller | 所有 token 生成邏輯應封裝在 `AuthService` 中 |
| 8 | 所有 List 端點 | MED | 架構 | 好友列表、每日簽到記錄、任務定義等 List 端點若無 `Pageable` 參數，隨資料成長將全表掃描 | 所有 list 類方法加 `Page<T> findBy…(Pageable pageable)` 並設預設 `size=20` |

### Category 4 — 安全風險

| # | 檔案 (path:line) | Severity | Category | 說明 | 修正方式 |
|---|---|---|---|---|---|
| 9 | `backend/member-service/src/main/java/com/luckystar/member/config/SecurityConfig.java` | HIGH | 安全 | `.requestMatchers("/internal/**").permitAll()` — Spring Security 直接放行 `/internal/**`，即使 `InternalSecretFilter` 存在也可能被繞過（filter 必須在 Security chain 之前執行） | 移除 `permitAll()`，改讓 `InternalSecretFilter` 以 `OncePerRequestFilter` 攔截並提早 reject；或用 `addFilterBefore(internalSecretFilter, UsernamePasswordAuthenticationFilter.class)` 確保順序 |
| 10 | `backend/member-service/src/main/java/com/luckystar/member/security/InternalSecretFilter.java` | MED | 安全 | 確認 secret 比對是否用 constant-time `MessageDigest.isEqual()`；若直接用 `String.equals()` 則有 timing attack 風險 | 使用 `MessageDigest.isEqual(secret.getBytes(StandardCharsets.UTF_8), incoming.getBytes(StandardCharsets.UTF_8))` |
| 11 | `backend/member-service/src/main/java/com/luckystar/member/entity/Member.java` | HIGH | 安全 | `passwordHash` 欄位若未加 `@ToString.Exclude` + `@JsonIgnore`，Lombok 自動生成的 `toString()` 及 Jackson 序列化會洩露 hash | `@ToString.Exclude` 加在 `passwordHash` 欄位；`@JsonIgnore` 或在 DTO 層完全不映射此欄位 |
| 12 | `backend/member-service/src/main/java/com/luckystar/member/dto/UpdateProfileRequest.java` | HIGH | 安全 | Mass Assignment 風險：若 `UpdateProfileRequest` 包含 `isActive`、`passwordHash` 等欄位，前端可傳入修改 | DTO 只允許 `nickname`、`avatarUrl` 兩個欄位；後端用明確的 setter 而非 `BeanUtils.copyProperties` |
| 13 | `backend/member-service/src/main/java/com/luckystar/member/validation/AvatarUrlValidator.java` | HIGH | 安全 | `data:image/svg+xml;base64,...` 符合 `startsWith("data:image/")` 條件，但 SVG 可內嵌 `<script>` 執行 XSS | 白名單限制 MIME：只允許 `data:image/jpeg`、`data:image/png`、`data:image/gif`；另拒絕 `javascript:` scheme |
| 14 | Auth 端點 | HIGH | 安全 | `/api/v1/auth/login` 及 `/register` 無速率限制，可暴力破解 | 在 Gateway 加 `RequestRateLimiter` filter；或在 member-service 用 Bucket4j / Redis 計數，5次失敗鎖定 |

### Category 5 — 設定與環境

| # | 檔案 (path:line) | Severity | Category | 說明 | 修正方式 |
|---|---|---|---|---|---|
| 15 | `backend/member-service/src/main/resources/application.yml` | MED | 設定 | JWT_SECRET 用 `?` 語法強制必填（佳），但未驗證長度；空字串或 1 字元 secret 可通過 YAML 解析 | 在 `JwtTokenProvider` 的 `@PostConstruct` 中驗證 `secret.length() >= 32`，否則 `throw new IllegalStateException(…)` |
| 16 | `backend/member-service/src/main/resources/application.yml` | LOW | 設定 | Hikari `maximum-pool-size: 10`；member-service 同時處理 auth 與 profile 讀取，尖峰可能不足 | 評估是否需調至 15-20；並設 `minimum-idle: 5` |

---

## gateway-service

### Category 1 — 硬編碼值

| # | 檔案 (path:line) | Severity | Category | 說明 | 修正方式 |
|---|---|---|---|---|---|
| 17 | `backend/gateway-service/src/main/resources/application.yml` | HIGH | 硬編碼值 | `allowedOrigins: ${CORS_ALLOWED_ORIGINS:http://localhost:5173}` — 未設 env var 時 CORS 放行 localhost，生產環境若漏設將允許錯誤來源 | 改為 `${CORS_ALLOWED_ORIGINS:?CORS_ALLOWED_ORIGINS is required}`，強制設定 |
| 18 | `backend/gateway-service/src/main/resources/application.yml` | MED | 硬編碼值 | `allowedHeaders: "*"` 加上 `allowCredentials: true`：瀏覽器規範禁止 wildcard + credentials 同時使用，部分瀏覽器會直接拒絕 | 改為明確列表：`[Authorization, Content-Type, X-Requested-With]` |

### Category 2 — 潛在 Bug

| # | 檔案 (path:line) | Severity | Category | 說明 | 修正方式 |
|---|---|---|---|---|---|
| 19 | `backend/gateway-service/src/main/java/com/luckystar/gateway/filter/JwtAuthenticationGlobalFilter.java` | HIGH | 潛在 Bug ✅ **已修** | JWT claims 中 `role` 從未在 `JwtTokenProvider.buildToken()` 寫入，但 Gateway 嘗試讀取 `claims.get("role")`，永遠為 null；下游服務收到空的 `X-User-Role` header，RBAC 形同虛設 | **已修**：`JwtTokenProvider:45` 已有 `.claim("role", role)`；Gateway filter 讀取有 null-safe 防衛。已驗證 2026-06-23。 |
| 20 | `backend/gateway-service/src/main/java/com/luckystar/gateway/filter/JwtAuthenticationGlobalFilter.java:76` | MED | 潛在 Bug | `claims.getId()` / `claims.getSubject()` 若為 null 未完整防衛，empty header 傳遞給下游服務後可能造成 NPE | 用 `Optional.ofNullable()` 包裝；若關鍵 claim 缺失直接回 401 |

### Category 3 — 架構與設計

| # | 檔案 (path:line) | Severity | Category | 說明 | 修正方式 |
|---|---|---|---|---|---|
| 21 | `backend/gateway-service/src/main/java/com/luckystar/gateway/filter/JwtAuthenticationGlobalFilter.java:112` | MED | 架構 | `getOrder()` 回傳 `-100` 但未文件化與其他全域 filter（CORS、rate limiter）的相對順序 | 建立 `FilterOrder` 常數類，明確定義所有 filter 的 order 並加上 Javadoc 說明執行鏈 |
| 22 | Gateway routes | LOW | 架構 | 若各微服務間存在直接 HTTP call（不過 gateway），將繞過 JWT 驗證；需確認 game-service 呼叫 wallet-service 是否走 gateway | 統一用 `X-Internal-Secret` header 的 internal call pattern，不繞 gateway |

### Category 4 — 安全風險

| # | 檔案 (path:line) | Severity | Category | 說明 | 修正方式 |
|---|---|---|---|---|---|
| 23 | `backend/gateway-service/src/main/resources/application.yml` | HIGH | 安全 | JWT_SECRET 需與 member-service 共用，但若兩邊用不同的 env var 名稱或值，token 驗證將失敗；需確認完全一致且無任何 fallback default | 兩邊都使用 `${JWT_SECRET:?...}` 且無 fallback；在 CI/CD pipeline 中以同一個 secret source 注入 |

### Category 5 — 設定與環境

| # | 檔案 (path:line) | Severity | Category | 說明 | 修正方式 |
|---|---|---|---|---|---|
| 24 | `backend/gateway-service/src/main/resources/application.yml` | MED | 設定 | Redis timeout 2000ms：token blacklist check 超時後的行為應是 **fail-closed**（拒絕請求），需確認 filter 中 Redis 錯誤是否正確處理 | 在 `.onErrorResume()` 中對 Redis 逾時回傳 401，而非讓請求通過；或加 Circuit Breaker |

---

## wallet-service

### Category 2 — 潛在 Bug

| # | 檔案 (path:line) | Severity | Category | 說明 | 修正方式 |
|---|---|---|---|---|---|
| 25 | wallet-service 轉帳/扣款邏輯 | HIGH | 潛在 Bug ✅ **已修** | **Double-spend 風險**：Redis 餘額 check 與 DB debit 之間無原子性；兩個並發請求可能都通過 balance check 再各自扣款 | **已修**：`WalletService` 使用 `@Version` 樂觀鎖 + `idempotencyKey` UNIQUE 約束防重，不依賴 Redis balance check；DB 層保證原子性。已驗證 2026-06-23。 |
| 26 | wallet-service Kafka publish | HIGH | 潛在 Bug ⚠️ **已知/可接受** | DB debit 與 Kafka publish 若不在同一 transaction boundary，DB 成功但 Kafka 失敗時事件丟失，餘額已扣但下游不知道 | **已知設計**：程式碼有 try-catch + 文件標注 best-effort。嚴格保證需 Outbox Pattern，屬 P2 長期技術債，現階段可接受。 |

### Category 5 — 設定與環境

| # | 檔案 (path:line) | Severity | Category | 說明 | 修正方式 |
|---|---|---|---|---|---|
| 27 | `backend/wallet-service/src/main/resources/application.yml` | HIGH | 設定 | `enable-auto-commit: false` 但若無明確 `consumer.commitSync()` / `Acknowledgment.acknowledge()` 呼叫，消息永遠不 commit，造成重複消費 | 確認每個 `@KafkaListener` 方法參數包含 `Acknowledgment ack`，並在成功處理後呼叫 `ack.acknowledge()` |

---

## game-service

### Category 1 — 硬編碼值

| # | 檔案 (path:line) | Severity | Category | 說明 | 修正方式 |
|---|---|---|---|---|---|
| 28 | `backend/game-service/src/main/resources/application.yml` | MED | 硬編碼值 | `wallet-service.base-url: ${WALLET_SERVICE_URL:http://localhost:8082}` — 有 localhost fallback；服務拓撲洩漏 | 改為 `${WALLET_SERVICE_URL:?WALLET_SERVICE_URL is required}` |
| 29 | `backend/game-service/src/main/resources/application.yml` | LOW | 硬編碼值 | Internal call 使用 HTTP 而非 HTTPS，生產環境中 internal traffic 若不加密，secret header 明文傳輸 | 生產環境統一用 HTTPS；或部署在同一 VPC 用 mTLS |

### Category 2 — 潛在 Bug

| # | 檔案 (path:line) | Severity | Category | 說明 | 修正方式 |
|---|---|---|---|---|---|
| 30 | game-service `@KafkaListener` 方法 | HIGH | 潛在 Bug ✅ **N/A 已驗證** | `@KafkaListener` 方法無 try/catch，業務邏輯異常將導致消費者重試無限循環；若未配置 Dead Letter Topic，消息直接丟失 | **已驗證**：game-service 目前無 `@KafkaListener` 消費者（只有 publisher）；rank-service / wallet-service 消費者均使用 `throws Exception` 正確將例外傳遞至 `DefaultErrorHandler`（retry 3次 + DLT routing），DLT topics 已在 kafka-init.sh 建立。已驗證 2026-06-23。 |
| 39 | `backend/game-service/.../service/RiskControlService.java` + `resources/application.yml` | HIGH | 潛在 Bug ✅ **已修** | 風控單一 `global-rtp-limit: 0.95`（含本金口徑）套到所有遊戲，但百家樂含本金 RTP 結構上 ≈ 0.99 永遠 > 0.95，導致風控幾乎每局都判超限、把非莊結果強制改成莊家贏（押閒／和近乎必輸） | **已修**：新增 `RiskProperties`（`@ConfigurationProperties`，per-game `globalRtpLimit` map），`RiskControlService` 改用 `globalRtpLimitFor(gameType)`；`application.yml` 門檻改為 map（default 1.05 / SLOT 0.97 / BACCARAT 1.02 / FISHING 1.00），訂在各遊戲結構性 RTP 之上。commit b731e20，補回歸測試；`mvn -pl backend/game-service test` → **158 passed**（已重跑驗證 2026-06-25）。見 AGENTS.md 雷區 17。 |

---

## rank-service

### Category 2 — 潛在 Bug

| # | 檔案 (path:line) | Severity | Category | 說明 | 修正方式 |
|---|---|---|---|---|---|
| 31 | `daily_checkins.consecutive_days` 重置邏輯 | HIGH | 潛在 Bug ✅ **已修** | `consecutive_days` 重置依賴伺服器時間，但 datasource URL 設定 `serverTimezone=Asia/Taipei`；若 JVM 時區與 DB 時區不一致（JVM 預設 UTC），跨午夜邊界的判斷會差 8 小時，導致連續天數誤算 | **已修**：`CheckinService:31` 使用 `LocalDate.now(ZoneId.of("Asia/Taipei"))`；`DailyWinningsResetScheduler` 與 `DailyRankSnapshotScheduler` 均指定 `zone="Asia/Taipei"`。已驗證 2026-06-23。 |

---

## admin-service

### Category 3 — 架構與設計

| # | 檔案 (path:line) | Severity | Category | 說明 | 修正方式 |
|---|---|---|---|---|---|
| 32 | `backend/admin-service/src/main/java/com/luckystar/admin/config/DataSourceConfig.java` | MED | 架構 | admin-service 連接 PostgreSQL read replica；需確認寫操作是否誤用了 read replica datasource（尤其雙 DataSource 配置容易弄錯 `@Primary`） | 在 `DataSourceConfig` 明確標記 primary/secondary；寫操作的 `@Transactional` 加上 `readOnly=false` 防呼叫到 replica |

### Category 5 — 設定與環境

| # | 檔案 (path:line) | Severity | Category | 說明 | 修正方式 |
|---|---|---|---|---|---|
| 33 | `backend/admin-service/src/main/resources/application.yml` | MED | 設定 | `enable-auto-commit: false` 同上（#27），需確認 manual ack 實作 | 每個 `@KafkaListener` 加 `Acknowledgment ack` 參數並在 `finally` block 呼叫 `ack.acknowledge()` |

---

## 跨服務共通問題

| # | 影響服務 | Severity | Category | 說明 | 修正方式 |
|---|---|---|---|---|---|
| 34 | 所有服務 | HIGH | 安全 | Redis 無密碼設定；攻擊者若進入內網可直接讀取 refresh token、操作 blacklist 繞過 token 撤銷 | 所有 `application.yml` 加 `password: ${REDIS_PASSWORD:?Redis password required}`；Redis 層啟用 `requirepass` |
| 35 | 所有服務 | HIGH | 設定 | Kafka `auto-offset-reset: earliest`：consumer group offset 遺失時將重播所有歷史消息，財務類事件（扣款、獎勵）重播將造成資料損壞 | 改為 `latest`；並實作冪等消費（deduplication key）以應對正常重試 |
| 36 | 所有服務 | MED | 設定 | Kafka producer `retries: 3` 無 backoff 設定，Broker 重啟瞬間所有服務同時打爆 Broker | 加 `retry.backoff.ms: 100`、`max.block.ms: 60000`；考慮 Resilience4j Circuit Breaker |
| 37 | 所有服務 | MED | 安全 | 所有服務無分散式 tracing（Micrometer Tracing），出問題時無法追蹤跨服務呼叫鏈 | 引入 Micrometer Tracing + Zipkin/Jaeger；在 `application.yml` 加 `management.tracing.sampling.probability: 1.0` |
| 38 | 所有 Kafka consumer 服務 | HIGH | 設定 | `enable-auto-commit: false` 全部配置但無法確認 `Acknowledgment.acknowledge()` 實作是否存在；這是最高風險的遺漏 | 每個 `@KafkaListener` 加 `Acknowledgment ack` 參數並在 `finally` block 呼叫 `ack.acknowledge()` |

---

## 特別標注：高風險推論點（Schema 邏輯推論）

### 友誼自我申請（Friendship Self-Request）

資料表有 `CHECK (requester_id <> receiver_id)`，但 Service 層需也驗證。

**風險**：若 Service 層無前置檢查，攻擊者傳 `requester_id == receiver_id` 雖被 DB 拒絕，但每次都打到 DB 才失敗；若未來 DB 約束被誤刪，Service 層毫無防線。

**建議修正**：
```java
// FriendshipService.createRequest() 最頂端
if (requesterId.equals(receiverId)) {
    throw new BadRequestException("Cannot send friend request to yourself");
}
```

### 連續簽到時區問題

`consecutive_days` 重置邏輯 + Asia/Taipei timezone + JVM 可能為 UTC 的組合。

**風險**：Asia/Taipei 為 UTC+8，若 JVM 用 UTC，台灣時間 00:00（新的一天）JVM 仍認為是昨天 16:00，「昨天有無簽到」判斷會誤算，連續天數可能在不該重置時重置。

**建議修正**：
```yaml
# docker-compose.yml 或 JVM 啟動參數
environment:
  JAVA_TOOL_OPTIONS: -Duser.timezone=Asia/Taipei
```

或在程式碼中統一用 UTC 儲存，只在顯示層轉換時區。

---

## 修復優先順序（原始版本 — 已被頂部「驗證與修復狀態」段取代）

> ⚠️ 此表為 2026-05-28 初版審計結果，未經驗證；當前實際狀態請見頂部「🔍 驗證與修復狀態」段落。

| 優先級 | # | 項目 | 預估工時 |
|--------|---|------|----------|
| **P0 — 上線前必修** | 9 | `/internal/**` permitAll 繞過 | 30 min |
| **P0** | 19 | JWT role claim 遺漏 → RBAC 失效 | 1 hr |
| **P0** | 38 | Kafka manual ack 確認實作 | 2 hr |
| **P0** | 25 | Wallet double-spend 防護 | 4 hr |
| **P0** | 35 | Kafka offset reset 改 `latest` | 15 min |
| **P1 — 本週修完** | 34 | Redis 加密碼 | 30 min |
| **P1** | 11 | passwordHash `@ToString.Exclude` | 15 min |
| **P1** | 12 | Mass Assignment DTO 限縮 | 1 hr |
| **P1** | 13 | AvatarUrl SVG XSS 修正 | 30 min |
| **P1** | 14 | 登入端點速率限制 | 2 hr |
| **P1** | 17 | CORS origin 移除 localhost fallback | 15 min |
| **P1** | 31 | 時區統一（`-Duser.timezone=Asia/Taipei`） | 30 min |
| **P2 — 本 Sprint** | 3, 5 | 補 `@Transactional` | 1 hr |
| **P2** | 8 | List 端點加 Pagination | 3 hr |
| **P2** | 26 | Outbox Pattern（Kafka + DB 原子性） | 8 hr |
| **P3 — 技術債** | 37 | 分散式 Tracing | 4 hr |
| **P3** | — | Refresh token rotation 防 token 竊取 | 4 hr |

---

## 技術棧參考

```
Java 21 + Spring Boot 3.3.5
Spring Web / JPA / Security / Redis / Kafka / Spring Cloud Gateway
JJWT 0.12.6 (jjwt-api + jjwt-impl + jjwt-jackson)
MySQL (CQRS write + query)
PostgreSQL (admin read replica)
Auth: JWT (access + refresh token) via gateway filter
Internal calls: X-Internal-Secret header → InternalSecretFilter
```

---

## 附錄 A — 工作分配總表與實作進度

> 來源：`docs/幸運星幣城_工作分配表.xlsx`（工作表「📋 工作總覽（依模組）」）
> 進度盤點日期：2026-05-29
> 盤點方式：逐一比對 `backend/*/src`、`frontend/src`、`database/`、`docker-compose.yml`、git log 與任務交付物
> 狀態圖例：✅ 已完成　⚠️ 部分完成　❌ 未開始　❓ 待確認（無法由程式碼直接判定）

### A.1 全域 / 基礎建設（S0-W1）

| 任務 | 負責人 | 優先 | 任務名稱 | 狀態 | 盤點依據 |
|---|---|:--:|---|:--:|---|
| T-000 | 組長A | P0 | GitHub Repo 與分支策略 | ✅ | README.md / CONTRIBUTING.md / .github/pull_request_template.md 皆存在 |
| T-001 | 組長A | P0 | 架構圖與 ADR | ✅ | docs/architecture.md、docs/adr/ADR-001.md 存在 |
| T-002 | 組員D | P0 | Docker Compose 環境 | ✅ | 已改 Kafka KRaft（移除 Zookeeper）、MySQL 對齊 8.4、Kafka volume 改 `lucky_kafka_data`；`docker compose config` + infra 測試通過（2026-06-15） |
| T-003 | 組員D | P0 | 各 Service Spring Boot 初始化 | ✅ | 6 個服務模組皆能獨立啟動（pom.xml 已掛模組） |
| T-004 | 組員E | P0 | React 前端初始化 | ✅ | frontend/ 為 Vite + React，含 Redux/Router/Tailwind/Axios |
| T-005 | 組長A | P0 | Kafka Topic 規劃 | ✅ | kafka/kafka-init.sh 存在 |
| T-006 | 全員 | P0 | DB Schema 與 DDL | ✅ | database/mysql、database/postgres 的 init.sql + migration 皆存在 |

### A.2 Member Service（組長A）

| 任務 | 優先 | 任務名稱 | 狀態 | 盤點依據 |
|---|:--:|---|:--:|---|
| T-010 | P0 | 會員註冊 API | ✅ | AuthController `POST /register` |
| T-011 | P0 | JWT 登入/登出 API | ✅ | AuthController `POST /login`、`/logout` |
| T-012 | P0 | JWT Token 刷新 | ✅ | AuthController `POST /refresh` |
| T-013 | P0 | Spring Security 過濾器鏈 | ✅ | SecurityConfig.java + JwtFilterConfig.java |
| T-014 | P0 | 玩家個人資料 CRUD | ✅ | PlayerController `GET/PUT /profile` |
| T-015 | P1 | 好友系統 API | ✅ | FriendshipController（request/accept/reject/list/delete） |
| T-016 | P1 | 任務系統資料結構 | ✅ | TaskDefinition / PlayerTask / TaskType entity |
| T-017 | P1 | 每日簽到 API | ✅ | CheckinController `POST /daily-checkin` 發 `wallet.credit.request` 指令，wallet `WalletCreditRequestListener` 消費後入帳（ADR-002）；簽到入帳鏈路 2026-05-29 接通 |
| T-018 | P1 | 新手禮包自動發放 | ✅ | MemberRegisteredConsumer 已實作 |

### A.3 Wallet Service（組員C）

| 任務 | 優先 | 任務名稱 | 狀態 | 盤點依據 |
|---|:--:|---|:--:|---|
| T-020 | P0 | Wallet 初始化（開戶） | ✅ | MemberEventListener 消費 member.registered |
| T-021 | P0 | 查詢星幣餘額 API | ✅ | WalletController `GET /balance` |
| T-022 | P0 | 下注扣款 API | ✅ | InternalWalletController `POST /internal/wallet/debit`（含樂觀鎖） |
| T-023 | P0 | 派彩入帳 API | ✅ | `POST /internal/wallet/credit` 已實作（冪等/樂觀鎖/解凍/發 wallet.credit），2026-05-29 完成並通過單元測試 |
| T-024 | P0 | 冪等性防重複 | ✅ | debit 與 credit 皆具 idempotencyKey + DB UNIQUE 防重 |
| T-025 | P0 | 帳務流水查詢 API | ✅ | `GET /api/v1/wallet/transactions`（CQRS MySQL 讀端，分頁/類型/日期過濾）+ Kafka→MySQL 讀端同步，commit b7d4a4f 完成並通過單元測試 |
| T-026 | P1 | 好友星幣贈送 API | ✅ | `POST /api/v1/wallet/gift`：Redis 當日上限（贈出 5,000／收受 10,000，TTL 到午夜）+ PostgreSQL 雙向分錄（DEBIT/CREDIT GIFT，冪等/樂觀鎖）+ best-effort gift_logs/Kafka，2026-06-01 完成並通過單元測試 |
| T-027 | P1 | 破產補助 API | ✅ | `POST /api/v1/wallet/bankruptcy-aid`：`BankruptcyAidService`（總餘額 <100 門檻防凍結套利、Redis SETNX 當日鎖到午夜、credit 冪等鍵 DB 第二道防線），commit c945f97 完成並通過單元測試 |
| T-028 | P2 | Kafka DLT 處理 | ✅ | `AdminDeadLetterController`（`/internal/wallet/dlt` 查詢分頁 + `POST /{id}/retry` 手動重試）+ `DeadLetterService`，commit 2646cb3 完成並通過單元測試 |

### A.4 RNG Game Service（組員B）

| 任務 | 優先 | 任務名稱 | 狀態 | 盤點依據 |
|---|:--:|---|:--:|---|
| T-030 | P0 | Provably Fair RNG 引擎 | ✅ | `rng.ProvablyFairRng`/`RandomStream`：commit-reveal + `SHA-256(serverSeed:clientSeed:nonce:block)`，純邏輯單元測試通過 |
| T-031 | P0 | 老虎機遊戲邏輯 | ✅ | `slot.SlotMachine`/`SlotSymbol`：3x3 中線三連，符號決定倍率，確定性可驗證；RTP≈17.7% |
| T-032 | P0 | 老虎機遊戲 API | ✅ | `POST /api/v1/game/slot/spin`：扣款(debit)→RNG→派彩(credit)→寫 `game_rounds`→發 `game.result`；`WalletClient` 走內部 API + 冪等鍵 |
| T-033 | P0 | Redis 遊戲 Session 管理 | ✅ | `session/GameSessionService`（兩階段 commit-ahead）、`GameSession`/`GameSessionState`，含單元測試（commit 7f5d513） |
| T-034 | P1 | 百家樂遊戲邏輯 | ✅ | `baccarat/BaccaratGameService`/`Card`/`BaccaratOutcome`/`BaccaratResult`/`BaccaratSettlement`，含單元測試（commit 6d9aae5） |
| T-035 | P1 | 百家樂遊戲 API | ✅ | `BaccaratController` + `service/BaccaratService`：`/bet`、`/result`，含 controller/service 測試（commit 0910d29） |
| T-036 | P1 | RNG 公平性驗證 API | ✅ | `VerificationController` + `VerificationService`，含測試（commit 710b1a8） |
| T-037 | P2 | 遊戲 RTP 統計 | ✅ | `RtpController` + `RtpStatsService` + `entity/GameRtpStat`（排程 + API），含測試（commit d860154） |

> ✅ **game-service 已全數完成（T-030~T-037）**：RNG 引擎、老虎機邏輯與下注 API、Redis Session 兩階段 commit-ahead、百家樂邏輯與 API、RNG 公平性驗證 API、遊戲 RTP 統計皆已實作並合併至 develop，各帶單元/契約測試。

### A.5 Rank Service（組員D）

| 任務 | 優先 | 任務名稱 | 狀態 | 盤點依據 |
|---|:--:|---|:--:|---|
| T-040 | P0 | Redis ZSet 全服排行榜 | ✅ | `rank:global:coins` + wallet.credit/debit consumer |
| T-041 | P0 | 好友排行榜 | ✅ | `rank:friend:{playerId}`（含好友 + 本人）+ friend.relationship.updated consumer + 24h TTL |
| T-042 | P0 | 排行榜查詢 API | ✅ | `/global`、`/global/{id}`、`/friends`、`/friends/me`（自己好友名次）+ username read model；**頭像欄位待 member 端發布頭像後補（跨組待辦）** |
| T-043 | P1 | 每週排行榜重置排程 | ✅ | `@Scheduled(cron="0 0 0 * * MON", zone="Asia/Taipei")` + `rank_history` 冠軍快照 + `wallets.balance` 重建 ZSet + `notification.push` TOP3 通知 |
| T-044 | P1 | 每日持幣快照任務 | ✅ | `@Scheduled(cron="0 0 0 * * *", zone="Asia/Taipei")` + `rank_daily_snapshots` 前一日持幣量快照 |
| T-045 | P2 | 今日贏幣王排行榜 | ✅ | `rank:daily:winnings` ZSet + `wallet.credit` WIN 累加 + `/api/v1/rank/daily/winnings` API + 每日 00:00 重置 |

### A.6 Admin Service（組員D）

| 任務 | 優先 | 任務名稱 | 狀態 | 盤點依據 |
|---|:--:|---|:--:|---|
| T-050 | P1 | Admin JWT 認證（角色區分） | ✅ | 獨立 ADMIN_JWT_SECRET + SUPER_ADMIN/OPERATOR 角色 + Spring Security（/admin/** 需 ROLE_ADMIN、@PreAuthorize）+ `POST /admin/auth/login` + admin_users 表 + seeder；19 test pass（含 401/403 驗收，2026-06-15） |
| T-051 | P1 | 玩家帳號管理 API | ✅ | `/admin/players` 列表(分頁+關鍵字)、`/{id}` 詳情(跨庫彙整 member/wallet/game)、`PATCH /{id}/status` 停用→同時 ① member 內部 API `PATCH /internal/members/{id}/status` 持久化 `members.status`（真相來源，2026-07-07 補完）② Redis `disabled:player:{id}` gateway 強制即時失效 |
| T-052 | P1 | 星幣流通量報表 API | ✅ | `GET /admin/reports/coin-flow?dimension=day\|week\|month&from=&to=`，讀 MySQL wallet_transactions、Java 彙整發放/消耗/淨流通 |
| T-053 | P1 | 遊戲 RTP 監控儀表板 API | ✅ | `GET /admin/reports/rtp?game=&from=&to=`，讀 PostgreSQL game_rtp_stats 比對設計 RTP，偏差>5% 標 ABNORMAL |
| T-054 | P2 | 異常玩家偵測機制 | ✅ | `game.result` 偵測 BIG_WIN/HIGH_FREQUENCY，`wallet.credit/debit` 偵測 ABNORMAL_TRANSFER，寫入 PostgreSQL `admin_alerts` 並發送 Kafka `notification.push` 管理員告警；查詢/處理端 `GET /admin/alerts`（分頁+type/resolved 篩選）+ `PATCH /admin/alerts/{id}/resolve`（2026-07-07 補完，Dashboard 顯示未處理告警） |
| T-055 | P2 | 手動發放星幣 API（GM 工具） | ✅ | `POST /admin/gm/grant` 僅 SUPER_ADMIN 可用；發送 `wallet.credit.request` (`subType=GM_REWARD`) 由 wallet-service 入帳，並寫入 PostgreSQL `admin_action_logs` 操作日誌（操作者/玩家/金額/原因/冪等鍵/時間） |

### A.7 Gateway（組長A）

| 任務 | 優先 | 任務名稱 | 狀態 | 盤點依據 |
|---|:--:|---|:--:|---|
| T-060 | P0 | Spring Cloud Gateway 路由 | ✅ | application.yml 7 條路由 + CORS |
| T-061 | P0 | Gateway JWT 驗證過濾器 | ✅ | JwtAuthenticationGlobalFilter.java |
| T-062 | P0 | 每玩家速率限制 | ✅ | PlayerRateLimitGlobalFilter + RateLimitConfig（已有測試） |
| T-063 | P1 | Circuit Breaker 熔斷 | ✅ | FallbackController + resilience4j 設定 |

### A.8 Notification Service（組員D）

| 任務 | 優先 | 任務名稱 | 狀態 | 盤點依據 |
|---|:--:|---|:--:|---|
| T-070 | P1 | WebSocket STOMP Server | ✅ | `notification-service/config/WebSocketConfig.java`：`@EnableWebSocketMessageBroker`，`/ws` endpoint + SockJS，`StompAuthChannelInterceptor` JWT CONNECT 鑑權 |
| T-071 | P1 | Kafka → WebSocket 推播橋接 | ✅ | `NotificationConsumer.java`：消費 `notification.push`，`SimpMessagingTemplate.convertAndSendToUser` 推私人佇列 |
| T-072 | P1 | 遊戲結果推播 | ✅ | `GameResultConsumer.java`：消費 `game.result`，推玩家私人佇列 |
| T-073 | P2 | 排行榜變動廣播 | ✅ | `RankUpdateConsumer.java`：消費 `rank.update`，廣播公共頻道；含單元測試 |

> ✅ **notification-service 全數完成（T-070~T-073）**：port 8087，無 DB，純事件→WebSocket 橋接；前端 `useWebSocket.js` 現有真實後端可連。

### A.9 前端（組員E）

| 任務 | 優先 | 任務名稱 | 狀態 | 盤點依據 |
|---|:--:|---|:--:|---|
| T-080 | P0 | 登入/註冊頁面 | ✅ | Login.jsx / Register.jsx + authSlice |
| T-081 | P0 | Redux Toolkit 全域狀態 | ✅ | auth/wallet/game/rank slice + store/index.js |
| T-082 | P0 | 遊戲大廳頁面 | ✅ | Lobby.jsx |
| T-083 | P0 | 老虎機遊戲頁面 | ⚠️ | SlotGame.jsx 存在；後端 T-032 已完成；`gameApi.js` 已實作真實呼叫，預設仍走 mockApi（需 `VITE_USE_MOCK_API=false` 啟用） |
| T-084 | P0 | WebSocket 連線管理 | ⚠️ | useWebSocket.js 存在；後端 notification-service 已建立（T-070~T-073 完成）；端對端串接待驗收 |
| T-085 | P1 | 排行榜頁面 | ✅ | Rank.jsx 存在；後端 rank-service 已完成；`rankSlice.js` 已改用 `rankApi.getRanks()` 呼叫真實 `/api/v1/rank/*`（mock 僅作 fallback），顯示/搜尋對齊 `playerId`/`username`（BUG-001 已修，2026-06-25） |
| T-086 | P1 | 帳務明細頁面 | ✅ | Transactions.jsx 存在；後端 T-025 已完成；`walletSlice.js` 已改用 `walletApi.getTransactions()` 串接真實端點（BUG-002 已修，2026-06-25） |
| T-087 | P1 | 百家樂遊戲頁面 | ⚠️ | Baccarat.jsx / BaccaratTable.jsx 存在；後端 T-035 已完成；`gameApi.js` 已實作真實呼叫，預設走 mockApi |
| T-088 | P1 | 個人資料/好友管理頁面 | ⚠️ | Profile.jsx 存在；**無獨立 Friends.jsx**（好友管理 UI 整合於 Member.jsx，但該頁未見好友相關邏輯） |
| T-089 | P2 | RWD 響應式優化 | ❓ | 無法由檔案結構直接判定，需實機檢視三斷點 |

> 說明：前端頁面骨架齊全，後端 API 亦多已實作。`rankSlice`/`walletSlice`（排行榜、帳務明細、送禮）已切換為真實 API 呼叫（mock 作 fallback，2026-06-25 BUG-001/002 修正）；其餘遊戲頁（slot/baccarat）仍以 `VITE_USE_MOCK_API=false` 環境變數切換真實/mock。

### A.10 測試 / DevOps / 收尾（組員D + 組長A）

| 任務 | 優先 | 任務名稱 | 狀態 | 盤點依據 |
|---|:--:|---|:--:|---|
| T-090 | P0 | JMeter 高併發壓測腳本 | ⚠️ | JMX、執行器、分析器、1,000 玩家 provisioning 與實測報告已完成；單機實測帳務無超扣/冪等正常，但 1,000 併發 P99≈2.5s 且有大量 5xx，效能 gate 未達標（需正式/多機資源重測） |
| T-091 | P0 | 帳務一致性對帳腳本 | ✅ | `tests/performance/accounting-reconciliation.sql` + `run-accounting-reconciliation.ps1`：壓測後驗證 wallets.balance 與流水加總一致、無負餘額、frozen_amount 歸零 |
| T-092 | P1 | Swagger UI API 文件 | ✅ | 各 REST/通知服務整合 springdoc-openapi，定義 OpenAPI metadata 與 JWT security scheme；gateway `/swagger-ui.html` 聚合 member/wallet/game/rank/admin/notification 的 `/v3/api-docs/{service}`；含 infra contract test |
| T-093 | P0 | End-to-End 整合測試 | ⚠️ | 後端服務多已實作；`feature/e2e-tests` 已有 Playwright E2E（登入/捕魚進場→開火→收網→逐發驗證等），但尚未涵蓋跨服務全鏈路（下注→帳務→排行→通知）整合驗證 |
| T-094 | P0 | README 與部署文件 | ✅ | README.md + DEPLOY.md 皆存在（DEPLOY.md 於 2026-05-29 補上本機部署 SOP） |
| T-095 | P0 | ADR 整理（ADR-001~005） | ✅ | ADR-000~005 皆已產出於 `docs/adr/`：001（DB CQRS 分配）、002（wallet.credit 指令/事件分離）、003（捕魚機血量/傷害模型）、004（捕魚機經濟再平衡 RTP 0.96/殘血回收）、005（月度累計簽到獎勵） |
| T-096 | P0 | 結業簡報 | ❌ | 未見簡報 / Demo 影片 |

### A.11 鑽石點數卡系統（T-100~T-107，後續新增需求）

| 任務 | 負責人 | 優先 | 任務名稱 | 狀態 | 盤點依據 |
|---|---|:--:|---|:--:|---|
| T-100 | 組員D | P0 | 鑽石相關資料表 | ✅ | `database/mysql/migration/V5__add_diamond_cards.sql`（diamond_cards）+ `database/postgres/migration/V2__add_diamond_wallets.sql`（diamond_wallets，含樂觀鎖 version） |
| T-101 | 組員C | P0 | 鑽石錢包初始化 | ✅ | `DiamondWalletService.createDiamondWallet()` 已接入 `MemberEventListener`（Kafka `member.registered`）；冪等 + 並發安全（DataIntegrityViolationException 吞除）；含單元測試 |
| T-102 | 組員C | P0 | 點數卡序號兌換鑽石 API | ✅ | `POST /api/v1/wallet/diamond/redeem`（`DiamondController` + `DiamondRedeemService`）；序號 MySQL 原子標記 + PostgreSQL 鑽石入帳，含樂觀鎖 |
| T-103 | 組員C | P0 | 鑽石兌換星幣 API | ✅ | `POST /api/v1/wallet/diamond/exchange`（1 鑽石 = 20 星幣；`DiamondExchangeService` 同一事務扣鑽石 + 入星幣；含冪等鍵）|
| T-104 | 組員C | P0 | 查詢鑽石餘額 API | ✅ | `GET /api/v1/wallet/diamond/balance`（`DiamondWalletService.getBalance()`，readOnly 事務）|
| T-105 | 組員D | P1 | 批量生成點數卡序號 API | ✅ | `POST /admin/diamond/cards`（admin MySQL 源寫 diamond_cards），UUID 序號 XXXX-XXXX-XXXX-XXXX 唯一、撞號重產、最多 1000 張/次 |
| T-106 | 組員D | P1 | 查詢點數卡列表 API | ✅ | `GET /admin/diamond/cards?page=&size=&status=all\|redeemed\|unredeemed`，欄位含 card_code/face_value/is_redeemed/redeemed_by/redeemed_at |
| T-107 | 組員E | P1 | 鑽石錢包頁面（前端） | ✅ | `frontend/src/pages/Diamond.jsx` + `frontend/src/store/slices/diamondSlice.js` + `frontend/src/services/diamondApi.js` 皆存在 |

> ✅ **鑽石系統 T-100~T-107 全數完成**（2026-06-17 重新盤點）。DB schema、後端 API（wallet-service）、前端頁面皆已實作。

### A.12 新增任務（T-108~T-114）

> 2026-06-16 新增至工作分配表 xlsx，皆已標記 ✅ 完成。

| 任務 | 任務名稱 | 狀態 | 盤點依據 |
|---|---|:--:|---|
| T-108 | 停用玩家即時封鎖（Redis 封鎖 + token min-iat）| ✅ | admin `PlayerBanService` 寫 `disabled:player:` + `token:min-iat:`；gateway filter 新增 min-iat 驗證；member 登入加查封鎖標記（CHANGELOG 2026-06-16）|
| T-109 | Gateway 補 `/api/v1/friends/**` 路由 | ✅ | `gateway-service/application.yml` 新增 `member-friends` route（CHANGELOG 2026-06-16）|
| T-110 | Windows 一鍵啟動腳本（start-all.bat） | ✅（已除役） | 曾建立 `start-all.bat` / `stop-all.bat`（CHANGELOG 2026-06-16）；後端容器化（PR #172）後原生啟動腳本全數移除，改由 `docker compose up -d --build` 取代（CHANGELOG 2026-07-07）|
| T-111 | 捕魚機遊戲（game-service fishing）| ✅ | `frontend/src/pages/Fishing.jsx` 存在；後端捕魚機邏輯（依 AGENTS.md T-038）|
| T-112 | CasinoShop 頁面 | ✅ | `frontend/src/pages/CasinoShop.jsx` 存在 |
| T-113 | CheckIn 頁面 | ✅ | `frontend/src/pages/CheckIn.jsx` 存在 |
| T-114 | 統一客服入口（SupportModal / uiSlice）| ✅ | `SupportModal.jsx` + `uiSlice.js` 抽成 App 根層，QuickToolbar / 頭像下拉統一入口（CHANGELOG 2026-06-16）|

### A.13 進度統計

> 最後更新：2026-06-30（校正過時標記——T-085/T-086 前端已切真實 API、T-095 ADR-003~005 已產出、T-093 後端已實作且有 Playwright e2e）

| 狀態 | 任務數 | 占比 |
|---|:--:|:--:|
| ✅ 已完成 | 51 | ~60% |
| ⚠️ 部分完成 | 8 | ~9% |
| ❌ 未開始 | 25 | ~29% |
| ❓ 待確認 | 1 | ~1% |
| **總計** | **85** | 100% |

> 變動紀錄：
> - 2026-06-09：T-033~T-037 ❌→✅（game-service 全完成），✅ 24→29，❌ 42→37，總計 78。
> - 2026-06-17：T-070~T-073 ❌→✅（notification 全完成）、T-100~T-104 / T-107 ❌→✅（鑽石系統全完成）、新增 T-108~T-114 全部 ✅，✅ 29→46，❌ 37→27，總計 78→85。
> - 2026-06-24：修正漏記——T-027 ❌→✅、T-028 ⚠️→✅（兩者 2026-06-01 即 commit c945f97/2646cb3 併入 develop+main，含測試，6/17 盤點時誤標未完）。✅ 46→48，⚠️ 11→10，❌ 27→26。**wallet-service T-020~T-028 全數完成。**
> - 2026-06-30：校正過時標記（以程式碼為準）——T-085 ⚠️→✅（`rankSlice` 已改用 `rankApi`）、T-086 ⚠️→✅（`walletSlice` 已用 `walletApi.getTransactions`）、T-095 ⚠️→✅（`docs/adr/ADR-003~005` 已產出）、T-093 ❌→⚠️（後端已實作 + `feature/e2e-tests` 已有 Playwright e2e，僅缺跨服務全鏈路）。✅ 48→51，⚠️ 10→8，❌ 26→25。

> 註：本次（2026-06-09）將 T-033~T-037 由 ❌ 改為 ✅（game-service 全數完成），故 ✅ 由 24→29、❌ 由 42→37。

**按模組完成度概覽：**

- ✅ **完成度高**：全域基礎建設、Member Service、Gateway、**Wallet Service（T-020~T-028 全完成）**、Game Service（T-030~T-037）、Rank Service（T-040~T-044）、**Notification Service（T-070~T-073 全完成）**、**鑽石系統（T-100~T-107 全完成）**
- ⚠️ **進行中**：前端（排行榜/帳務明細已切真實 API；slot/baccarat 仍靠 `VITE_USE_MOCK_API` 切換）、E2E 跨服務全鏈路測試（T-093）、壓測效能 gate 重測（T-090）
- ❌ **尚未起步**：結業簡報 / Demo 影片（T-096）

> **結論**：認證、帳號、帳務（含破產補助/DLT 後台）、遊戲對局、排行榜、即時推播、鑽石點數卡系統、Admin GM 手動發幣與 Swagger/OpenAPI 聚合皆已完成；**剩餘空白主要集中在收尾驗證/簡報與前端 mock→真實 API 切換**。
