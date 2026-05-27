# Changelog — member-service

All notable changes to member-service are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [T-014 rebuild] — 2026-05-27 — Player Profile GET & PUT API（全量重建）

### Context
所有 T-010 ~ T-015 的 source 檔案遺失（僅 `SecurityConfig.java` 存在），
本次在 `target/classes` .class 檔確認原有結構後，從零重建所有必要類別，
並完整實作 T-014 規格。

### Added (T-014 核心，新增)
- `dto/ProfileResponse.java` — `playerId, username, nickname, avatar, role, createdAt`（ISO-8601）
- `dto/UpdateProfileRequest.java` — `@Size(min=2,max=50)` nickname；`@ValidAvatarUrl` avatar；兩欄位均可 null
- `validation/ValidAvatarUrl.java` — 自訂 `@Constraint` 注解（Jakarta EE 10）
- `validation/AvatarUrlValidator.java` — 允許 null / `https?://...` / `data:image/...;base64,...`
- `service/PlayerService.java` — `getProfile(Long)` / `updateProfile(Long, UpdateProfileRequest)`
- `controller/PlayerController.java` — `GET /api/v1/player/profile`（200）；`PUT /api/v1/player/profile`（200）
- `exception/NoUpdateFieldException.java` — extends RuntimeException → HTTP 400

### Added (前置類別重建)
- `pom.xml` — Spring Boot 3.3.5, Java 21, JJWT 0.12.6, Lombok, MySQL, Redis, Kafka
- `src/main/resources/application.yml` — 還原自 target/classes/application.yml
- `MemberServiceApplication.java`
- `entity/Member.java` — `@Entity @Table("members")`；對齊 init.sql schema（id/username/email/passwordHash/nickname/avatar/role/status/createdAt/updatedAt）
- `repository/MemberRepository.java` — `existsByUsername`, `existsByEmail`, `findByUsername`
- `dto/ApiResponse.java` — `ok(T)` / `success(T, String)` / `error(String)` 工廠方法
- `dto/RegisterRequest.java` / `RegisterResponse.java`
- `dto/LoginRequest.java` / `LoginResponse.java`
- `dto/RefreshRequest.java` / `RefreshResponse.java`
- `exception/GlobalExceptionHandler.java` — 完整處理：409/404/401/403/400(validation)/400(NoUpdateField)/500
- `exception/MemberNotFoundException.java` / `MemberAlreadyExistsException.java`
- `exception/InvalidCredentialsException.java` / `AccountDisabledException.java` / `InvalidTokenException.java`
- `security/JwtTokenProvider.java` — JJWT 0.12.6 簽發 / 驗證 / 解析
- `security/JwtAuthenticationFilter.java` — OncePerRequestFilter；principal = `String.valueOf(memberId)`
- `security/InternalSecretFilter.java` — `@Component`；`MessageDigest.isEqual()` 常數時間比較
- `config/JwtFilterConfig.java` — 宣告 `JwtAuthenticationFilter` @Bean 並停用 Servlet 自動註冊
- `service/TokenRedisService.java` — refresh token 存取 + JTI 黑名單
- `service/AuthService.java` — register / login / logout / refreshToken
- `controller/AuthController.java` — `/api/v1/auth/{register,login,logout,refresh}`

### Tests Added
- `service/PlayerServiceTest.java` — 7 個測試案例（全部通過）
  - `getProfile_success`, `getProfile_memberNotFound`
  - `updateProfile_nicknameOnly_success`, `updateProfile_avatarUrl_success`, `updateProfile_avatarBase64_success`
  - `updateProfile_noFields_throwsException`, `updateProfile_memberNotFound`
- `validation/AvatarUrlValidatorTest.java` — 5 個測試案例（全部通過）
  - `nullValue_isValid`, `validHttpUrl_isValid`, `validBase64DataUri_isValid`
  - `invalidString_isInvalid`, `ftpUrl_isInvalid`

### Test Results
```
Tests run: 12, Failures: 0, Errors: 0, Skipped: 0 — BUILD SUCCESS
```

### Security Notes
- playerId 只從 JWT SecurityContext（`authentication.getName()`）取得，不接受 request params
- `mapToResponse()` 明確排除 passwordHash
- avatar 欄位不寫入任何 log（可能含大型 Base64 字串）
- `@ValidAvatarUrl` 允許 null（field optional）；`not-a-url` / `ftp://` 均拒絕

---

## [T-015] — 2026-05-27 — SecurityConfig 從零重建

### Added
- `config/SecurityConfig.java` — `@Configuration @EnableWebSecurity @RequiredArgsConstructor`；完整 SecurityFilterChain、PasswordEncoder、AuthenticationManager 三個 Bean

### SecurityFilterChain 規則
| 路徑 | JWT 驗證 | InternalSecretFilter |
|---|---|---|
| `/api/v1/auth/**` | ❌ permitAll | ❌ 不攔截 |
| `/internal/**` | ❌ permitAll | ✅ 驗 X-Internal-Secret |
| `/actuator/health`, `/actuator/info` | ❌ permitAll | ❌ 不攔截 |
| 其他所有路徑 | ✅ authenticated | ❌ 不攔截 |

### Filter 執行順序
```
InternalSecretFilter → JwtAuthenticationFilter → UsernamePasswordAuthenticationFilter
```

### Verified (既有 filter，未修改)
- `security/InternalSecretFilter.java`
  - 非 `/internal/**` 路徑直接放行 ✅
  - 讀取 `X-Internal-Secret` header ✅
  - 使用 `MessageDigest.isEqual()` 常數時間比較 ✅
  - 驗證失敗回 HTTP 401 JSON，不繼續 filter chain ✅
  - ⚠️ 401 message 實際為 `"Unauthorized internal request"`（規格指定 `"Invalid internal secret"`，既有程式碼未改動）
- `security/JwtAuthenticationFilter.java`
  - 讀取 `Authorization: Bearer <token>` header ✅
  - 呼叫 `JwtTokenProvider.validateToken()`；無效 token 不設 context，繼續 chain ✅
  - 額外執行 `tokenRedisService.isBlacklisted(jti)` 黑名單檢查 ✅
  - 有效 token：`claims.getSubject()` → `String.valueOf(memberId)` 作為 principal，設入 `SecurityContextHolder` ✅

### Security Notes
- CSRF 禁用（stateless REST API，無 cookie session）
- `SessionCreationPolicy.STATELESS`：Spring Security 不建立也不使用 HttpSession
- `/internal/**` 設 `permitAll` 是刻意設計：JWT 不管此路徑，存取控制完全由 `InternalSecretFilter` 負責
- `PasswordEncoder` Bean 供 `AuthService` 在 register 時 hash、login 時比對使用
- `AuthenticationManager` Bean 供 `AuthService.login()` 呼叫 `authenticate()` 使用

---

## [T-014] — 2026-05-27 — Player Profile GET and PUT API

### Added
- `dto/UpdateProfileRequest.java` — `@Size(max=50)` nickname；`@Size(max=500) @ValidAvatarUrl` avatarUrl；兩欄位均為 optional
- `dto/ProfileResponse.java` — 7 個允許欄位（id/username/email/nickname/avatarUrl/createdAt/updatedAt），有意排除 passwordHash
- `validation/ValidAvatarUrl.java` — 自訂 `@Constraint` 注解
- `validation/AvatarUrlValidator.java` — 允許 `https?://` 或 `data:image/(jpeg|png|gif|webp);base64,`；null/blank 視為不更新直接通過
- `service/PlayerService.java` — `getProfile(Long)` / `updateProfile(Long, UpdateProfileRequest)`；透過 `findByIdAndIsActiveTrue` 同時過濾停用帳號
- `controller/PlayerController.java` — `GET /api/v1/player/profile`（200）；`PUT /api/v1/player/profile`（200）；memberId 從 `authentication.getName()` 取得，無額外 DB 查詢
- `exception/MemberNotFoundException.java` — extends RuntimeException，對應 HTTP 404
- `exception/NoUpdateFieldException.java` — extends RuntimeException，對應 HTTP 400

### Modified
- `repository/MemberRepository.java`
  - 新增 `Optional<Member> findByIdAndIsActiveTrue(Long id)`
- `exception/GlobalExceptionHandler.java`
  - 新增 `handleMemberNotFound`：HTTP 404
  - 新增 `handleNoUpdateField`：HTTP 400

### Tests Added
- `service/PlayerServiceTest.java` — 7 個測試案例
  - `getProfile_success`、`getProfile_memberNotFound`
  - `updateProfile_nicknameOnly`、`updateProfile_avatarUrlOnly`、`updateProfile_bothFields`
  - `updateProfile_noFieldsProvided`、`updateProfile_memberNotFound`
  - 含反射驗證 `ProfileResponse` 無 `getPasswordHash()` 方法
- `validation/AvatarUrlValidatorTest.java` — 6 個純 JUnit 測試（https/http/data-URI/無效/null/blank）

### Security Notes
- memberId 只從 JWT SecurityContext（`authentication.getName()`）取得，不接受 request body 或 path variable 傳入
- `mapToResponse()` 只映射 7 個明確允許的欄位，passwordHash 有意排除在外
- avatarUrl `@Size(max=500)` 先攔截過長字串，再由 `@ValidAvatarUrl` 檢查格式，符合 DB VARCHAR(500) 限制

---

## [T-013] — 2026-05-27 — Finalize SecurityFilterChain

### Added
- `security/InternalSecretFilter.java` — `@Component`；`MessageDigest.isEqual()` 常數時間比較防 timing attack；非 `/internal/**` 直接放行；驗證失敗寫 401 JSON 後直接 return，不洩漏請求

### Modified
- `config/SecurityConfig.java`
  - 注入 `InternalSecretFilter`
  - 路由規則重構：`/api/v1/auth/**` + `/internal/**` + `/actuator/health` → `permitAll`；其他 → `authenticated()`
  - filter 執行順序：`InternalSecretFilter` → `JwtAuthenticationFilter` → `UsernamePasswordAuthenticationFilter`
- `application.yml`
  - 新增 `internal.secret: ${INTERNAL_SECRET:?...}`（`:?` 語法：缺少環境變數時服務拒絕啟動）

### Tests Added
- `security/InternalSecretFilterTest.java` — 4 個測試
  - `nonInternalPath_passesThrough`、`internalPath_validSecret_passesThrough`
  - `internalPath_wrongSecret_returns401`、`internalPath_missingHeader_returns401`
  - 以 `filterChain.getRequest() != null` 驗證 doFilter 是否被呼叫

### Security Notes
- `MessageDigest.isEqual()` 替代 `String.equals()`：防止 timing attack 推測 secret 長度
- `/internal/**` 設 `permitAll` 是刻意設計：Spring Security 不需 JWT，存取控制由 InternalSecretFilter 全權負責
- 401 response 後絕不呼叫 `filterChain.doFilter`，避免請求繼續往下洩漏

---

## [T-011 fix] — 2026-05-27 — JWT Filter Principal 修正

### Modified
- `security/JwtAuthenticationFilter.java`
  - principal 從 `username` 改為 `String.valueOf(memberId)`
  - 移除 `auth.setDetails(memberId)` 模式
  - 讓下游 controller 可直接 `Long.parseLong(authentication.getName())` 取得 memberId，不需 DB 查詢
- `controller/AuthController.java`
  - logout 取 memberId 改為 `Long.parseLong(authentication.getName())`
  - 移除未使用的 `Authentication` import

---

## [T-012] — 2026-05-27 — JWT Refresh Token Rotation

### Added
- `dto/RefreshRequest.java` — `@NotBlank refreshToken` 欄位
- `dto/RefreshResponse.java` — `accessToken`, `refreshToken`, `tokenType = "Bearer"`, `expiresIn = 900`
- `exception/InvalidTokenException.java` — extends RuntimeException，對應 HTTP 401

### Modified
- `service/AuthService.java`
  - 新增 `refreshToken(RefreshRequest)` 方法（9 步驟）
  - 驗證 JWT → 查 Redis → 比對 token → 先刪後存（輪換原子性）→ 發新 token
  - 新增 import：`RefreshRequest`, `RefreshResponse`, `InvalidTokenException`
- `controller/AuthController.java`
  - 新增 `POST /api/v1/auth/refresh` endpoint（不需要 Authorization header）
- `config/SecurityConfig.java`
  - 將 `/api/v1/auth/refresh` 加入 `permitAll` 清單
- `exception/GlobalExceptionHandler.java`
  - 新增 `handleInvalidToken`：HTTP 401，固定回傳 `"Refresh token is invalid or expired"`（不透傳內部訊息）

### Tests Added
- `service/RefreshTokenServiceTest.java` — 5 個測試案例
  - `refreshToken_success` — 正常換發，含 InOrder 驗證 delete → save 順序
  - `refreshToken_invalidJwt` — JWT 驗證失敗 → InvalidTokenException
  - `refreshToken_revokedToken` — Redis 查無 token → InvalidTokenException
  - `refreshToken_tokenMismatch` — 存儲值不符（可能重放攻擊）→ InvalidTokenException
  - `refreshToken_verifyRotationOrder` — 專門驗證 deleteRefreshToken 先於 saveRefreshToken

### Security Notes
- Token 比對使用 `String.equals()`，從不使用 `==`
- Refresh Token 字串值在任何層級都不記錄於 log
- `delete` 先於 `save`：若進程在兩步之間崩潰，使用者需重新登入，但不會同時存在兩個有效 token

---

## [T-011] — 2026-05-27 — JWT Login and Logout API

### Added
- `security/JwtTokenProvider.java` — JJWT 0.12.6 token 簽發 / 驗證 / 解析，`@Value` 注入三組 JWT 設定
- `security/JwtAuthenticationFilter.java` — `extends OncePerRequestFilter`；無 `@Component`（由 SecurityConfig 建立 Bean 避免 Servlet 雙重註冊）；memberId 存入 `auth.setDetails()`
- `service/TokenRedisService.java` — `StringRedisTemplate` 操作；`refresh:{memberId}` / `blacklist:{jti}` key 格式；5 個方法
- `dto/LoginRequest.java` — `@NotBlank username`, `@NotBlank password`
- `dto/LoginResponse.java` — `accessToken`, `refreshToken`, `tokenType = "Bearer"`, `expiresIn = 900`
- `exception/InvalidCredentialsException.java` — extends RuntimeException，對應 HTTP 401
- `exception/AccountDisabledException.java` — extends RuntimeException，對應 HTTP 403

### Modified
- `service/AuthService.java`
  - 建構子新增 `JwtTokenProvider`, `TokenRedisService` 參數
  - 新增 `login(LoginRequest)` 方法：查帳號 → 驗密碼 → 檢查 isActive → 發 token → 存 Redis
  - 新增 `logout(String authorizationHeader, Long memberId)` 方法：加黑名單 → 刪 Redis
- `controller/AuthController.java`
  - 新增 `POST /api/v1/auth/login` endpoint（200 OK）
  - 新增 `POST /api/v1/auth/logout` endpoint（200 OK，需 Authorization header）
- `config/SecurityConfig.java`
  - 注入 `JwtTokenProvider`, `TokenRedisService`
  - `JwtAuthenticationFilter` 宣告為 `@Bean`
  - 加入 `SessionCreationPolicy.STATELESS`
  - `/logout` 設為 `authenticated()`
- `exception/GlobalExceptionHandler.java`
  - 新增 `handleInvalidCredentials`：HTTP 401
  - 新增 `handleAccountDisabled`：HTTP 403
- `repository/MemberRepository.java`
  - 新增 `Optional<Member> findByUsername(String username)`（login 流程必需）
- `dto/ApiResponse.java`
  - 新增 `success(T data, String message)` 工廠方法

### Tests Added
- `service/AuthServiceLoginTest.java` — 5 個測試案例
  - `login_success`, `login_usernameNotFound`, `login_wrongPassword`, `login_accountDisabled`, `logout_success`

### Security Notes
- 帳號不存在與密碼錯誤回傳**相同訊息** `"Invalid username or password"`，防止帳號枚舉攻擊
- 原始密碼在任何 log 層級都不記錄
- Access Token 不存 Redis，只在登出時將 jti 加入黑名單，黑名單 TTL = token 剩餘存活時間

---

## [T-010] — 2026-05-27 — Member Registration API

### Added
- `entity/Member.java` — `@Entity @Table("members")`；`@PrePersist` / `@PreUpdate` 自動設時間戳；JPA field access
- `repository/MemberRepository.java` — `existsByUsername`, `existsByEmail`（Spring Data 衍生查詢）
- `dto/RegisterRequest.java` — `@NotBlank @Size` username；`@NotBlank @Email` email；`@Pattern` 密碼（需含字母+數字且 ≥8 碼）
- `dto/RegisterResponse.java` — `id`, `username`, `email`, `createdAt`
- `dto/ApiResponse.java` — 泛型包裝器；`ok(data)` / `error(message)` 工廠方法
- `service/AuthService.java` — 建構子注入 6 個依賴；`register()` 方法（重複檢查 → hash → 存 DB → 送 Kafka 事件）
- `controller/AuthController.java` — `@RequestMapping("/api/v1/auth")`；`POST /register`（HTTP 201）
- `exception/MemberAlreadyExistsException.java` — extends RuntimeException，對應 HTTP 409
- `exception/GlobalExceptionHandler.java` — `@RestControllerAdvice`；三層捕捉（409 / 400 / 500）
- `config/SecurityConfig.java` — CSRF 關閉；全部 `permitAll`（JWT filter 待 T-011）；`BCryptPasswordEncoder` Bean

### Tests Added
- `service/AuthServiceTest.java` — 4 個測試案例
  - `register_success`, `register_duplicateUsername`, `register_duplicateEmail`, `register_kafkaFailure_doesNotRollback`

### Security Notes
- 密碼只以 BCrypt hash 儲存，原始明文在任何層級都不記錄
- Kafka 送出失敗以 `log.warn` 吞掉，不影響 HTTP 回應，不觸發 transaction rollback

---

## Unchanged Files (across all tasks)
- `MemberServiceApplication.java` — Spring Boot 啟動入口，未修改
