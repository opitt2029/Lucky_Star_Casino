# 🚀 Lucky Star Casino — 本機部署 SOP（T-094）

> 目標：新成員照本文件操作，**30 分鐘內**在本機把整套環境（基礎設施 + 後端服務 + 前端）跑起來。
> 適用環境：Windows 11 / macOS / Linux。指令同時提供 **Git Bash / macOS·Linux** 與 **Windows PowerShell** 版本。
> 第一次接觸專案？可搭配更詳細的 [docs/ENV_SETUP_GUIDE.md](docs/ENV_SETUP_GUIDE.md) 一起看。

---

## 0. 前置需求

| 工具 | 版本 | 確認指令 |
|------|------|----------|
| Git | 2.x 以上 | `git --version` |
| Docker Desktop | 最新版（需啟動、需支援 BuildKit，Docker Desktop 內建預設已開） | `docker --version` |
| Docker Compose | v2.20 以上（`depends_on: condition: service_completed_successfully` 需要） | `docker compose version` |
| Node.js | **20 LTS 以上**（前端仍原生跑） | `node -v` |

> ✅ **後端 7 服務已全面容器化**：不需要在本機另外裝 Java/Maven 才能跑後端——`docker compose up -d --build`
> 內部會用容器裡的 Maven/JDK 21 建置。若你要改後端程式碼，Docker Desktop 本身會處理編譯，仍建議裝 JDK 21
> 供 IDE 語法檢查/單元測試用，但**不是啟動服務的必要條件**。

---

## 1. 架構與 Port 一覽

部署前先知道有哪些東西要跑、各佔哪個 Port：

### 基礎設施 + 後端（全部由 Docker Compose 啟動）

| 服務 | Port（本機） | 說明 |
|------|:---:|------|
| MySQL 8.4 | **3307** | 查詢讀庫（members、CQRS） |
| PostgreSQL 16 | **5433** | 帳務核心（wallets、wallet_transactions） |
| Redis 7 | 6379 | JWT 黑名單、Session、排行榜 |
| Kafka 7.6.1（KRaft） | 9092 | 事件匯流排（KRaft 模式，broker+controller 合一，無 Zookeeper） |
| Kafka UI | **8085** | Topic 可視化：http://localhost:8085 |
| gateway-service | 8080 | Redis（驗 JWT 黑名單）+ 其餘 6 個後端服務 |
| member-service | 8081 | MySQL + Redis + Kafka |
| wallet-service | 8082 | PostgreSQL + MySQL（讀視圖）+ Redis + Kafka |
| game-service | 8083 | PostgreSQL + Redis + Kafka + wallet-service |
| rank-service | 8084 | PostgreSQL + Redis + Kafka |
| admin-service | 8086 | MySQL + PostgreSQL + Redis + Kafka + member-service |
| notification-service | 8087 | Kafka |

> MySQL / PostgreSQL 刻意用非預設 Port（3307 / 5433），避免和你本機已安裝的資料庫衝突。

### 前端（仍原生跑，未容器化）

| 服務 | Port | 網址 |
|------|:---:|------|
| frontend（玩家端，React + Vite） | 5173 | http://localhost:5173 |
| frontend-admin（管理後台，React + Vite） | 5174 | http://localhost:5174 |

---

## 2. 取得程式碼與環境變數

```bash
# 1) 取得專案（已有就跳過）
git clone <repo-url>
cd Lucky_Star_Casino

# 2) 複製環境變數範本
cp .env.example .env
```

**PowerShell 版本：**
```powershell
Copy-Item .env.example .env
```

⚠️ **複製完必須先填密鑰才能啟動**（2026-07-07 起）：`.env.example` 的密鑰值全部是 `CHANGE_ME` 佔位符，
直接啟動會 fail-fast（HS256 密鑰長度不足）。把每個 `CHANGE_ME` 換成自己生成的隨機值：

```bash
# 每個變數各生成一個（INTERNAL_SECRET 與 INTERNAL_SERVICE_SECRET 填同一個值）
openssl rand -base64 48
```

各密鑰的用途、影響面與輪替步驟見 **[docs/security/secret-rotation.md](docs/security/secret-rotation.md)**。

### 第三方登入設定（選用）

Google、LINE、Apple 預設皆為停用，沒有憑證也不影響服務啟動。要啟用時，在 `.env` 填入對應
Client ID／Secret，並將 `*_OAUTH_ENABLED` 改為 `true`。Google 與 LINE 後台的 callback URI 為：

```text
http://localhost:8080/api/v1/auth/oauth2/callback/google
http://localhost:8080/api/v1/auth/oauth2/callback/line
```

Apple Web Login 不接受 `localhost` 或 IP 位址，`APPLE_REDIRECT_URI` 必須使用 Apple Developer
後台已登記的公開 HTTPS 網域，例如：

```text
https://login.example.com/api/v1/auth/oauth2/callback/apple
```

Apple 設定順序為：啟用 Sign in with Apple 的主要 App ID → 建立網站用 Services ID → 登記網域與
Return URL → 建立 Sign in with Apple Key 並下載一次性的 `.p8`。`APPLE_CLIENT_ID` 填 Services ID；
`.p8` 應保存於 repo 外，專案也已忽略所有 `.p8` 檔案。

填好 `APPLE_TEAM_ID`、`APPLE_CLIENT_ID`、`APPLE_KEY_ID`、`APPLE_PRIVATE_KEY_PATH` 後，可產生
最長 180 天有效的 `APPLE_CLIENT_SECRET`：

```bash
node --env-file=.env tools/generate-apple-client-secret.mjs
```

將輸出的 JWT 填入 `.env` 的 `APPLE_CLIENT_SECRET`，並在到期前重新產生。私鑰原文不可填入
`APPLE_CLIENT_SECRET`。正式環境也請把 `OAUTH_PUBLIC_BASE_URL` 與 `OAUTH_FRONTEND_BASE_URL`
改為 HTTPS 網址。
帳戶綁定與一次性登入票據設計詳見 [ADR-011](docs/adr/ADR-011.md)。
若你的 `.env` 是 2026-07-07 前建立的，裡面的密鑰視同已洩漏，請照該文件重生一輪。

---

## 3. 啟動基礎設施 + 後端（Docker 一鍵啟動，全部服務）

```bash
docker compose up -d --build
```

這一行會啟動 MySQL、PostgreSQL、Redis、Kafka（KRaft）、Kafka UI，`kafka-init` 建完 Kafka Topic 後，
再依序建置並啟動 gateway/member/wallet/game/rank/admin/notification 共 7 個後端服務容器——**一次到位，不用再開多個終端機**。

> `--build`：第一次啟動、或你改了後端程式碼後都要加，才會重新建置對應的 image。
> **這個模式沒有熱重載**——改完 code 要重新跑 `docker compose up -d --build <service名稱>`
> （例如 `docker compose up -d --build member-service`）才會套用，Spring Boot 不會自動偵測檔案變化重啟。

### 確認健康狀態

```bash
docker compose ps
```

- 所有服務（含 5 個 infra + 7 個後端）應顯示 **healthy**。
- `kafka-init` 顯示 **Exited (0)** 是**正常**的（它建完 Topic 就會結束）。
- 首次 `--build` 因為要建置 7 個 Java 服務的 image，會比純 infra 啟動久（依機器效能，數分鐘）；之後有 BuildKit
  cache（`/root/.m2` 的 Maven 依賴快取）加持，重建速度會快很多。

查看單一服務的啟動 log：
```bash
docker compose logs -f member-service
```

### 資料庫如何初始化？

- `database/mysql/init.sql` 與 `database/postgres/init.sql` **只在資料 Volume 第一次建立時自動執行**。
- 之後再 `docker compose up` 不會重跑。若你改了 schema 想重新初始化，請見 §6「重置資料庫」。

### 選配：啟動觀測性（Prometheus + Grafana）

壓測（T-090）或想看服務指標時，改用 profile 啟動（預設 `docker compose up` **不會**啟動監控容器，SOP 不變）：

```bash
docker compose --profile observability up -d
```

- Prometheus：http://localhost:9090 （Status → Targets 應看到 7 個服務；後端服務要先啟動才會轉綠）
- Grafana：http://localhost:3000 （匿名 Admin 免登入，內建「Lucky Star — 服務總覽」儀表板：HTTP P99 / 吞吐 / 5xx / Resilience4j 熔斷 / JVM Heap / CPU）
- 各服務指標端點：`http://localhost:808x/actuator/prometheus`
- 設定檔在 `observability/`（Prometheus scrape 仍用 `host.docker.internal`；改成容器服務名屬後續優化，非本次變更範圍）。

---

## 4. 啟動前端

```bash
cd frontend
npm install        # 第一次、或 git pull 後 package.json 新增依賴時都要重跑
npm run dev
```

瀏覽器開啟 **http://localhost:5173**。

> ⚠️ **拉到新前端依賴要重跑 `npm install`**：捕魚機漁場已改用 **PixiJS**（`pixi.js`，見 `frontend/package.json`）。
> 若 `git pull` 後沒重裝，`npm run dev`／`npm run build` 會報 `Rollup failed to resolve import "pixi.js"`——此時 `cd frontend && npm install` 即可。
>
> 前端透過 Gateway（8080）呼叫後端 API；`.env` 的 `CORS_ALLOWED_ORIGINS` 已允許 `http://localhost:5173`。
>
> 前端預設 `VITE_USE_MOCK_API=false`（見 `frontend/.env.development`），會打**真實後端**——所以後端要先起好。若只想看 UI、暫不起後端，可在個人的 `frontend/.env.local`（不進版控）設 `VITE_USE_MOCK_API=true` 改用假資料。

---

## 5. 冒煙測試（確認真的跑起來）

1. **基礎設施**：`docker compose ps` 全部 healthy。
2. **Kafka**：開 http://localhost:8085 ，應看到 `member.registered`、`wallet.debit`、`wallet.credit` 等 Topic。
3. **後端 + 前端串接**：前端開 http://localhost:5173 ，註冊一個帳號 → 登入成功，即代表 gateway → member-service → MySQL/Redis 這條主線正常。
4. **（選用）直接打 API**：透過 Gateway 註冊
   ```bash
   curl -X POST http://localhost:8080/api/v1/auth/register \
     -H "Content-Type: application/json" \
     -d '{"username":"demo01","email":"demo01@example.com","password":"Password1","nickname":"demo"}'
   ```
   回傳 `{"success":true,...}` 即正常。
   > 欄位規則：`username` 3–50 字、`email` 須合法格式、`password` 至少 8 碼且含英文與數字、`nickname` 2–50 字。

---

## 6. 常見問題（Troubleshooting）

| 症狀 | 原因 | 解法 |
|------|------|------|
| 某服務啟動報 `JWT_SECRET is required` 之類 | `.env` 缺該必填變數 | 對照 `.env.example` 補齊 `.env`，`docker compose up -d --build <service>` 重啟該服務 |
| Port 被占用（3307 / 5433 / 8080…） | 本機已有程式佔用 | 改 `.env` 對應 Port，或關掉佔用程式 |
| 啟動報 schema `validate` 失敗 | `JPA_DDL_AUTO=validate` 但表結構對不上 | 確認 init.sql 有正確執行；或見下方「重置資料庫」 |
| 改了 init.sql 但沒生效 | init.sql 只在 Volume 首次建立時跑 | 重置資料庫（見下） |
| `pull` 後服務啟動報 `Schema-validation: missing column/table` | `database/mysql\|postgres/migration/` 新增了檔案，但你的 Volume 是舊的，且**專案沒有 Flyway 自動套用機制**，新 migration 不會自動跑進既有資料庫 | 若不想清資料：手動把新增的 migration 檔案依編號順序跑進對應容器（見下方「手動套用新 migration」）；若不在乎本機資料：直接重置資料庫（見下） |
| `Could not resolve placeholder 'XXX_SECRET'` | 本機 `.env` 落後於 `.env.example`（新服務/新功能加了新的必填變數） | 對照 `.env.example` 補齊 `.env` 缺的變數（`ADMIN_JWT_SECRET` 等），別整份覆蓋掉自己原有設定 |
| 改了後端程式碼，`docker compose up -d` 沒套用 | 沒加 `--build`，容器仍用舊 image | `docker compose up -d --build <service>`（或全部服務都重建：`docker compose up -d --build`） |
| `depends_on ... condition: service_completed_successfully` 報錯/不支援 | Docker Compose 版本太舊（需 v2.20+） | 更新 Docker Desktop |

### 手動套用新 migration（不清資料）

`pull` 後如果某服務啟動失敗，先看 `git log` 有沒有新增 `database/mysql/migration/V*.sql` 或 `database/postgres/migration/V*.sql`，有就手動套：

```bash
# MySQL（容器名稱以 docker compose ps 為準，預設 lucky-star-mysql）
docker exec -i lucky-star-mysql mysql -u root -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE" < database/mysql/migration/V<N>__xxx.sql

# PostgreSQL（預設 lucky-star-postgres）
docker exec -i lucky-star-postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" < database/postgres/migration/V<N>__xxx.sql
```

依版本編號**由小到大依序**跑完所有你本機還沒套過的檔案。跑錯順序或漏跑，之後的 migration 可能因為前置欄位/表不存在而失敗。

### 重置資料庫（清空所有資料，重跑 init.sql）

```bash
docker compose down -v     # -v 會刪除 Volume（資料全清）
docker compose up -d       # 重新建立 Volume → 自動重跑 init.sql
```

> ⚠️ `-v` 會清掉所有資料庫資料，僅在本機開發使用。

---

## 7. 目前已知狀況（2026-07-07）

> 這段反映**當前開發進度**，會隨專案演進變動；完整逐項進度見 [AUDIT_REPORT.md](AUDIT_REPORT.md) 附錄 A 與 [CHANGELOG.md](CHANGELOG.md)（查進度務必以程式碼交叉驗證，見 AGENTS.md §1）。

- ✅ **後端 7 服務全部容器化且可正常運作**：`docker compose up -d --build` 啟動的 5 個基礎設施 + 7 個後端服務均通過 healthcheck；前端登入/註冊主線正常。
- ✅ **game-service 已實作三款遊戲**：老虎機（`POST /api/v1/game/slot/spin`）、百家樂（`/api/v1/game/baccarat/bet` → `/{roundId}/result`）、捕魚機（buy-in + 批次結算，PixiJS 前端，ADR-003/004）；下注均呼叫 wallet-service 真實扣款/派彩。
- ✅ **rank-service 已完成排行榜核心**（T-040~T-044：總榜/週榜重置/每日快照/好友榜，`/api/v1/rank/*`）。
- ✅ **admin-service 已完成後台**（T-050~T-055、T-105~T-106：認證/玩家管理/流通量報表/RTP 監控/異常偵測/GM 發幣），搭配管理後台前端 `frontend-admin/`（5174）。
- ✅ **notification-service 已完成推播**（T-070~T-073：STOMP `/ws` + JWT 鑑權，消費 `notification.push`/`game.result`/`rank.update`）。
- ✅ **簽到/新手禮入帳已串通**（ADR-002）、**鑽石系統**（T-100~T-107）與**禮品商城**（ADR-006）已完成。

---

## 8. 關閉與清理

```bash
# 前端：終端機按 Ctrl + C

# 停止基礎設施 + 後端（保留資料）
docker compose down

# 停止並清除所有資料（含 Volume）
docker compose down -v
```

---

## 附：相關文件

- [README.md](README.md) — 專案總覽與架構
- [docs/ENV_SETUP_GUIDE.md](docs/ENV_SETUP_GUIDE.md) — 更詳細的初次環境設置教學
- [docs/architecture.md](docs/architecture.md) — 服務邊界、Port、請求流程圖
- [CONTRIBUTING.md](CONTRIBUTING.md) — 分支規範與 PR 流程
