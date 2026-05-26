# S0-W1 基礎建置任務統整

> 版本：v1.0  
> 更新日期：2026-05-26  
> 範圍：T-000 至 T-006

## 驗收總覽

| 任務 | 範圍 | 負責 | 優先級 | Sprint | 工作項目 | 驗收產物 | 狀態 |
|------|------|------|--------|--------|----------|----------|------|
| T-000 | 全域 | 組長A | P0 | S0-W1 | GitHub Repo 建立與分支策略制定 | `README.md`、`CONTRIBUTING.md`、`.github/pull_request_template.md` | 已完成 |
| T-001 | 全域 | 組長A | P0 | S0-W1 | 架構圖定稿與技術決策文件 ADR | `docs/architecture.md`、`docs/adr/ADR-001.md` | 已完成 |
| T-002 | 全域 | 組員D | P0 | S0-W1 | Docker Compose 整合環境建置 | `docker-compose.yml`、`.env.example` | 已完成 |
| T-003 | 全域 | 組員D | P0 | S0-W1 | Spring Boot 專案初始化與共用 Maven 版本管理 | `pom.xml`、`backend/*-service/pom.xml`、各服務 `Application.java` | 已完成 |
| T-004 | 全域 | 組員E | P0 | S0-W1 | React 前端專案初始化 | `frontend/package.json`、`frontend/src/`、Tailwind/ESLint/Prettier 設定 | 已完成 |
| T-005 | 全域 | 組長A | P0 | S0-W1 | Kafka Topic 規劃與建立 | `kafka/kafka-init.sh`、`docs/architecture.md` Topic 清單 | 已完成 |
| T-006 | 全域 | 全員 | P0 | S0-W1 | 資料庫 Schema 初版設計與 Flyway Migration | `database/schema.sql`、`database/mysql/migration/V1__init_schema.sql`、`database/postgres/migration/V1__init_schema.sql` | 已完成 |

## 服務邊界

S0-W1 必要服務以五個 Spring Boot 服務為驗收基準：

| 服務 | Port | 職責 | 主要資料來源 |
|------|------|------|--------------|
| Gateway Service | 8080 | API 入口、JWT 驗證、路由、CORS、限流預留 | Redis |
| Member Service | 8081 | 註冊、登入、會員資料、好友、簽到、任務 | MySQL、Redis |
| Wallet Service | 8082 | 星幣餘額、扣款、派彩、帳務流水、贈幣 | PostgreSQL、MySQL、Redis |
| Game Service | 8083 | RNG、老虎機、百家樂、遊戲對局 | PostgreSQL、Redis |
| Rank Service | 8084 | 全服/好友排行榜、排行快照、排行更新事件 | PostgreSQL、Redis |

`admin-service` 目前保留為延伸骨架，屬於後續後台管理需求，不列入 T-003 的五服務最低驗收範圍。

## Kafka Topic 規格

| Topic | Partitions | Replication Factor | 用途 |
|-------|------------|--------------------|------|
| `member.registered` | 3 | 1 | 註冊後建立錢包與新手禮流程 |
| `wallet.debit` | 3 | 1 | 扣款成功事件 |
| `wallet.credit` | 3 | 1 | 入帳成功事件 |
| `game.result` | 3 | 1 | 遊戲結算結果 |
| `rank.update` | 3 | 1 | 排行榜變動 |
| `notification.push` | 3 | 1 | 推播通知 |
| `wallet.debit.DLT` | 1 | 1 | 扣款事件失敗死信 |
| `wallet.credit.DLT` | 1 | 1 | 入帳事件失敗死信 |

## 可行性驗證指令

```bash
docker-compose config
mvn -q -DskipTests package
cd frontend && npm run build
cd frontend && npm run lint
```

完整 Docker 實機驗證可在 Docker Desktop 啟動後執行：

```bash
docker-compose up -d
docker-compose ps
```
