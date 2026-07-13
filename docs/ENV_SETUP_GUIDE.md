# 幸運星幣城 — 本機環境從零到一完整教學

> 適用對象：初次加入專案的組員，從安裝工具到服務全部跑起來。  
> 預估時間：約 60～90 分鐘（視網路速度而定）  
> 最後校對：2026-07-13

---

## 目錄

1. [你需要安裝哪些工具](#1-你需要安裝哪些工具)
2. [取得專案程式碼](#2-取得專案程式碼)
3. [設定環境變數](#3-設定環境變數)
4. [啟動所有基礎服務（Docker）](#4-啟動所有基礎服務docker)
5. [確認各服務正常運作](#5-確認各服務正常運作)
6. [初始化後端 Spring Boot 專案](#6-初始化後端-spring-boot-專案)
7. [初始化前端 React 專案](#7-初始化前端-react-專案)
8. [常見問題排除](#8-常見問題排除)

---

## 1. 你需要安裝哪些工具

請依序安裝下列工具，**版本不符可能造成專案無法啟動**。

### 必裝工具清單

| 工具 | 版本需求 | 用途 | 下載位置 |
|------|---------|------|---------|
| **Git** | 2.x 以上 | 拉取程式碼、版本控管 | https://git-scm.com |
| **Docker Desktop** | 最新版 | 一鍵啟動資料庫、Kafka 等服務 | https://www.docker.com/products/docker-desktop |
| **Java (JDK)** | **21** | 執行 Spring Boot 後端 | https://adoptium.net（選 Temurin 21） |
| **Node.js** | **20 LTS 以上** | 執行 React 前端 | https://nodejs.org |
| **IntelliJ IDEA** | 社群版即可 | 開發 Java 後端 | https://www.jetbrains.com/idea |
| **VS Code** | 最新版 | 開發前端（選配，或統一用 IntelliJ） | https://code.visualstudio.com |

### 安裝後驗證

開啟終端機（Windows 用 PowerShell 或 Git Bash），逐一執行下列指令確認版本：

```bash
git --version       # 應顯示 git version 2.x.x
docker --version    # 應顯示 Docker version xx.x
java -version       # 應顯示 openjdk version "21"
node --version      # 應顯示 v20.x.x 或以上
npm --version       # 應顯示 10.x.x 或以上
```

> **常見問題**：如果輸入指令後出現「找不到命令」，代表該工具沒有加入系統 PATH。  
> 解法：重新安裝時勾選「Add to PATH」選項，或重新開啟終端機再試。

---

## 2. 取得專案程式碼

### 2.1 Clone 專案

```bash
git clone https://github.com/opitt2029/Lucky_Star_Casino.git
cd Lucky_Star_Casino
```

> 實際開發走 **fork / PR** 流程（見 `CONTRIBUTING.md`）：先 fork 到自己的帳號再 clone。

### 2.2 切換到正確分支

```bash
# 查看所有遠端分支
git branch -a

# 切換到開發分支（通常是 develop）
git checkout develop

# 確認你目前在哪個分支
git branch
```

> **分支說明**：
> - `main` — 正式版本，不直接在此開發
> - `develop` — 開發整合分支，PR 合入這裡
> - `feature/你的名字-功能名稱` — 你的個人開發分支

### 2.3 建立自己的功能分支

```bash
# 從 develop 建立你的功能分支
git checkout -b feature/Alex-T002-docker-setup

# 推送到遠端（第一次需要 -u）
git push -u origin feature/Alex-T002-docker-setup
```

---

## 3. 設定環境變數

環境變數用來存放資料庫密碼、Port 號等設定，**不會上傳到 Git**（已加入 .gitignore）。

### 3.1 複製範本檔案

```bash
# 在專案根目錄執行
cp .env.example .env
```

> **Windows 用 PowerShell 的話**：
> ```powershell
> Copy-Item .env.example .env
> ```

### 3.2 ⚠️ 把所有 `CHANGE_ME` 換成自己生成的隨機值（必做）

`.env.example` 裡所有值是 `CHANGE_ME` 的變數都是**佔位符**，複製後**必須換掉**——
它們的長度不足 HS256 的 32 bytes 下限，直接啟動會 fail-fast（`WeakKeyException`）。
這是刻意設計，避免有人拿範本值上線。

需要自己生成的（每個都用**不同**的值，除了最後兩個要相同）：

```bash
# Git Bash / macOS / Linux 都可以這樣生成
openssl rand -base64 48
```

| 變數 | 用途 | 備註 |
|---|---|---|
| `MYSQL_ROOT_PASSWORD` / `MYSQL_PASSWORD` | MySQL 密碼 | |
| `POSTGRES_PASSWORD` | PostgreSQL 密碼 | |
| `JWT_SECRET` | **玩家** JWT 簽章密鑰 | 缺了 gateway/member 啟動失敗 |
| `ADMIN_JWT_SECRET` | **後台** JWT 簽章密鑰 | 與玩家 JWT 是**兩套**，不可混用 |
| `INTERNAL_SECRET` + `INTERNAL_SERVICE_SECRET` | 服務間內部呼叫密鑰 | **兩者填同一個值**（不同服務讀不同變數名） |
| `ADMIN_SEED_PASSWORD` | 後台初始管理員密碼 | |

`CORS_ALLOWED_ORIGINS` 有預設值但**不可為空**，本機保持
`http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173` 即可
（5173＝玩家端、5174＝管理後台）。

Port 預設值（`.env.example` 已填好，通常不用改）：MySQL `3307`、PostgreSQL `5433`、
Redis `6379`、Kafka `9092`、Kafka UI `8085`、gateway `8080`、member `8081`、wallet `8082`、
game `8083`、rank `8084`、admin `8086`、notification `8087`。

> **什麼是 Port？** 可以把 Port 想成「門號」，每個服務都需要一個獨立的門號。  
> 例如 `MYSQL_PORT=3307` 代表 MySQL 開在電腦的 3307 號門，可用任何 DB 工具連到 `localhost:3307`。
> MySQL/PostgreSQL 刻意用 3307/5433 而非標準 3306/5432，避開你本機可能已裝的同名服務。

> 密鑰輪替與外洩處理 SOP：[`security/secret-rotation.md`](security/secret-rotation.md)。

---

## 4. 啟動基礎設施 + 後端服務（Docker）

本專案使用 **Docker Compose** 一次啟動所有基礎設施（資料庫、Kafka 等）**與全部 7 個後端服務**（後端已容器化，見 DEPLOY.md §3）。

### 4.1 確認 Docker Desktop 已啟動

打開 Docker Desktop，等待左下角出現綠色圓點（Engine running）再繼續。

### 4.2 啟動服務

```bash
# 在專案根目錄執行（有 docker-compose.yml 的地方）
docker compose up -d --build
```

> `-d` 代表「背景執行」（detached），這樣終端機不會被佔用。  
> `--build` 會在容器裡編譯後端（第一次、或改了後端程式碼後都要加）。  
> 第一次執行會**自動下載映像檔並建置 7 個後端 image**，視網路與機器速度可能需要 10～20 分鐘。

### 4.3 查看啟動狀態

```bash
docker compose ps
```

正常狀態下，所有服務應顯示 `healthy` 或 `running`：

```
NAME                              STATUS
lucky-star-mysql                  Up (healthy)
lucky-star-postgres               Up (healthy)
lucky-star-redis                  Up (healthy)
lucky-star-kafka                  Up (healthy)
lucky-star-kafka-ui               Up
lucky-star-gateway-service        Up (healthy)
...（member/wallet/game/rank/admin/notification 共 7 個後端皆應 healthy）
lucky-star-kafka-init             Exited (0)   ← 這是正常的，初始化完就會退出
```

> **kafka-init 顯示 Exited (0) 是正常的**，代表 Kafka Topics 已成功建立完畢。

### 4.4 停止服務

```bash
# 停止但保留資料
docker compose stop

# 停止並刪除容器（資料保留在 volume）
docker compose down

# 停止並刪除容器 + 資料（完全重置）
docker compose down -v
```

---

## 5. 確認各服務正常運作

### 5.1 Kafka UI（瀏覽器介面）

打開瀏覽器，前往：`http://localhost:8085`

你應該看到 Kafka UI 介面，點選左側 **Topics** 可以看到 **8 個業務 topic + 5 個 DLT**：

| Topic 名稱 | 用途 |
|-----------|------|
| `member.registered` | 新會員註冊 |
| `wallet.credit.request` | 入帳**指令**（member/admin/game 發，wallet 消費） |
| `wallet.credit` | 入帳**事件**（wallet 入帳完成後才發） |
| `wallet.debit` | 扣款事件 |
| `friend.relationship.updated` | 好友清單變動 |
| `game.result` | 遊戲結果 |
| `rank.update` | 排行榜更新 |
| `notification.push` | 推播通知 |

> `.DLT` 結尾的是 Dead Letter Topic（消費失敗的訊息會被丟進去），共 5 個。
> `wallet.credit` 是「事件」、`wallet.credit.request` 才是「指令」——這個分別很重要，見 ADR-002。

### 5.2 資料庫連線測試

使用任何 DB 工具（推薦：**DBeaver** 免費版）測試連線：

**MySQL 連線設定：**
```
Host:     localhost
Port:     3307
Database: lucky_star_casino
Username: lucky_user
Password: lucky_password
```

**PostgreSQL 連線設定：**
```
Host:     localhost
Port:     5433
Database: lucky_star_casino
Username: lucky_user
Password: lucky_password
```

> 帳號密碼用你在 `.env` 裡自己生成的 `MYSQL_USER`/`MYSQL_PASSWORD`、
> `POSTGRES_USER`/`POSTGRES_PASSWORD`。

**Redis 連線測試（用終端機）：**
```bash
# 進入 Redis 容器（容器名見 docker-compose.yml，不是自動生成的那種）
docker exec -it lucky-star-redis redis-cli

# 測試是否正常（應回傳 PONG）
ping
```

---

## 6. 初始化後端 Spring Boot 專案

### 6.1 用 IntelliJ 開啟專案

1. 打開 IntelliJ IDEA
2. 選擇 **File → Open**
3. 選取 `backend/` 資料夾
4. 等待 Maven 自動下載依賴（右下角有進度條）

### 6.2 專案結構說明

```
backend/
├── gateway-service/       ← API 閘道，所有請求都先經過這裡
├── member-service/        ← 會員註冊、登入、JWT、好友、簽到
├── wallet-service/        ← 星幣錢包、帳務、鑽石、商城、加值（雙資料源）
├── game-service/          ← RNG 遊戲引擎（老虎機、百家樂、捕魚機）
├── rank-service/          ← 排行榜（Redis ZSet）
├── admin-service/         ← 後台管理（雙資料源，獨立 JWT secret）
└── notification-service/  ← WebSocket 推播（無 DB）
```

每個 Service 都是**獨立的 Spring Boot 專案**，可以個別啟動。

### 6.3 各 Service 的資料庫連線（已寫好，不用自己設）

每個 service 的 `src/main/resources/application.yml` 已經寫好連線，值從 `.env` 的環境變數注入。
**不同服務連的資料庫不一樣**，別套用單一假設：

| Service | 資料庫 |
|---|---|
| member | MySQL（`jdbc:mysql://...:3307`） |
| rank / game | PostgreSQL |
| **wallet / admin** | **雙資料源**（PostgreSQL + MySQL，ADR-001） |
| gateway / notification | 無 DB |

> ⚠️ wallet-service 的 `spring.jpa.*` **無效**：它有兩個手動建立的 `EntityManagerFactory`
> （見 `config/DataSourceConfig.java`）。詳見 [`dual-datasource-guide.md`](dual-datasource-guide.md)。

### 6.4 啟動單一 Service（IDE 除錯用；日常啟動走 docker compose）

後端 7 服務平常由 `docker compose up -d --build` 一次啟動（§4），**本節只在你要用 IDE 除錯單一服務時**才需要。

在 IntelliJ 中，找到對應 Service 的 `Application.java`（主程式），右鍵 → **Run**。

或用終端機（注意：專案**沒有 mvnw**，要用系統安裝的 `mvn`，且需先把 `.env` 載入 shell）：

```bash
cd backend/member-service
mvn spring-boot:run
```

成功啟動時，終端機會出現：
```
Started MemberServiceApplication in x.xxx seconds
```

---

## 7. 初始化前端 React 專案

### 7.1 安裝依賴套件

```bash
# 進入前端資料夾
cd frontend

# 安裝所有套件（package.json 裡面列的）
npm install
```

> 這一步會下載所有前端套件到 `node_modules/` 資料夾，第一次需要幾分鐘。

### 7.2 啟動開發伺服器

```bash
npm run dev
```

成功後，打開瀏覽器前往 `http://localhost:5173`

### 7.3 前端資料夾結構（建議遵循）

```
frontend/
├── src/
│   ├── components/     ← 可重用的 UI 元件
│   ├── pages/          ← 頁面（登入、遊戲大廳、排行榜...）
│   ├── store/          ← Redux 狀態管理
│   │   └── slices/     ← authSlice, walletSlice, gameSlice...
│   ├── hooks/          ← 自訂 Hook（useWebSocket 等）
│   ├── services/       ← Axios API 呼叫封裝
│   └── App.jsx         ← 主程式進入點
├── .env.development    ← 開發環境的 API 網址設定
└── package.json
```

### 7.4 設定 API 位置與「真後端 / mock」開關

建立 `frontend/.env.development` 檔案：

```env
VITE_API_BASE_URL=http://localhost:8080
VITE_WS_URL=ws://localhost:8080/ws
VITE_USE_MOCK_API=false
```

> `VITE_` 開頭的環境變數才能在 React 程式碼中讀取到。

⚠️ **最容易困惑的一點**：前端**預設走 mock**（判斷式是 `VITE_USE_MOCK_API !== 'false'`，
所以「沒設」＝走 mock）。要真的打後端，必須明確設成字串 `false`。
如果你「後端明明起來了、前端卻好像沒在打 API」，先檢查這個變數。

### 7.5 管理後台前端（`frontend-admin/`，選配）

管理後台是**另一個獨立的 Vite 專案**，開在 5174：

```bash
cd frontend-admin
npm install
npm run dev     # http://localhost:5174
```

後台的 JWT 用 `ADMIN_JWT_SECRET` 簽發，與玩家 token **不通用**。
dev 模式走 vite proxy（`/admin` → 8080），不用另外碰 CORS 白名單。

---

## 8. 常見問題排除

### Q1: `docker compose up` 卡住或失敗

**可能原因：** Docker Desktop 沒有啟動，或磁碟空間不足。  
**解法：**
```bash
# 重置所有容器重來
docker compose down -v
docker compose up -d
```

---

### Q2: Port 已被佔用（Address already in use）

**可能原因：** 本機已有其他程式使用相同 Port（例如本機安裝了 MySQL 用了 3306）。  
**解法：** 本專案 MySQL 改用 `3307`，PostgreSQL 改用 `5433`，理論上不衝突。  
如果還是衝突，修改 `.env` 的 Port 號即可。

---

### Q3: Java 版本錯誤

**現象：** IntelliJ 顯示 `class file version 65.0`  
**解法：** 確認 IntelliJ 的 JDK 設定為 Java 21  
→ **File → Project Structure → SDK → 選 Java 21**

---

### Q4: Kafka Topics 沒有出現

**解法：**
```bash
# 查看 kafka-init 的日誌
docker compose logs kafka-init

# 手動重新執行初始化
docker compose restart kafka-init
```

---

### Q5: npm install 出現 ENOENT 錯誤

**可能原因：** 不在正確資料夾。  
**解法：**
```bash
# 確認你在 frontend/ 資料夾
pwd       # 應顯示 .../Lucky-Strat-Casino/frontend
ls        # 應看到 package.json
```

---

### Q6: 後端啟動就掛，錯誤訊息提到 `WeakKeyException` 或 `JWT_SECRET`

**原因：** `.env` 裡的密鑰還是 `CHANGE_ME`（長度不足 32 bytes），或根本沒載入。  
**解法：** 回到 §3.2，用 `openssl rand -base64 48` 重新生成。這是 fail-fast 的刻意設計，不是 bug。

---

### Q7: 前端畫面有反應，但後端 log 完全沒有請求進來

**原因：** 前端在跑 mock（見 §7.4）。  
**解法：** `frontend/.env.development` 加 `VITE_USE_MOCK_API=false`，重啟 `npm run dev`。

---

## 完整啟動順序總結

```
1. 啟動 Docker Desktop
2. cd Lucky_Star_Casino
3. cp .env.example .env   → 把所有 CHANGE_ME 換成 openssl rand -base64 48 生成的值
4. docker compose up -d --build      ← 一次起 infra + 7 個後端服務
5. 等待 docker compose ps 全部顯示 healthy（kafka-init 顯示 Exited(0) 是正常的）
6. cd frontend && npm install && npm run dev
7. 瀏覽器開 http://localhost:5173
```

> 只有要**用 IDE 除錯單一服務**時，才需要自己 `mvn spring-boot:run`（§6.4）——
> 而且要先把 `.env` 載入 shell，否則必填變數缺失會啟動失敗。
> 注意：本專案**沒有 `mvnw`**，請用系統安裝的 `mvn`。

---

> 如果遇到本文件沒有提到的問題，請在 GitHub Issues 或群組頻道提問，附上錯誤訊息截圖。
