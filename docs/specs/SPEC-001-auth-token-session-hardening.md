# SPEC-001 — 認證安全強化：Token / Session / 登出撤銷 / Cookie 儲存

> **狀態**：待實作
> **建議任務編號**：T-110 ~ T-113（正式編號以 `docs/幸運星幣城_工作分配表.xlsx` 為準）
> **實作者注意**：動工前先讀 `AGENTS.md`（尤其雷區 2、3、19）與本文件 §7 風險清單。
> 本文件是「需求 + 現況 + 驗收標準」的單一真相；實作細節允許在不違反驗收標準下調整，
> 但任何偏離 §4 設計決策的做法必須先在 PR 說明中提出理由。

---

## 1. 目標（來自資安需求）

| 編號 | 需求 | 現況 |
|---|---|---|
| R1 | Token 採短效 + refresh 續期；不得簽發永久有效 token | 🟡 大致達標，缺簽發上限防呆與 refresh type 檢查 |
| R2 | Session 具備過期 / 逾時機制（**閒置 + 絕對**） | 🔴 只有閒置（refresh 滑動），**無絕對逾時 → 可無限續期** |
| R3 | 登出由後端撤銷 token / session；改密碼須使其他裝置登入失效 | 🟡 登出已達標；**改密碼端點不存在** |
| R4 | token（尤其 refresh token）不得存 localStorage；改用 httpOnly cookie + 防 XSS | 🔴 access / refresh 都存 localStorage |

---

## 2. 現況盤點（實作前務必先讀這些檔案）

### 2.1 後端

| 檔案 | 現況 |
|---|---|
| `backend/member-service/src/main/java/com/luckystar/member/security/JwtTokenProvider.java` | HS256 簽發；claims 含 `jti`/`sub`/`username`/`role`/`type`（`access`/`refresh`）；TTL 由設定注入，**無上限驗證** |
| `backend/member-service/src/main/resources/application.yml:58-61` | `jwt.access-token-expiry-ms` 預設 900000（15 分）、`jwt.refresh-token-expiry-ms` 預設 604800000（7 天） |
| `backend/member-service/.../service/AuthService.java` | `login()` 簽發雙 token、refresh 存 Redis；`logout()` 把 access 的 jti 加黑名單 + 刪 refresh；`refreshToken()` 驗簽章 → 比對 Redis → **輪替**（刪舊存新，single-flight 由前端保證）。⚠️ `refreshToken()` **未驗 `type==refresh`**、**每次輪替重簽整整 7 天 → 無限滑動** |
| `backend/member-service/.../service/TokenRedisService.java` | Redis key：`refresh:{memberId}`（一人一把 → 新登入即踢掉舊裝置的 refresh）、`jwt:blacklist:{jti}`、`disabled:player:{id}` |
| `backend/gateway-service/.../filter/JwtAuthenticationGlobalFilter.java` | 驗簽章 + exp → 查黑名單 → 查停用 → **查 `token:min-iat:{sub}`（iat 早於門檻即 401）** → fail-closed。⚠️ 改密碼撤銷可直接重用 min-iat 機制，**gateway 不用改** |
| `backend/gateway-service/src/main/resources/application.yml:272-281` | `jwt.whitelist` 含 `/api/v1/auth/`（login/refresh/logout 免 gateway JWT）；CORS `allowCredentials: true`、origins 由 `CORS_ALLOWED_ORIGINS` 注入 |
| member-service 無任何改密碼端點 | `grep -ri password backend/member-service/.../controller` 為空 |

### 2.2 前端

| 檔案 | 現況 |
|---|---|
| `frontend/src/store/slices/authSlice.js:6-7,59-60,74-75,85-86,96-97` | access/refresh **都寫 localStorage**，重整時還原 |
| `frontend/src/services/api.js` | axios 攔截器：401 → single-flight silent refresh（`refreshPromise`）→ 重送原請求；失敗 `forceLogout()` |
| `frontend/src/services/memberApi.js:93-105` | `logout()` 呼叫後端再清 localStorage |
| `frontend/src/services/mockApi.js` | mock 模式（`VITE_USE_MOCK_API==='true'`）自己簽假 token，一樣流進 authSlice → localStorage |

---

## 3. 需求細則與驗收標準

> 驗收標準一律 Given/When/Then。每一條都必須有對應的自動化測試（後端 JUnit、
> 前端至少 lint+build 通過 + §6 手動腳本），或在 PR 中說明為何只能手動驗。

### R1 — Token 短效 + refresh 續期，禁止永久 token（工作量：小）

現況已是短效 + 輪替，本項只做**防呆與縱深**：

1. **簽發上限 fail-fast**：`JwtTokenProvider` 建構子驗證
   `0 < accessTokenExpiryMs <= 3_600_000`（1 小時）且
   `0 < refreshTokenExpiryMs <= 2_592_000_000`（30 天），
   違反即丟 `IllegalStateException` 讓服務啟動失敗。
   *為什麼*：TTL 來自環境變數，防止有人在部署時把 TTL 設成 100 年，等同永久 token；
   fail-fast 比執行期靜默截斷更容易被發現（比照 `JWT_SECRET` 缺值即啟動失敗的既有慣例）。
2. **refresh 端點驗 token 型別**：`AuthService.refreshToken()` 在驗簽章後檢查
   `claims.get("type").equals("refresh")`，否則丟 `InvalidTokenException`。
   *為什麼*：目前靠「Redis 存的是 refresh、比對不上就拒絕」間接擋掉 access token 換發，
   屬巧合防禦；顯式檢查是縱深，也讓錯誤訊息可判讀。

**驗收**：
- Given `JWT_ACCESS_TOKEN_EXPIRY_MS=999999999999`，When 啟動 member-service，Then 啟動失敗且錯誤訊息指出 TTL 超限。（測試：直接 new `JwtTokenProvider` 斷言丟例外即可，不必起 context）
- Given 有效的 **access** token，When `POST /api/v1/auth/refresh` 以它當 refreshToken，Then 401/`InvalidTokenException`。

### R2 — Session 閒置逾時 + 絕對逾時（工作量：中；本 SPEC 核心）

**觀念**：本專案無伺服器端 HTTP session，「session」= 一次登入建立的 refresh 續期鏈。
- **閒置逾時（idle）**＝refresh token 本身的 TTL：玩家超過 idle 沒有任何續期動作，refresh 過期、Redis key 也因 TTL 消失 → 需重新登入。現制 7 天滑動即是 idle，保留。
- **絕對逾時（absolute）**＝從**最初登入**起算的上限，無論多活躍，到點就要重新輸入密碼。**現制完全沒有**：每次 refresh 重簽 7 天，活躍玩家可無限續期，這正是本項要修的洞。

**設計**：
1. 新增設定 `session.absolute-ttl-ms`（`application.yml`，預設 `${SESSION_ABSOLUTE_TTL_MS:2592000000}` = 30 天）。
2. `login()` 時記下 `sessionStartAt = now`。**建議實作**：把 Redis `refresh:{memberId}` 的值從裸 token 字串改成 JSON `{"token":"...","sessionStartAt":1699999999999}`（用 `ObjectMapper`，比照 `FishingSessionStore` 的慣例）。
   *為什麼不another key*：token 與 session 起點必須同生共死（同一次 `SET` 原子寫入、同一個 TTL 過期），拆兩把 key 會有其中一把先過期的縫隙。
   *相容性*：讀取時若值不是 JSON（舊格式裸字串），視為無效、要求重新登入即可——這是安全側的降級，且只影響部署當下已登入者一次。
3. `refreshToken()` 輪替時：
   - 檢查 `now - sessionStartAt < absoluteTtl`，超過 → 刪 key、丟 `InvalidTokenException("Session expired, please login again")`。
   - 新 refresh token 的 exp 與 Redis TTL 取 `min(idleTtl, sessionStartAt + absoluteTtl - now)`——確保 JWT 自身的 exp 也不會越過絕對上限（縱深：即使 Redis 被清空重建，JWT exp 仍守住上限）。
   - 輪替時 `sessionStartAt` **原樣帶到新值，不得重置**。

**驗收**：
- Given 一條 session 的 `sessionStartAt` 已超過 absolute TTL（測試中把 TTL 設成極小值或直接操縱 Redis 值），When refresh，Then 401 且 Redis `refresh:{memberId}` 被刪除。
- Given 正常 refresh 輪替 N 次，Then 每次回傳的新 refresh token 其 `exp - now <= min(idleTtl, 剩餘絕對額度)`，且 `sessionStartAt` 不變。
- Given 玩家 7 天無活動，Then Redis key 因 TTL 消失、refresh 回 401（既有行為，加回歸測試守住）。

### R3 — 後端撤銷：登出（已達標，補測試）＋ 改密碼全裝置失效（新端點）

**登出**（現制已符合，只補回歸測試）：`logout()` 已做「access jti 進 `jwt:blacklist:{jti}`（TTL=剩餘壽命）＋刪 `refresh:{memberId}`」，gateway 查黑名單擋掉未過期的 access。驗收：
- Given 已登出的 access token，When 透過 gateway 打任一受保護端點，Then 401（gateway 測試已有黑名單案例則沿用，缺則補）。
- Given 已登出，When refresh，Then 401。

**改密碼**（全新）：
1. 端點 `PUT /api/v1/player/password`，body `{ "oldPassword": "...", "newPassword": "..." }`。
   放在 member-service 既有 player controller 慣例下（與 `PUT /api/v1/player/profile` 同層），
   身分取自 gateway 轉發的 `X-User-Id`（比照 profile 端點的既有讀法）。
   `newPassword` 的 `@Pattern`/長度規則**沿用 `RegisterRequest` 的密碼規則**，不要另立標準。
2. 流程（單一 service 方法）：
   a. 查 Member → `passwordEncoder.matches(oldPassword, hash)` 不符 → 401/400（訊息不可洩漏帳號是否存在以外的資訊）。
   b. 更新 `passwordHash`（同一 `@Transactional`）。
   c. **撤銷所有裝置**：
      - 寫 `token:min-iat:{playerId} = now(epoch 秒)`，TTL ≥ `max(accessTtl, refreshTtl, absoluteTtl)`（實務上設 absoluteTtl 即可）——gateway 既有 min-iat 檢查（`JwtAuthenticationGlobalFilter.java:105-117`）會讓**所有早於此刻簽發的 access token** 立即 401，**gateway 零改動**。
      - 刪 `refresh:{playerId}` → 所有裝置無法續期。
   d. 回應成功後**本機也要重新登入**（min-iat 一寫，本機這顆 access 同樣失效——這是「全裝置失效」語意的自然結果，前端配合導回登入頁，見下）。
   *為什麼用 min-iat 而非逐顆黑名單*：伺服器不知道玩家手上有幾顆歷史 access token（每次 refresh 都發新的），jti 黑名單只能撤「看得到的那顆」；min-iat 是「時間門檻」一刀切，正是 gateway 為停用玩家已建好的機制，重用它零成本。
3. Redis 寫入失敗處理：c 步任何 Redis 例外 → 整個交易回滾（丟出讓 `@Transactional` 回滾的 RuntimeException）。*為什麼*：密碼已換但舊 token 全數存活，是最危險的中間態（使用者以為踢掉了盜用者，實際沒有）；比照 `login()` 對 Redis 失敗 fail-fast 的既有慣例。
4. 前端：個人資料頁加改密碼表單（三欄：舊密碼/新密碼/確認新密碼），成功後 dispatch `logout()` 清 state 並導回 `/login`，顯示「密碼已更新，請重新登入」。mock 模式在 `mockApi.js` 鏡像同樣行為（雷區 14 的精神）。

**驗收**：
- Given 裝置 A、B 各持有效 token，When A 改密碼成功，Then B 的 access 打任一受保護端點 401、B 的 refresh 401；A 自己也需重新登入。
- Given 舊密碼錯誤，When 改密碼，Then 4xx 且 `passwordHash` 未變、未寫任何 Redis key。
- Given Redis 掛掉，When 改密碼，Then 5xx 且 `passwordHash` 未變（交易回滾）。
- 改密碼後用**新密碼**登入成功、**舊密碼**登入 401。

### R4 — refresh token 改 httpOnly cookie，access 僅存記憶體（工作量：大；獨立 PR）

**方案決策**：access token 留在 **Redux 記憶體（不落任何 storage）**；refresh token 改 **httpOnly cookie**。
*為什麼不連 access 也放 cookie*：那要改 gateway 的 token 抽取邏輯（現在讀 `Authorization` header）、
且每個跨服務請求都變成 credentialed CORS；而 access 只有 15 分鐘壽命、不落 storage 後 XSS 竊取窗口極小。
真正致命的是 7 天壽命的 refresh token，把它鎖進 httpOnly cookie 就消滅了主要攻擊面。改動最小、收益最大。

**後端（member-service）**：
1. `login` / `refresh` 回應：refresh token **不再放 response body**，改下發
   `Set-Cookie: refresh_token=<jwt>; HttpOnly; Secure; SameSite=Lax; Path=/api/v1/auth; Max-Age=<剩餘秒數>`
   （用 Spring 的 `ResponseCookie` 建構）。
   - `Path=/api/v1/auth`：瀏覽器只在打 auth 端點時附帶，其他 API 請求完全不出現這顆 cookie，縮小 CSRF/洩漏面。
   - `Secure` 依設定開關 `session.cookie-secure`（預設 true；本機 dev 設 false——瀏覽器對 `http://localhost` 本就豁免，但 Docker/內網 IP 存取時需要此開關）。
   - `SameSite=Lax`：跨站 POST 不會帶 cookie → refresh/logout 天然免 CSRF。dev 環境 `localhost:5173 → localhost:8080` 是 same-site（同 registrable domain、埠不計），不受影響。
   - body 的 `LoginResponse`/`RefreshResponse` 保留 `accessToken`（可留 `refreshToken` 欄位為 null 或直接移除欄位——**建議直接移除**，避免誤用；前端同 PR 一起改，無相容性負擔）。
2. `refresh` / `logout` 端點改從 `@CookieValue("refresh_token")` 取 refresh token（logout 用它刪 Redis 時仍以 `X-User-Id`／access token 的 sub 為準，維持現邏輯）。`RefreshRequest` body 欄位移除。
3. `logout` 與 refresh 失敗（session 過期）時下發同名 cookie `Max-Age=0` 清除。
4. Cookie 由 member-service 下發、經 gateway 原樣透傳（Spring Cloud Gateway 預設不動 `Set-Cookie`，無需設定；若實測被吃掉才排查 `RemoveResponseHeader` 類 filter——目前設定檔沒有）。

**前端**：
1. `authSlice.js`：移除所有 `localStorage` 讀寫（見 §2.2 行號）；`refreshToken` 欄位整個移除；初始 state `accessToken: null`。
2. `api.js`：`refreshAccessToken()` 不再從 store 取 refresh token，改
   `axios.post('/api/v1/auth/refresh', {}, { withCredentials: true })`；
   401 攔截器維持 single-flight 不變（**不要動 `refreshPromise` 序列化**——refresh 輪替下並發續期第二發必 mismatch，此鎖是既有防線）。
3. **重整還原**：頁面載入時（App 啟動、`isAuthenticated===false` 且非 mock）先靜默打一次 refresh：成功 → 拿新 access token + `fetchProfile` 還原登入；失敗 → 停在未登入。加 app 級 loading 態避免閃爍「未登入」畫面。
4. `memberApi.logout()` 移除 localStorage 清理（後端清 cookie、slice 清記憶體即完成）。
5. mock 模式：token 只進記憶體，重整即需重新登入——dev-only 可接受，**不要**為 mock 另造 localStorage 持久化（會把要拆的東西裝回來）。
6. **XSS 防護**（本項的「防 XSS 處理」）：
   - `index.html` 加 CSP meta：`default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'`（若 Vite dev 需要 inline style，`style-src 'self' 'unsafe-inline'` 可接受；**script-src 不得有 unsafe-inline/unsafe-eval**，若 build 失敗先查是哪個依賴要求，別直接放行）。
   - 全域掃描 `dangerouslySetInnerHTML`／字串拼 HTML：`grep -r dangerouslySetInnerHTML frontend/src` 應為 0 筆；有則逐一改為 React 正常渲染。
   - 這些是「refresh token 已進 httpOnly」之上的縱深：CSP 擋 script 注入來源，httpOnly 保證就算注入成功也讀不到 cookie。

**驗收**：
- 登入後：瀏覽器 DevTools 中 `localStorage` **無任何 token**；`document.cookie` 讀不到 `refresh_token`（httpOnly）；Application 分頁可見該 cookie 且 `HttpOnly`/`SameSite=Lax`/`Path=/api/v1/auth` 正確。
- access 過期（或手動改壞 store 中的 token）後打受保護 API：自動靜默續期並重送成功，過程無整頁重導。
- 重整頁面：登入態自動還原（真後端模式）。
- 登出後：cookie 被清除（`Max-Age=0`），再打 refresh 401。
- `POST /api/v1/auth/refresh` 不帶 cookie（curl 無 cookie jar）→ 401。
- 前端 `npm run lint`、`npm run build`、既有 vitest 全綠；`grep -r "localStorage" frontend/src` 剩餘命中只允許偏好設定/音效/mock 內部 DB 類（不得有 token）。

---

## 4. 關鍵設計決策摘要（實作偏離須先說明）

1. **改密碼撤銷重用 gateway 既有 `token:min-iat:{sub}`**，不新增機制、不改 gateway。
2. **絕對逾時錨點 `sessionStartAt` 與 refresh token 同存一把 Redis key（JSON 值）**，同 TTL 原子共存亡。
3. **access token 記憶體、refresh token httpOnly cookie** 的混合方案；不把 access 搬進 cookie。
4. **`Path=/api/v1/auth` + `SameSite=Lax`** 取代 CSRF token 機制（cookie 只送 auth 端點、跨站 POST 不帶）。
5. Redis 撤銷寫入失敗一律 **fail-closed**（改密碼回滾、gateway 已有 fail-closed 前例）。

## 5. 交付切分（建議 3 個 PR，依序）

| PR | 內容 | 對應 |
|---|---|---|
| PR-1 | TTL fail-fast、refresh type 檢查、登出回歸測試 | R1 + R3 登出部分 |
| PR-2 | session 絕對逾時（Redis JSON 值改造）、改密碼端點 + 前端表單 | R2 + R3 |
| PR-3 | httpOnly cookie 遷移 + 前端 localStorage 拆除 + CSP | R4 |

*為什麼這樣切*：PR-1/2 純後端相容性風險低；PR-3 是前後端契約變更（response body 拿掉 refreshToken），必須前後端同 PR 原子合入，單獨隔離才好 review 與回退。每個 PR 依 `AGENTS.md` §3 記 CHANGELOG；R2/R4 屬架構級變更，PR-2、PR-3 各補一篇 `docs/adr/ADR-00X.md`。

## 6. 驗證計畫

**自動化（每個 PR 過 CI 前本機先跑）**：
```bash
mvn -pl backend/member-service,backend/gateway-service test   # H2，免外部基礎設施
cd frontend && npm run lint && npm run build && npx vitest run
```
新增測試最低要求：R1×2、R2×3、R3×4、R4 後端 cookie 屬性斷言（MockMvc 驗 `Set-Cookie` 的 HttpOnly/SameSite/Path/Max-Age）。member-service 測試比照既有 H2 + 測試 `application.yml` 模式（`AGENTS.md` 雷區 3）；Redis 互動測試沿用現有 AuthService 測試對 `TokenRedisService`/`StringRedisTemplate` 的處理方式（先看既有測試怎麼寫再跟進，勿另起爐灶）。

**手動 smoke（PR-2、PR-3 必做；環境啟動見 DEPLOY.md，注意 `.env` 需先載入 shell）**：
```bash
# 1. 登入取 cookie（-c 存 cookie jar）
curl -s -c /tmp/cj -X POST localhost:8080/api/v1/auth/login \
  -H 'Content-Type: application/json' -d '{"username":"...","password":"..."}'
# 2. refresh：帶 jar 成功、不帶 jar 401
curl -s -b /tmp/cj -X POST localhost:8080/api/v1/auth/refresh
curl -s -X POST localhost:8080/api/v1/auth/refresh   # 預期 401
# 3. 改密碼 → 舊 access 打 profile 應 401（min-iat 生效）、refresh 應 401
# 4. 絕對逾時：SESSION_ABSOLUTE_TTL_MS=60000 起服務，登入後等 61 秒 refresh → 401
# 5. 瀏覽器驗證：DevTools Application → localStorage 無 token、cookie HttpOnly=✓
```
測試帳號資金／請求節流注意事項見既有 smoke 慣例（遊戲請求間隔 ≥600ms 避開 gateway 429）。

## 7. 風險與地雷（除 AGENTS.md 既有雷區外）

1. **`/api/v1/auth/` 在 gateway whitelist** → refresh/logout 不經 gateway JWT 驗證，所有防線都在 member-service 端點內，測試要直測 member-service 行為而非依賴 gateway。
2. **refresh 輪替 + 並發**：前端 `refreshPromise` single-flight 是既有防線，PR-3 改造 `api.js` 時不得移除；後端不要為「重試友善」而放寬輪替（舊 token 寬限期會弱化被竊 refresh 的偵測）。
3. **Redis `refresh:{memberId}` 值格式變更（PR-2）**：部署瞬間存量裸字串值會解析失敗 → 設計上視為 session 無效、要求重登（安全側降級），release note 要註明「部署後所有玩家需重新登入一次」。
4. **cookie 經 gateway 透傳**：理論上 Spring Cloud Gateway 不動 `Set-Cookie`，但 PR-3 手動 smoke 必須實測 curl cookie jar 有拿到，不能只靠單元測試。
5. **CORS credentialed**：gateway 已 `allowCredentials: true` 且 origins 走環境變數（非 `*`），PR-3 只需前端 `withCredentials`；若未來 origins 改成 `*` 會直接爆 CORS，勿動。
6. **mock 模式（雷區 14 精神）**：authSlice 拆 localStorage 後 mock 模式重整需重登，屬預期行為，勿為 mock 加回持久化。
7. **admin 前端若共用 authSlice/api.js**，PR-3 改動會一併影響 admin 登入流程——實作前 `grep` admin 相關頁面對 token 的存取，一併驗證。
