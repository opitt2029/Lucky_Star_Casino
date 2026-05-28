# 本機前後端串接測試指南

這份文件是給兩種人看的：

- 給同學：照著步驟在自己的電腦啟動專案，測試會員註冊、登入、取得個人資料。
- 給 AI：快速理解本專案的本機架構、port、API 串接方式與常見問題。

## 一句話架構

前端 React/Vite 會呼叫 `Gateway Service`，再由 Gateway 轉發到後端各個 service。

```text
Browser
  -> Frontend http://localhost:5173 或 http://localhost:5174
  -> Gateway  http://localhost:8080
  -> Member Service http://localhost:8081
  -> MySQL / Redis / Kafka
```

前端不要直接打 `member-service:8081`。本機開發時，前端應該打：

```text
http://localhost:8080
```

原因是 Gateway 負責：

- 統一 API 入口
- CORS 設定
- JWT 驗證
- 轉發 `/api/v1/auth/**`、`/api/v1/player/**` 等 API

## 必要工具

請先確認同學電腦有安裝：

| 工具 | 建議版本 | 用途 |
| --- | --- | --- |
| Git | 2.x 以上 | 下載專案 |
| Docker Desktop | 最新版 | 啟動 MySQL、Redis、Kafka |
| Java JDK | 21 | 啟動 Spring Boot 後端 |
| Maven | 3.9 以上，或使用專案內 `mvnw` | 啟動後端 |
| Node.js | 20 以上 | 啟動前端 |

確認版本：

```powershell
git --version
docker --version
java -version
mvn -version
node -v
npm -v
```

## 第一次設定

在專案根目錄執行：

```powershell
Copy-Item .env.example .env
```

如果是 Git Bash，也可以用：

```bash
cp .env.example .env
```

請確認 `.env` 裡至少有這些設定：

```env
MYSQL_HOST=localhost
MYSQL_PORT=3307
MYSQL_DATABASE=lucky_star_casino
MYSQL_USER=lucky_user
MYSQL_PASSWORD=lucky_password

REDIS_HOST=localhost
REDIS_PORT=6379

KAFKA_BOOTSTRAP_SERVERS=localhost:9092

MEMBER_SERVICE_URL=http://localhost:8081
CORS_ALLOWED_ORIGINS=http://localhost:5173,http://localhost:5174

JWT_SECRET=lucky-star-casino-jwt-secret-key-dev-only-change-in-production
INTERNAL_SECRET=lucky-star-internal-secret-dev-only
INTERNAL_SERVICE_SECRET=lucky-star-internal-secret-dev-only
```

新手提醒：`.env.example` 是範本，真正啟動時通常讀 `.env`。如果只改 `.env.example`，正在啟動的服務不會吃到設定。

## 啟動順序

請照順序啟動，避免後端找不到資料庫或 Redis。

### 1. 啟動 Docker 基礎服務

在專案根目錄執行：

```powershell
docker compose up -d
docker compose ps
```

需要確認以下服務都有正常執行：

- MySQL：`localhost:3307`
- PostgreSQL：`localhost:5433`
- Redis：`localhost:6379`
- Kafka：`localhost:9092`
- Kafka UI：`http://localhost:8085`

### 2. 啟動 Member Service

```powershell
cd backend/member-service
mvn spring-boot:run
```

成功後測試：

```powershell
Invoke-WebRequest http://localhost:8081/actuator/health
```

看到 `status: UP` 代表成功。

### 3. 啟動 Gateway Service

開新的終端機，回到專案根目錄後執行：

```powershell
cd backend/gateway-service
mvn spring-boot:run
```

成功後測試：

```powershell
Invoke-WebRequest http://localhost:8080/actuator/health
```

看到 `status: UP` 代表成功。

### 4. 啟動 Frontend

開新的終端機：

```powershell
cd frontend
npm install
npm run dev
```

Vite 預設會開：

```text
http://localhost:5173
```

如果 `5173` 被佔用，Vite 可能自動改成：

```text
http://localhost:5174
```

這兩個 origin 都已經放進 `CORS_ALLOWED_ORIGINS`。

## 前端串接設定

前端 Axios 設定在：

```text
frontend/src/services/api.js
```

目前預設 API base URL 是：

```js
import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080'
```

也就是說，如果沒有另外建立 `frontend/.env.development`，前端會自動打 Gateway：

```text
http://localhost:8080
```

如果同學想明確設定，也可以新增：

```text
frontend/.env.development
```

內容：

```env
VITE_API_BASE_URL=http://localhost:8080
```

注意：Vite 的環境變數一定要以 `VITE_` 開頭，前端程式才讀得到。

## 會員 API 串接流程

會員 API 封裝在：

```text
frontend/src/services/memberApi.js
```

Redux auth 狀態在：

```text
frontend/src/store/slices/authSlice.js
```

目前流程是：

1. 註冊：`POST /api/v1/auth/register`
2. 登入：`POST /api/v1/auth/login`
3. 登入成功後取得 JWT token
4. 用 token 呼叫：`GET /api/v1/player/profile`
5. 前端把後端欄位轉成畫面需要的格式

後端 profile 欄位：

```json
{
  "playerId": 1,
  "username": "alex",
  "nickname": "Alex",
  "avatar": "",
  "role": "PLAYER",
  "createdAt": "2026-05-28T..."
}
```

前端轉換後使用：

```js
{
  id: '1',
  username: 'alex',
  nickname: 'Alex',
  avatarUrl: '',
  role: 'PLAYER',
  createdAt: '2026-05-28T...'
}
```

## 用指令測試會員 API

以下指令可以不用開前端，直接確認後端和 Gateway 是否正常。

### 註冊

```powershell
$body = @{
  username = "testuser001"
  email = "testuser001@example.com"
  password = "Passw0rd!"
  nickname = "測試玩家"
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "http://localhost:8080/api/v1/auth/register" `
  -ContentType "application/json; charset=utf-8" `
  -Body $body
```

### 登入並取得 token

```powershell
$loginBody = @{
  username = "testuser001"
  password = "Passw0rd!"
} | ConvertTo-Json

$login = Invoke-RestMethod `
  -Method Post `
  -Uri "http://localhost:8080/api/v1/auth/login" `
  -ContentType "application/json; charset=utf-8" `
  -Body $loginBody

$token = $login.data.accessToken
$token
```

### 用 token 取得 profile

```powershell
Invoke-RestMethod `
  -Method Get `
  -Uri "http://localhost:8080/api/v1/player/profile" `
  -Headers @{ Authorization = "Bearer $token" }
```

## 常見問題

### 1. 前端畫面說 Network Error

可能原因：

- Gateway 沒有啟動
- 前端 API base URL 設錯
- 瀏覽器被 CORS 擋住

檢查方式：

```powershell
Invoke-WebRequest http://localhost:8080/actuator/health
```

如果 Gateway 沒回應，先啟動 `backend/gateway-service`。

### 2. API 測試成功，但瀏覽器失敗

這通常是 CORS 問題。

請確認 `.env`：

```env
CORS_ALLOWED_ORIGINS=http://localhost:5173,http://localhost:5174
```

改完 `.env` 後要重啟 Gateway，因為 Spring Boot 啟動時才會讀環境變數。

### 3. Member Service 啟動失敗，出現 schema validation 錯誤

可能是資料庫 volume 裡還是舊 schema。

如果本機資料可以清掉，可以重建 Docker volume：

```powershell
docker compose down -v
docker compose up -d
```

注意：`down -v` 會刪除本機資料庫資料，新手執行前要確認沒有重要資料。

### 4. 401 Unauthorized

可能原因：

- 沒有帶 JWT token
- token 過期
- localStorage 裡的舊 token 已失效

處理方式：

1. 前端登出再重新登入。
2. 或在瀏覽器 DevTools 清掉 localStorage 的 `accessToken`、`refreshToken`。

### 5. 5173 被佔用

Vite 可能會自動改用 `5174`。

這是正常的，只要 `.env` 的 CORS 有包含：

```env
CORS_ALLOWED_ORIGINS=http://localhost:5173,http://localhost:5174
```

就可以正常串接。

## 給 AI 的快速上下文

如果同學要請另一台電腦的 AI 幫忙串接或 debug，可以先貼這段：

```text
這是 Lucky Star Casino monorepo。

本機前後端串接架構：
- Frontend: React/Vite, folder frontend, dev URL usually http://localhost:5173 or 5174
- Gateway Service: Spring Cloud Gateway, backend/gateway-service, port 8080
- Member Service: Spring Boot, backend/member-service, port 8081
- Frontend should call Gateway, not Member Service directly.
- API base URL should be http://localhost:8080

會員 API：
- POST /api/v1/auth/register
- POST /api/v1/auth/login
- GET /api/v1/player/profile with Authorization: Bearer <accessToken>
- PUT /api/v1/player/profile with Authorization: Bearer <accessToken>

Important files:
- frontend/src/services/api.js
- frontend/src/services/memberApi.js
- frontend/src/store/slices/authSlice.js
- frontend/src/App.jsx
- backend/gateway-service/src/main/resources/application.yml
- backend/member-service/src/main/resources/application.yml
- .env and .env.example

Local env must include:
- MEMBER_SERVICE_URL=http://localhost:8081
- CORS_ALLOWED_ORIGINS=http://localhost:5173,http://localhost:5174
- JWT_SECRET=...
- INTERNAL_SECRET=...
- INTERNAL_SERVICE_SECRET=...

Startup order:
1. docker compose up -d
2. backend/member-service: mvn spring-boot:run
3. backend/gateway-service: mvn spring-boot:run
4. frontend: npm install && npm run dev

Common issue:
If Postman/curl works but browser fails, check CORS and restart Gateway.
```

## 最短檢查清單

同學測試前確認：

- [ ] Docker Desktop 已啟動
- [ ] `.env.example` 已複製成 `.env`
- [ ] `docker compose ps` 服務正常
- [ ] `http://localhost:8081/actuator/health` 是 UP
- [ ] `http://localhost:8080/actuator/health` 是 UP
- [ ] 前端開在 `http://localhost:5173` 或 `http://localhost:5174`
- [ ] 可以註冊新帳號
- [ ] 可以登入
- [ ] 重新整理後仍能取得會員 profile
