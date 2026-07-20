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
> 盤點方式（2026-07-07 起自動化）：下方標記區塊由 `node tools/audit/generate-audit-snapshot.mjs`
> 依 `tools/audit/tasks.json` 的證據清單自動產生——逐項檢查證據檔案是否存在＋`git log --grep` 是否有
> 對應 commit，每次執行即為當下工作樹的即時盤點（判定規則見該工具檔頭註解）。
> ⚠️ 標記區塊內的手動修改會在下次執行時被覆蓋；要更正進度請改 `tools/audit/tasks.json` 再重跑。
> `--check` 模式只比對不寫入、有落差退出碼 1。標記區塊外的人工敘述照舊手動維護。
> 狀態圖例：✅ 已完成　⚠️ 部分完成　❌ 未開始　❓ 待確認（無法由程式碼直接判定）

<!-- AUDIT:BEGIN generated by tools/audit/generate-audit-snapshot.mjs — 手動修改會被覆蓋，請改 tools/audit/tasks.json -->

### A.1 全域 / 基礎建設（S0-W1）

| 任務 | 負責人 | 優先 | 任務名稱 | 狀態 | 盤點依據（自動產生） |
|---|---|:--:|---|:--:|---|
| T-000 | 組長A | P0 | GitHub Repo 與分支策略 | ✅ | 檔案 3/3 |
| T-001 | 組長A | P0 | 架構圖與 ADR | ✅ | 檔案 2/2；git log --grep "T-001" → 2 筆 |
| T-002 | 組員D | P0 | Docker Compose 環境 | ✅ | 檔案 1/1；git log --grep "T-002" → 5 筆 |
| T-003 | 組員D | P0 | 各 Service Spring Boot 初始化 | ✅ | 檔案 7/7 |
| T-004 | 組員E | P0 | React 前端初始化 | ✅ | 檔案 3/3 |
| T-005 | 組長A | P0 | Kafka Topic 規劃 | ✅ | 檔案 1/1；git log --grep "T-005" → 1 筆 |
| T-006 | 全員 | P0 | DB Schema 與 DDL | ✅ | 檔案 2/2；git log --grep "T-006" → 2 筆 |

### A.2 Member Service（組長A）

| 任務 | 優先 | 任務名稱 | 狀態 | 盤點依據（自動產生） |
|---|:--:|---|:--:|---|
| T-010 | P0 | 會員註冊 API | ✅ | 檔案 1/1；git log --grep "T-010" → 4 筆 |
| T-011 | P0 | JWT 登入/登出 API | ✅ | 檔案 2/2；git log --grep "T-011" → 5 筆 |
| T-012 | P0 | JWT Token 刷新 | ✅ | 檔案 1/1；git log --grep "T-012" → 3 筆 |
| T-013 | P0 | Spring Security 過濾器鏈 | ✅ | 檔案 2/2；git log --grep "T-013" → 3 筆 |
| T-014 | P0 | 玩家個人資料 CRUD | ✅ | 檔案 2/2；git log --grep "T-014" → 6 筆 |
| T-015 | P1 | 好友系統 API | ✅ | 檔案 2/2；git log --grep "T-015" → 2 筆 |
| T-016 | P1 | 任務系統資料結構 | ✅ | 檔案 3/3 |
| T-017 | P1 | 每日簽到 API | ✅ | 檔案 3/3；git log --grep "T-017" → 2 筆 |
| T-018 | P1 | 新手禮包自動發放 | ✅ | 檔案 2/2；git log --grep "T-018" → 1 筆 |

### A.3 Wallet Service（組員C）

| 任務 | 優先 | 任務名稱 | 狀態 | 盤點依據（自動產生） |
|---|:--:|---|:--:|---|
| T-020 | P0 | Wallet 初始化（開戶） | ✅ | 檔案 1/1；git log --grep "T-020" → 5 筆 |
| T-021 | P0 | 查詢星幣餘額 API | ✅ | 檔案 1/1；git log --grep "T-021" → 5 筆 |
| T-022 | P0 | 下注扣款 API | ✅ | 檔案 2/2；git log --grep "T-022" → 3 筆 |
| T-023 | P0 | 派彩入帳 API | ✅ | 檔案 2/2；git log --grep "T-023" → 5 筆 |
| T-024 | P0 | 冪等性防重複 | ✅ | 檔案 1/1；git log --grep "T-024" → 4 筆 |
| T-025 | P0 | 帳務流水查詢 API | ✅ | 檔案 2/2；git log --grep "T-025" → 5 筆 |
| T-026 | P1 | 好友星幣贈送 API | ✅ | 檔案 1/1；git log --grep "T-026" → 4 筆 |
| T-027 | P1 | 破產補助 API | ✅ | 檔案 1/1；git log --grep "T-027" → 4 筆 |
| T-028 | P2 | Kafka DLT 處理 | ✅ | 檔案 2/2；git log --grep "T-028" → 7 筆 |

### A.4 RNG Game Service（組員B）

| 任務 | 優先 | 任務名稱 | 狀態 | 盤點依據（自動產生） |
|---|:--:|---|:--:|---|
| T-030 | P0 | Provably Fair RNG 引擎 | ✅ | 檔案 2/2；git log --grep "T-030" → 13 筆 |
| T-031 | P0 | 老虎機遊戲邏輯 | ✅ | 檔案 2/2；git log --grep "T-031" → 6 筆 |
| T-032 | P0 | 老虎機遊戲 API | ✅ | 檔案 3/3；git log --grep "T-032" → 7 筆 |
| T-033 | P0 | Redis 遊戲 Session 管理 | ✅ | 檔案 1/1；git log --grep "T-033" → 7 筆 |
| T-034 | P1 | 百家樂遊戲邏輯 | ✅ | 檔案 1/1；git log --grep "T-034" → 5 筆 |
| T-035 | P1 | 百家樂遊戲 API | ✅ | 檔案 2/2；git log --grep "T-035" → 3 筆 |
| T-036 | P1 | RNG 公平性驗證 API | ✅ | 檔案 2/2；git log --grep "T-036" → 6 筆 |
| T-037 | P2 | 遊戲 RTP 統計 | ✅ | 檔案 3/3；git log --grep "T-037" → 9 筆 |

### A.5 Rank Service（組員D）

| 任務 | 優先 | 任務名稱 | 狀態 | 盤點依據（自動產生） |
|---|:--:|---|:--:|---|
| T-040 | P0 | Redis ZSet 全服排行榜 | ✅ | 檔案 2/2 |
| T-041 | P0 | 好友排行榜 | ✅ | 檔案 1/1；git log --grep "T-041" → 9 筆 |
| T-042 | P0 | 排行榜查詢 API | ✅ | 檔案 1/1；git log --grep "T-042" → 9 筆；註：頭像欄位待 member 端發布頭像後補（跨組待辦） |
| T-043 | P1 | 每週排行榜重置排程 | ✅ | 檔案 3/3 |
| T-044 | P1 | 每日持幣快照任務 | ✅ | 檔案 3/3 |
| T-045 | P2 | 今日贏幣王排行榜 | ✅ | 檔案 1/1；git log --grep "T-045" → 3 筆 |

### A.6 Admin Service（組員D）

| 任務 | 優先 | 任務名稱 | 狀態 | 盤點依據（自動產生） |
|---|:--:|---|:--:|---|
| T-050 | P1 | Admin JWT 認證（角色區分） | ✅ | 檔案 3/3；git log --grep "T-050" → 4 筆 |
| T-051 | P1 | 玩家帳號管理 API | ✅ | 檔案 3/3；git log --grep "T-051" → 7 筆 |
| T-052 | P1 | 星幣流通量報表 API | ✅ | 檔案 2/2；git log --grep "T-052" → 3 筆 |
| T-053 | P1 | 遊戲 RTP 監控儀表板 API | ✅ | 檔案 1/1；git log --grep "T-053" → 3 筆 |
| T-054 | P2 | 異常玩家偵測機制 | ✅ | 檔案 3/3；git log --grep "T-054" → 7 筆 |
| T-055 | P2 | 手動發放星幣 API（GM 工具） | ✅ | 檔案 2/2；git log --grep "T-055" → 6 筆 |

### A.7 Gateway（組長A）

| 任務 | 優先 | 任務名稱 | 狀態 | 盤點依據（自動產生） |
|---|:--:|---|:--:|---|
| T-060 | P0 | Spring Cloud Gateway 路由 | ✅ | 檔案 1/1 |
| T-061 | P0 | Gateway JWT 驗證過濾器 | ✅ | 檔案 1/1；git log --grep "T-061" → 1 筆 |
| T-062 | P0 | 每玩家速率限制 | ✅ | 檔案 2/2；git log --grep "T-062" → 2 筆 |
| T-063 | P1 | Circuit Breaker 熔斷 | ✅ | 檔案 1/1；git log --grep "T-063" → 2 筆 |

### A.8 Notification Service（組員D）

| 任務 | 優先 | 任務名稱 | 狀態 | 盤點依據（自動產生） |
|---|:--:|---|:--:|---|
| T-070 | P1 | WebSocket STOMP Server | ✅ | 檔案 2/2；git log --grep "T-070" → 6 筆 |
| T-071 | P1 | Kafka → WebSocket 推播橋接 | ✅ | 檔案 1/1；git log --grep "T-071" → 4 筆 |
| T-072 | P1 | 遊戲結果推播 | ✅ | 檔案 1/1；git log --grep "T-072" → 5 筆 |
| T-073 | P2 | 排行榜變動廣播 | ✅ | 檔案 1/1；git log --grep "T-073" → 5 筆 |

### A.9 前端（組員E）

| 任務 | 優先 | 任務名稱 | 狀態 | 盤點依據（自動產生） |
|---|:--:|---|:--:|---|
| T-080 | P0 | 登入/註冊頁面 | ✅ | 檔案 3/3 |
| T-081 | P0 | Redux Toolkit 全域狀態 | ✅ | 檔案 5/5 |
| T-082 | P0 | 遊戲大廳頁面 | ✅ | 檔案 1/1 |
| T-083 | P0 | 老虎機遊戲頁面 | ✅ | 檔案 2/2；git log --grep "T-083" → 3 筆 |
| T-084 | P0 | WebSocket 連線管理 | ✅ | 檔案 3/3；git log --grep "T-084" → 1 筆；註：2026-07-18 端對端驗收通過（真後端 Playwright：UI 登入→STOMP CONNECTED→spin 觸發→通知中心收到推播），驗收紀錄見 docs/report/T-084-T-093-端對端驗收報告-20260718.md；原「驗收未留存紀錄」override 已移除 |
| T-085 | P1 | 排行榜頁面 | ✅ | 檔案 2/2；git log --grep "T-085" → 2 筆 |
| T-086 | P1 | 帳務明細頁面 | ⚠️ | 檔案 1/2（缺 `frontend/src/pages/Transactions.jsx`）；git log --grep "T-086" → 1 筆 |
| T-087 | P1 | 百家樂遊戲頁面 | ✅ | 檔案 2/2；git log --grep "T-087" → 3 筆 |
| T-088 | P1 | 個人資料/好友管理頁面 | ✅ | 檔案 2/2 |
| T-089 | P2 | RWD 響應式優化 | ❓ | 人工判定：無法由檔案結構直接判定，需實機檢視三斷點 |

### A.10 測試 / DevOps / 收尾（組員D + 組長A）

| 任務 | 優先 | 任務名稱 | 狀態 | 盤點依據（自動產生） |
|---|:--:|---|:--:|---|
| T-090 | P0 | JMeter 高併發壓測腳本 | ✅ | 檔案 3/3；git log --grep "T-090" → 57 筆；註：2026-07-18 E3 結案輪正式驗收通過（D1-c：150 全綠 P99 377ms＋1,000 韌性 PASS 成功率 99.2%＋T-091 0 新違規），報告 Status=CLOSED，原效能 gate 未達標 override 已移除 |
| T-091 | P0 | 帳務一致性對帳腳本 | ✅ | 檔案 2/2；git log --grep "T-091" → 14 筆 |
| T-092 | P1 | Swagger UI API 文件 | ✅ | 檔案 1/1；git log --grep "T-092" → 3 筆 |
| T-093 | P0 | End-to-End 整合測試 | ✅ | 檔案 2/2；git log --grep "T-093" → 2 筆；註：2026-07-18 跨服務全鏈路（下注→帳務→排行→通知）整合驗證補齊：tests/e2e/full-chain.mjs 18 斷言全 PASS（roundId 於帳務流水/遊戲回應/WS 推播三處一致），驗收紀錄見 docs/report/T-084-T-093-端對端驗收報告-20260718.md；原 override 已移除 |
| T-094 | P0 | README 與部署文件 | ✅ | 檔案 2/2；git log --grep "T-094" → 1 筆 |
| T-095 | P0 | ADR 整理（ADR-001~005） | ✅ | 檔案 5/5；git log --grep "T-095" → 2 筆 |
| T-096 | P0 | 結業簡報 | ❌ | 檔案 0/1（缺 `docs/**/*簡報*`） |

### A.11 鑽石點數卡系統（T-100~T-107，後續新增需求）

| 任務 | 負責人 | 優先 | 任務名稱 | 狀態 | 盤點依據（自動產生） |
|---|---|:--:|---|:--:|---|
| T-100 | 組員D | P0 | 鑽石相關資料表 | ✅ | 檔案 2/2；git log --grep "T-100" → 9 筆 |
| T-101 | 組員C | P0 | 鑽石錢包初始化 | ✅ | 檔案 1/1；git log --grep "T-101" → 4 筆 |
| T-102 | 組員C | P0 | 點數卡序號兌換鑽石 API | ✅ | 檔案 2/2；git log --grep "T-102" → 8 筆 |
| T-103 | 組員C | P0 | 鑽石兌換星幣 API | ✅ | 檔案 1/1；git log --grep "T-103" → 5 筆 |
| T-104 | 組員C | P0 | 查詢鑽石餘額 API | ✅ | 檔案 1/1；git log --grep "T-104" → 8 筆 |
| T-105 | 組員D | P1 | 批量生成點數卡序號 API | ✅ | 檔案 2/2；git log --grep "T-105" → 5 筆 |
| T-106 | 組員D | P1 | 查詢點數卡列表 API | ✅ | 檔案 1/1；git log --grep "T-106" → 5 筆 |
| T-107 | 組員E | P1 | 鑽石錢包頁面（前端） | ✅ | 檔案 3/3；git log --grep "T-107" → 4 筆 |

### A.12 新增任務（T-108~T-114）

| 任務 | 任務名稱 | 狀態 | 盤點依據（自動產生） |
|---|---|:--:|---|
| T-108 | 停用玩家即時封鎖（Redis 封鎖 + token min-iat） | ✅ | 檔案 2/2；git log --grep "T-108" → 2 筆 |
| T-109 | Gateway 補 /api/v1/friends/** 路由 | ✅ | 檔案 1/1 |
| T-110 | Windows 一鍵啟動腳本（start-all.bat） | ✅ | 人工判定：已完成後由後端容器化取代（docker compose up -d --build，CHANGELOG 2026-07-07），原生腳本已移除；歷史 commit 見 git log --grep start-all |
| T-111 | 捕魚機遊戲（game-service fishing） | ✅ | 檔案 4/4 |
| T-112 | CasinoShop 頁面 | ✅ | 檔案 1/1 |
| T-113 | CheckIn 頁面 | ✅ | 檔案 1/1 |
| T-114 | 統一客服入口（SupportModal / uiSlice） | ✅ | 檔案 2/2；git log --grep "T-114" → 2 筆 |

### A.13 進度統計（自動計算）

| 狀態 | 任務數 | 占比 |
|---|:--:|:--:|
| ✅ 已完成 | 82 | 96% |
| ⚠️ 部分完成 | 1 | 1% |
| ❌ 未開始 | 1 | 1% |
| ❓ 待確認 | 1 | 1% |
| **總計** | **85** | 100% |

<!-- AUDIT:END -->

> 變動紀錄：
> - **2026-07-07：附錄 A 改為自動盤點**（`tools/audit/generate-audit-snapshot.mjs`，Phase 8）。上方標記區塊每次執行即時重算；本變動紀錄以下為歷史敘述、照舊人工維護。首跑結果 80 ✅ / 3 ⚠️ / 1 ❌ / 1 ❓——修正了舊手工統計表與逐項表不一致的問題（舊表記 25 ❌，但逐項表僅 T-096 一項 ❌），並把 T-083/T-087（前端已串真實 API、有 T-0xx commit）等過時 ⚠️ 轉 ✅；T-084/T-090/T-093 維持 ⚠️、T-089 維持 ❓（人工判定，理由見表內）。
> - 2026-06-09：T-033~T-037 ❌→✅（game-service 全完成），✅ 24→29，❌ 42→37，總計 78。
> - 2026-06-17：T-070~T-073 ❌→✅（notification 全完成）、T-100~T-104 / T-107 ❌→✅（鑽石系統全完成）、新增 T-108~T-114 全部 ✅，✅ 29→46，❌ 37→27，總計 78→85。
> - 2026-06-24：修正漏記——T-027 ❌→✅、T-028 ⚠️→✅（兩者 2026-06-01 即 commit c945f97/2646cb3 併入 develop+main，含測試，6/17 盤點時誤標未完）。✅ 46→48，⚠️ 11→10，❌ 27→26。**wallet-service T-020~T-028 全數完成。**
> - 2026-06-30：校正過時標記（以程式碼為準）——T-085 ⚠️→✅（`rankSlice` 已改用 `rankApi`）、T-086 ⚠️→✅（`walletSlice` 已用 `walletApi.getTransactions`）、T-095 ⚠️→✅（`docs/adr/ADR-003~005` 已產出）、T-093 ❌→⚠️（後端已實作 + `feature/e2e-tests` 已有 Playwright e2e，僅缺跨服務全鏈路）。✅ 48→51，⚠️ 10→8，❌ 26→25。
> - **2026-07-18：T-090 ⚠️→✅**（移除 override 回歸自動判定）：第二輪效能調校於 E3 結案輪正式驗收通過——D1-final 拍板選 c（宣告容量=150），150 併發全綠（P99 377ms/0 失敗/0 卸載）＝正式驗收 PASS、1,000 併發韌性驗證 PASS（accepted 成功率 99.2%）、T-091 九項 0 新違規；報告 Status=CLOSED（PR #218，藍圖 03 E1/E2/D1/D2/E3 全 ✅）。
> - **2026-07-18：T-084/T-093 ⚠️→✅**（移除 override 回歸自動判定）：兩筆「驗收缺口」實測補齊——T-093 新增 `tests/e2e/full-chain.mjs` 跨服務全鏈路（下注→帳務→排行→通知）18 斷言全 PASS（同局 roundId 於遊戲回應/帳務流水/WS 推播三處一致）；T-084 新增 `frontend/e2e/realtime-ws.spec.js` 真後端 Playwright 驗收 PASS（UI 登入→STOMP CONNECTED→通知中心收到推播）。驗收留存紀錄見 `docs/report/T-084-T-093-端對端驗收報告-20260718.md`。

> 註：本次（2026-06-09）將 T-033~T-037 由 ❌ 改為 ✅（game-service 全數完成），故 ✅ 由 24→29、❌ 由 42→37。

**按模組完成度概覽：**

- ✅ **完成度高**：全域基礎建設、Member Service、Gateway、**Wallet Service（T-020~T-028 全完成）**、Game Service（T-030~T-037）、Rank Service（T-040~T-044）、**Notification Service（T-070~T-073 全完成）**、**鑽石系統（T-100~T-107 全完成）**、**壓測與對帳（T-090/T-091，2026-07-18 E3 結案驗收通過）**、**E2E 端對端驗收（T-084/T-093，2026-07-18 實測補齊）**
- ⚠️ **進行中**：前端（排行榜/帳務明細已切真實 API；slot/baccarat 仍靠 `VITE_USE_MOCK_API` 切換）
- ❌ **尚未起步**：結業簡報 / Demo 影片（T-096）

> **結論**：認證、帳號、帳務（含破產補助/DLT 後台）、遊戲對局、排行榜、即時推播、鑽石點數卡系統、Admin GM 手動發幣與 Swagger/OpenAPI 聚合皆已完成；**剩餘空白主要集中在收尾驗證/簡報與前端 mock→真實 API 切換**。
