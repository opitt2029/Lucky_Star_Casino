# 🚀 Lucky Star Casino — 本機部署 SOP（T-094）

> 目標：新成員照本文件操作，**30 分鐘內**在本機把整套環境（基礎設施 + 後端服務 + 前端）跑起來。
> 適用環境：Windows 11 / macOS / Linux。指令同時提供 **Git Bash / macOS·Linux** 與 **Windows PowerShell** 版本。
> 第一次接觸專案？可搭配更詳細的 [docs/ENV_SETUP_GUIDE.md](docs/ENV_SETUP_GUIDE.md) 一起看。

---

## 0. 前置需求

| 工具 | 版本 | 確認指令 |
|------|------|----------|
| Git | 2.x 以上 | `git --version` |
| Docker Desktop | 最新版（需啟動） | `docker --version` |
| Java JDK | **21**（務必，專案用 Java 21 語法） | `java -version` |
| Maven | 3.9 以上 | `mvn -v` |
| Node.js | **20 LTS 以上** | `node -v` |

> ⚠️ **本專案沒有 Maven Wrapper（`mvnw`）**。請直接用系統安裝的 `mvn`，**不要**用 `./mvnw`（會找不到檔案）。

---

## 1. 架構與 Port 一覽

部署前先知道有哪些東西要跑、各佔哪個 Port：

### 基礎設施（由 Docker 啟動）

| 服務 | Port（本機） | 說明 |
|------|:---:|------|
| MySQL 8.0 | **3307** | 查詢讀庫（members、CQRS） |
| PostgreSQL 16 | **5433** | 帳務核心（wallets、wallet_transactions） |
| Redis 7 | 6379 | JWT 黑名單、Session、排行榜 |
| Zookeeper | 2181 | Kafka 協調 |
| Kafka | 9092 | 事件匯流排 |
| Kafka UI | **8085** | Topic 可視化：http://localhost:8085 |

> MySQL / PostgreSQL 刻意用非預設 Port（3307 / 5433），避免和你本機已安裝的資料庫衝突。

### 後端服務（由 Maven 啟動，每個獨立）

| 服務 | Port | 相依基礎設施 |
|------|:---:|------|
| gateway-service | 8080 | Redis（驗 JWT 黑名單） |
| member-service | 8081 | MySQL + Redis + Kafka |
| wallet-service | 8082 | PostgreSQL + Kafka |
| game-service | 8083 | （骨架，見 §8） |
| rank-service | 8084 | （骨架，見 §8） |
| admin-service | 8086 | （骨架，見 §8） |

### 前端

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

## 3. 啟動基礎設施（Docker 一鍵啟動）

```bash
docker compose up -d
```

這會啟動 MySQL、PostgreSQL、Redis、Zookeeper、Kafka、Kafka UI，並由 `kafka-init` 容器**自動建立所有 Kafka Topic**。

### 確認健康狀態

```bash
docker compose ps
```

- MySQL / PostgreSQL / Redis / Kafka / Zookeeper 應顯示 **healthy** 或 **running**。
- `kafka-init` 顯示 **Exited (0)** 是**正常**的（它建完 Topic 就會結束）。

### 資料庫如何初始化？

- `database/mysql/init.sql` 與 `database/postgres/init.sql` **只在資料 Volume 第一次建立時自動執行**。
- 之後再 `docker compose up` 不會重跑。若你改了 schema 想重新初始化，請見 §7「重置資料庫」。

---

## 4. 啟動後端服務

### ⚠️ 關鍵：先把 `.env` 載入到你的終端機環境變數

本機用 `mvn` 直接跑服務時，**JVM 不會自動讀根目錄的 `.env`**（那是給 Docker 用的）。
而多個服務的 `JWT_SECRET`、`CORS_ALLOWED_ORIGINS`、`INTERNAL_SECRET` 等是「**缺了就啟動失敗**」的必填變數。
所以**每開一個新終端機、跑後端前**，都要先載入 `.env`：

**Git Bash / macOS / Linux：**
```bash
set -a          # 之後 source 進來的變數自動 export
source .env
set +a
```

**Windows PowerShell：**
```powershell
# 讀取 .env，把每一行 KEY=VALUE 設成環境變數（略過註解與空行）
Get-Content .env | Where-Object { $_ -match '^\s*[^#].*=' } | ForEach-Object {
    $name, $value = $_ -split '=', 2
    [Environment]::SetEnvironmentVariable($name.Trim(), $value.Trim(), 'Process')
}
```

### 啟動單一服務

每個服務獨立啟動。從**專案根目錄**用 `-pl`（指定模組）最方便：

```bash
# 範例：啟動 gateway 與 member（各開一個終端機，記得都要先載入 .env）
mvn -pl backend/gateway-service spring-boot:run
mvn -pl backend/member-service spring-boot:run
mvn -pl backend/wallet-service spring-boot:run
```

或進到該服務目錄啟動（效果相同）：
```bash
cd backend/member-service
mvn spring-boot:run
```

### 建議的啟動順序

基礎設施（§3）必須先 healthy，再依下列順序啟動後端，最後啟前端：

```
docker compose（infra）→ member-service → wallet-service → gateway-service → 前端
```

> `JWT_SECRET` 在 **member-service 與 gateway-service 必須完全一致**（gateway 驗證 member 簽發的 token），用同一份 `.env` 即可保證一致。

---

## 5. 啟動前端

```bash
cd frontend
npm install        # 第一次才需要
npm run dev
```

瀏覽器開啟 **http://localhost:5173**。

> 前端透過 Gateway（8080）呼叫後端 API；`.env` 的 `CORS_ALLOWED_ORIGINS` 已允許 `http://localhost:5173`。

---

## 6. 冒煙測試（確認真的跑起來）

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

## 7. 常見問題（Troubleshooting）

| 症狀 | 原因 | 解法 |
|------|------|------|
| 服務啟動報 `JWT_SECRET is required` 之類 | 沒先載入 `.env` 到 shell | 回 §4 執行載入指令，**同一個終端機**再跑 `mvn` |
| `./mvnw: No such file or directory` | 專案沒有 mvnw | 改用 `mvn`（見 §0） |
| Port 被占用（3307 / 5433 / 8080…） | 本機已有程式佔用 | 改 `.env` 對應 Port，或關掉佔用程式 |
| 啟動報 schema `validate` 失敗 | `JPA_DDL_AUTO=validate` 但表結構對不上 | 確認 init.sql 有正確執行；或見下方「重置資料庫」 |
| 改了 init.sql 但沒生效 | init.sql 只在 Volume 首次建立時跑 | 重置資料庫（見下） |

### 重置資料庫（清空所有資料，重跑 init.sql）

```bash
docker compose down -v     # -v 會刪除 Volume（資料全清）
docker compose up -d       # 重新建立 Volume → 自動重跑 init.sql
```

> ⚠️ `-v` 會清掉所有資料庫資料，僅在本機開發使用。

---

## 8. 目前已知狀況（2026-05-29）

> 這段反映**當前開發進度**，會隨專案演進變動；完整逐項進度見 [AUDIT_REPORT.md](AUDIT_REPORT.md) 附錄 A 與 [CHANGELOG.md](CHANGELOG.md)。

- ✅ **可正常運作**：基礎設施、member-service、gateway-service、wallet-service（餘額/扣款/入帳）、前端登入/註冊主線。
- ✅ **簽到/新手禮入帳已串通**（ADR-002）：member 發 `wallet.credit.request` 指令 → wallet 消費入帳。需 Kafka 正常運作；wallet-service 須啟動才會實際加餘額。
- ⚪ **game / rank / admin / notification 為骨架或未建立**：啟動 game/rank/admin 只會起一個空殼服務（無業務 API）；notification-service 尚未建立。這些屬正常現況，非部署錯誤。

---

## 9. 關閉與清理

```bash
# 後端 / 前端：在各自終端機按 Ctrl + C

# 停止基礎設施（保留資料）
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
