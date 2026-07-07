# Secret 管理與輪替 SOP

> 建立日期：2026-07-07（Secret 管理施工，Phase 7）
> 適用範圍：`.env` 內所有密鑰類環境變數、CI 測試密鑰策略。
> 相關文件：[DEPLOY.md](../../DEPLOY.md) §2（初次建立 `.env`）、[.env.example](../../.env.example)

---

## ⚠️ 一次性公告：既有本機 `.env` 值視同已洩漏

2026-07-07 之前，`.env.example` 內含**可直接使用的密鑰值**（`JWT_SECRET`、`INTERNAL_SECRET`、DB 密碼等）且進了版控——任何拿得到 repo 的人都知道這些值。因此：

- **所有在本日期前建立的本機 `.env`，其密鑰一律視同已洩漏。**
- 請每位組員依本文件 §3 的輪替步驟，**重新生成一輪**自己本機的所有密鑰。
- `.env.example` 現在只放 `CHANGE_ME` 佔位符；佔位符刻意短於 HS256 的 32 bytes 下限，直接拿去啟動會 fail-fast（`WeakKeyException`），不會靜默用弱密鑰跑起來。

---

## 1. 生成隨機密鑰

```bash
# Git Bash / macOS / Linux
openssl rand -base64 48
```

```powershell
# Windows PowerShell（5.1 亦可用）
$rng = [Security.Cryptography.RNGCryptoServiceProvider]::new()
$b = New-Object byte[] 48; $rng.GetBytes($b); [Convert]::ToBase64String($b)
```

每個變數用**各自獨立**的生成值；唯一例外是 `INTERNAL_SECRET` 與 `INTERNAL_SERVICE_SECRET` 要填同一個值（兩個名字是歷史包袱，不同服務讀不同名）。

---

## 2. 密鑰清單：用途、誰在用、改了會怎樣

| 變數 | 用途 | 誰在用 | 輪替影響面 |
|---|---|---|---|
| `JWT_SECRET` | 玩家 JWT 簽發/驗證（HS256） | member-service 簽發；gateway-service、notification-service（STOMP CONNECT）驗證 | **全部玩家 access/refresh token 立即失效，所有人需重新登入**；member / gateway / notification 三個服務要同時換值、同時重啟，否則新舊 token 互驗不過 |
| `ADMIN_JWT_SECRET` | 後台 JWT 簽發/驗證，與玩家 JWT 分離（T-050，AGENTS.md 雷區 21） | admin-service（gateway 不驗 admin token，`/admin/` 在 jwt.whitelist） | 所有後台登入態失效，管理員重新登入；只需重啟 admin-service |
| `ADMIN_SEED_USERNAME` / `ADMIN_SEED_PASSWORD` | 首次啟動播種預設管理員 | admin-service（`AdminUserSeeder`，僅資料庫沒有該帳號時生效） | 播種後改這兩個變數**不會**改到既有帳號；要換密碼請直接在後台改或更新 `admin_users` 資料 |
| `INTERNAL_SECRET` / `INTERNAL_SERVICE_SECRET` | 服務間內部呼叫（`X-Internal-Secret` header → `InternalSecretFilter`） | **7 個服務全部**（發內部呼叫或收內部呼叫至少佔一邊） | **7 個服務要同步換值、同步重啟**；只重啟一半會出現內部呼叫 401/403（例：game 打 wallet 扣款失敗、admin 打 member 停用失敗） |
| `MYSQL_ROOT_PASSWORD` / `MYSQL_PASSWORD` | MySQL root / 應用帳號密碼 | MySQL 容器、member / wallet / admin-service | 容器**首次建立 volume 時**才拿這些值建帳號；之後改 `.env` 只會讓服務連不上。正規做法見 §3.3 |
| `POSTGRES_PASSWORD` | PostgreSQL 應用帳號密碼 | PostgreSQL 容器、wallet / game / rank / admin-service | 同上，見 §3.3 |
| `KAFKA_CLUSTER_ID` | KRaft 叢集 ID | Kafka 容器 | **不是密鑰**，不需輪替；換了反而會跟既有 volume 不一致導致 Kafka 起不來 |

不在密鑰範圍（純設定，照舊）：各 `*_PORT`、`*_HOST`、`*_URL`、`CORS_ALLOWED_ORIGINS`、`JPA_DDL_AUTO`、`LOG_LEVEL_*`、`JWT_*_EXPIRY_MS`、`VITE_*`。

---

## 3. 輪替步驟（本機 docker compose 環境）

### 3.1 JWT 類（`JWT_SECRET` / `ADMIN_JWT_SECRET`）

1. 依 §1 生成新值，更新 `.env`。
2. 重啟讀取該值的服務：
   ```bash
   # JWT_SECRET：三個服務一起
   docker compose up -d --force-recreate gateway-service member-service notification-service
   # ADMIN_JWT_SECRET：只有 admin
   docker compose up -d --force-recreate admin-service
   ```
3. 驗證：舊 token 打 API 應得 401；重新登入後正常。

### 3.2 內部密鑰（`INTERNAL_SECRET` + `INTERNAL_SERVICE_SECRET`）

1. 生成**一個**新值，同時更新 `.env` 的兩個變數。
2. **7 個後端服務全部重啟**（不同步重啟＝內部呼叫失敗）：
   ```bash
   docker compose up -d --force-recreate gateway-service member-service wallet-service game-service rank-service admin-service notification-service
   ```
3. 驗證：跑一局老虎機（game→wallet 內部扣款/派彩）與後台停用玩家（admin→member）都成功。

### 3.3 資料庫密碼（`MYSQL_*` / `POSTGRES_PASSWORD`）

密碼存在 DB 裡，不是只改環境變數就好。兩條路：

- **本機資料可拋棄（最簡單）**：更新 `.env` → `docker compose down -v` → `docker compose up -d --build`（volume 重建時用新密碼重新初始化）。
- **要保留資料**：先進容器改 DB 端密碼，再更新 `.env`、重啟依賴服務：
  ```bash
  docker exec -it lucky-star-mysql mysql -u root -p
  #   ALTER USER 'lucky_user'@'%' IDENTIFIED BY '<新值>'; ALTER USER 'root'@'%' IDENTIFIED BY '<新值>';
  docker exec -it lucky-star-postgres psql -U lucky_user -d lucky_star_casino
  #   ALTER USER lucky_user WITH PASSWORD '<新值>';
  docker compose up -d --force-recreate member-service wallet-service game-service rank-service admin-service
  ```

---

## 4. CI 測試密鑰策略（為什麼不用 GitHub Secrets）

- 本專案走 **fork/PR 工作流**（CONTRIBUTING.md）：fork 來的 PR 基於安全設計**拿不到 repo secrets**，若 CI 依賴 GitHub Secrets，所有 fork PR 會直接紅燈。
- 測試密鑰只需要活在單一 run 內、無持久價值，因此 `.github/workflows/ci.yml` 的 `backend-test` job 在第一個 step 用 `openssl rand` **於 run 內即時生成**並寫入 `$GITHUB_ENV`。
- 附帶效果：repo 裡（含 workflow 檔）不存在任何寫死的可用密鑰。

---

## 5. 原則

- 密鑰**永不進版控**：`.env` 已在 `.gitignore`；`.env.example` 只放 `CHANGE_ME` 佔位符。commit 前發現貼了真值，視同洩漏、立即輪替。
- 一個值洩漏只輪替一個值——這就是玩家/後台 JWT 分離（雷區 21）與各變數獨立生成的原因。
- 正式環境（未來若有）另用部署平台的 secret store 注入，不落地 `.env` 檔。
