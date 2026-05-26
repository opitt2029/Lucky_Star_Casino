# 幸運星幣城 — 本機環境從零到一完整教學

> 適用對象：初次加入專案的組員，從安裝工具到服務全部跑起來。  
> 預估時間：約 60～90 分鐘（視網路速度而定）

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
# 將專案下載到你的電腦（請替換成實際的 GitHub 網址）
git clone https://github.com/你的組織/Lucky-Strat-Casino.git

# 進入專案資料夾
cd Lucky-Strat-Casino
```

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

### 3.2 確認 .env 內容

用文字編輯器打開 `.env`，內容如下（已有預設值，**本機開發不需要修改**）：

```env
# 專案名稱
PROJECT_NAME=lucky_star_casino

# MySQL 設定
MYSQL_ROOT_PASSWORD=root
MYSQL_DATABASE=lucky_star_casino
MYSQL_USER=lucky_user
MYSQL_PASSWORD=lucky_password
MYSQL_PORT=3307          # 使用 3307 避免與本機 MySQL 衝突

# PostgreSQL 設定
POSTGRES_DB=lucky_star_casino
POSTGRES_USER=lucky_user
POSTGRES_PASSWORD=lucky_password
POSTGRES_PORT=5433       # 使用 5433 避免與本機 PostgreSQL 衝突

# Redis
REDIS_PORT=6379

# Kafka
KAFKA_PORT=9092
KAFKA_UI_PORT=8085       # 瀏覽器可視化介面

# 前端
FRONTEND_PORT=5173

# 後端服務 Port
GATEWAY_PORT=8080
MEMBER_SERVICE_PORT=8081
WALLET_SERVICE_PORT=8082
GAME_SERVICE_PORT=8083
RANK_SERVICE_PORT=8084
ADMIN_SERVICE_PORT=8086
```

> **什麼是 Port？** 你可以把 Port 想成「門號」，每個服務都需要一個獨立的門號。  
> 例如 `MYSQL_PORT=3307` 代表 MySQL 服務開在電腦的 3307 號門，你可以用任何 DB 工具連到 `localhost:3307`。

---

## 4. 啟動所有基礎服務（Docker）

本專案使用 **Docker Compose** 一次啟動所有基礎設施（資料庫、Kafka 等）。

### 4.1 確認 Docker Desktop 已啟動

打開 Docker Desktop，等待左下角出現綠色圓點（Engine running）再繼續。

### 4.2 啟動服務

```bash
# 在專案根目錄執行（有 docker-compose.yml 的地方）
docker compose up -d
```

> `-d` 代表「背景執行」（detached），這樣終端機不會被佔用。  
> 第一次執行會**自動下載映像檔**，視網路速度可能需要 5～15 分鐘。

### 4.3 查看啟動狀態

```bash
docker compose ps
```

正常狀態下，所有服務應顯示 `healthy` 或 `running`：

```
NAME                STATUS
mysql               Up (healthy)
postgres            Up (healthy)
redis               Up (healthy)
kafka               Up (healthy)
zookeeper           Up (healthy)
kafka-ui            Up
kafka-init          Exited (0)   ← 這是正常的，初始化完就會退出
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

你應該看到 Kafka UI 介面，點選左側 **Topics** 可以看到以下已建立的 Topic：

| Topic 名稱 | 用途 |
|-----------|------|
| `wallet.debit` | 扣款事件 |
| `wallet.credit` | 入帳事件 |
| `game.result` | 遊戲結果 |
| `rank.update` | 排行榜更新 |
| `notification.push` | 推播通知 |
| `member.registered` | 新會員註冊 |

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

**Redis 連線測試（用終端機）：**
```bash
# 進入 Redis 容器
docker exec -it lucky_star_casino-redis-1 redis-cli

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
├── gateway-service/      ← API 閘道，所有請求都先經過這裡
├── member-service/       ← 會員註冊、登入、JWT
├── wallet-service/       ← 星幣錢包、帳務
├── game-service/         ← RNG 遊戲引擎（老虎機、百家樂）
├── rank-service/         ← 排行榜（Redis ZSet）
└── admin-service/        ← 後台管理
```

每個 Service 都是**獨立的 Spring Boot 專案**，可以個別啟動。

### 6.3 設定各 Service 的 application.yml

每個 service 的 `src/main/resources/application.yml` 需要設定資料庫連線。  
以 `member-service` 為例：

```yaml
spring:
  datasource:
    url: jdbc:postgresql://localhost:5433/lucky_star_casino
    username: lucky_user
    password: lucky_password
  redis:
    host: localhost
    port: 6379
  kafka:
    bootstrap-servers: localhost:9092

server:
  port: 8081  # 對應 .env 的 MEMBER_SERVICE_PORT
```

### 6.4 啟動單一 Service

在 IntelliJ 中，找到對應 Service 的 `Application.java`（主程式），右鍵 → **Run**。

或用終端機：

```bash
cd backend/member-service
./mvnw spring-boot:run
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

### 7.4 設定 API 位置

建立 `frontend/.env.development` 檔案：

```env
VITE_API_BASE_URL=http://localhost:8080
VITE_WS_URL=ws://localhost:8080/ws
```

> `VITE_` 開頭的環境變數才能在 React 程式碼中讀取到。

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

## 完整啟動順序總結

```
1. 啟動 Docker Desktop
2. cd Lucky-Strat-Casino
3. cp .env.example .env
4. docker compose up -d
5. 等待 docker compose ps 全部顯示 healthy
6. 開啟 IntelliJ → 啟動需要的 Spring Boot Service
7. cd frontend && npm install && npm run dev
8. 瀏覽器開 http://localhost:5173
```

---

> 如果遇到本文件沒有提到的問題，請在 GitHub Issues 或群組頻道提問，附上錯誤訊息截圖。
