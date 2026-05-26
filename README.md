# 🎰 Lucky Star Casino（幸運星幣城）

幸運星幣城是一個基於**模擬幣機制**的線上娛樂遊戲平台，以微服務架構實作。  
⚠️ **本平台不涉及任何真實金錢交易，定位為社交娛樂遊戲平台。**

---

## 🏗️ 專案架構

本專案採用 **Monorepo** 結構管理前端、後端微服務及基礎設施設定：

```text
.
├── backend/                   # 後端微服務 (Java 21 / Spring Boot 3.x)
│   ├── gateway-service/       # API 網關 (Spring Cloud Gateway) — Port 8080
│   ├── member-service/        # 會員與認證服務 — Port 8081
│   ├── wallet-service/        # 虛擬錢包服務 — Port 8082
│   ├── game-service/          # 遊戲核心邏輯服務 — Port 8083
│   ├── rank-service/          # 排行榜服務 — Port 8084
│   └── admin-service/         # 後台管理延伸骨架 — Port 8086
├── frontend/                  # 前端網頁應用 (React 18 / Vite) — Port 5173
├── database/                  # 資料庫初始化腳本
│   ├── mysql/                 # MySQL Schema（查詢讀庫）
│   └── postgres/              # PostgreSQL Schema（帳務核心）
├── kafka/                     # Kafka 初始化腳本
├── docs/                      # 專案開發文件
├── .github/                   # GitHub PR 範本與分支規範
├── pom.xml                    # 後端共用 Maven parent / 依賴版本管理
├── docker-compose.yml         # 基礎設施編排檔
└── .env.example               # 環境變數範本
```

---

## 🛠️ 技術棧

### 💻 Frontend
| 技術 | 用途 |
|------|------|
| React 18 + Vite | 核心框架 |
| Redux Toolkit | 全域狀態管理 |
| React Router | 前端路由 |
| Axios | HTTP API 呼叫 |
| Tailwind CSS | 樣式工具 |
| STOMP over WebSocket | 即時推播（遊戲結果、排行榜） |

### ⚙️ Backend（微服務）
| 技術 | 用途 |
|------|------|
| Java 21 + Spring Boot 3.x | 核心語言與框架 |
| Spring Cloud Gateway | API 網關、JWT 驗證、限流 |
| Spring Security + JWT | 認證授權 |
| Spring Data JPA | 資料存取 |
| Apache Kafka 3.x | 非同步事件驅動通訊 |
| Redis 7 | JWT 黑名單、遊戲 Session、排行榜快取 |
| Resilience4j | 熔斷器、Rate Limiter |

### 🗄️ Database
| 資料庫 | 用途 | Port |
|--------|------|------|
| PostgreSQL 16 | 帳務核心（wallets、wallet_transactions） | 5433 |
| MySQL 8.0 | 查詢讀庫（members、遊戲紀錄、CQRS） | 3307 |

> Port 使用非預設值（5433 / 3307）以避免與本機已安裝的資料庫衝突。

### 🚀 Infrastructure
| 技術 | 用途 |
|------|------|
| Docker + Docker Compose | 容器化與一鍵啟動 |
| Zookeeper | Kafka broker 協調（S0-W1 指定版本） |
| Kafka UI | Kafka Topic 可視化管理 |
| Flyway | 資料庫版本管理（Migration） |

---

## 📖 專案文件

| 文件 | 說明 |
|------|------|
| 📄 [本機環境從零到一教學](docs/ENV_SETUP_GUIDE.md) | 初次加入專案的完整設置教學（推薦從這裡開始） |
| 🏗️ [系統架構文件](docs/architecture.md) | 服務邊界、DB 分配、Kafka Topics、Port 表、請求流程圖 |
| 📋 [ADR-001 資料庫分配決策](docs/adr/ADR-001.md) | PostgreSQL（寫）+ MySQL（讀）CQRS 分離的決策過程 |
| 📄 [專案基底功能說明](docs/PROJECT_BASE_EXPLANATION.md) | 系統底座現況、服務職責說明 |
| ✅ [S0-W1 任務驗收統整](docs/S0-W1_DELIVERABLES.md) | T-000 至 T-006 產物與驗證指令 |
| 🤝 [開發者貢獻與分支規範](CONTRIBUTING.md) | PR 流程、分支命名、Code Review 規範 |

---

## 🚀 本地快速啟動

> 第一次設置？請參閱 [完整環境設置教學](docs/ENV_SETUP_GUIDE.md)。

### 前置需求

| 工具 | 版本 |
|------|------|
| Git | 2.x 以上 |
| Docker Desktop | 最新版 |
| Java (JDK) | **21** |
| Node.js | **20 LTS 以上** |

### 啟動步驟

**Step 1 — 設定環境變數**
```bash
cp .env.example .env
```

**Step 2 — 啟動基礎設施（資料庫、Kafka、Redis）**
```bash
docker compose up -d
```

**Step 3 — 確認服務健康狀態**
```bash
docker compose ps
# 所有服務應顯示 healthy 或 running
```

**Step 4 — 啟動後端 Service（擇一）**
```bash
cd backend/member-service
./mvnw spring-boot:run
```

**Step 5 — 啟動前端**
```bash
cd frontend
npm install
npm run dev
# 瀏覽器開啟 http://localhost:5173
```

### 管理工具

| 工具 | 網址 | 說明 |
|------|------|------|
| Kafka UI | http://localhost:8085 | 查看 Topics、Consumer Groups |

---

## 🔁 Kafka Topics

| Topic | 發布者 | 消費者 |
|-------|--------|--------|
| `member.registered` | Member Service | Wallet Service（開戶）、Member Service（新手禮） |
| `wallet.debit` | Wallet Service | Rank Service |
| `wallet.credit` | Wallet Service | Rank Service |
| `game.result` | Game Service | Notification Service |
| `rank.update` | Rank Service | Notification Service |
| `notification.push` | 多個 Service | Notification Service |

---

## 📌 基礎設施注意事項

- **Healthcheck**：MySQL、PostgreSQL、Redis、Kafka 皆已內建健康檢查，確保依賴啟動順序正確。
- **Kafka 自動初始化**：所有 Topic 由 `kafka-init` 容器在啟動時自動建立，`Exited (0)` 狀態為正常。
- **資料庫初始化**：`database/mysql/` 與 `database/postgres/` 內的 `.sql` 腳本**僅在 Volume 第一次建立時執行**。MySQL 8.0 使用 `lucky_mysql80_data` volume，Kafka Zookeeper 模式使用 `lucky_kafka_zk_data` volume，避免和舊版資料目錄混用。

---

## 🌿 Git 分支規範

| 分支 | 用途 |
|------|------|
| `main` | 正式版本，不直接 commit |
| `develop` | 開發整合分支，PR 合入這裡 |
| `feature/名字-功能描述` | 個人功能開發分支 |

所有變更須發起 PR 並通過至少 1 位同儕 Code Review，完整規範請參閱 [CONTRIBUTING.md](./CONTRIBUTING.md)。
