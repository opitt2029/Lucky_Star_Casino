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
| frontend（React + Vite） | 5173 | http://localhost:5173 |

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

`.env` 已內建一組可直接用於本機開發的預設值（含開發用 `JWT_SECRET`、`INTERNAL_SECRET`）。
**本機開發不需修改即可啟動**；正式環境務必更換所有 `*_SECRET`。

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

## 7. 目前已知狀況（2026-06-10）

> 這段反映**當前開發進度**，會隨專案演進變動；完整逐項進度見 [AUDIT_REPORT.md](AUDIT_REPORT.md) 附錄 A 與 [CHANGELOG.md](CHANGELOG.md)。

- ✅ **可正常運作**：基礎設施、member-service、gateway-service、wallet-service（餘額/扣款/入帳）、前端登入/註冊主線。
- ✅ **game-service 已實作**：老虎機（`POST /api/v1/game/slot/spin`）與百家樂（`/api/v1/game/baccarat/bet` → `/{roundId}/result`）；下注會呼叫 wallet-service 真實扣款/派彩，需 wallet + Redis + Kafka 同時在線。前端遊戲頁已串真實 API。
- ✅ **rank-service 已實作排行榜**（`/api/v1/rank/*`）；惟前端排行榜目前仍走 mock、尚未串接，故可不啟動。
- ✅ **簽到/新手禮入帳已串通**（ADR-002）：member 發 `wallet.credit.request` 指令 → wallet 消費入帳。需 Kafka 正常運作；wallet-service 須啟動才會實際加餘額。
- ⚪ **admin / notification 仍未實作**：admin-service 為空殼（無業務 API）；notification-service 尚未建立。屬正常現況，非部署錯誤。

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
