# Phase 0 — 環境收尾（P0）

> 含任務：T-002（Docker Compose 整合環境）
> 目標：一鍵 `docker compose up` 把 PostgreSQL/MySQL/Redis/Kafka/Kafka UI 全部拉起，volume 持久化。
> 為何排第一：後面所有任務的本機驗證都靠這套環境。表定「部分完成」→ 先補完再前進。

---

## T-002　Docker Compose 整合環境建置

**前置依賴**：無（地基）。
**涉及檔**：`docker-compose.yml`、`.env.example`、`kafka/kafka-init.sh`、`DEPLOY.md`。

### Step
1. **盤點現況**：開現有 `docker-compose.yml`，對照 README/DEPLOY.md 列的目標版本：
   - PostgreSQL 16（port 5433）
   - MySQL 8.4（port 3307）
   - Redis 7（6379）
   - Kafka 7.6.1 **KRaft 模式（無 Zookeeper）**（9092）
   - Kafka UI（8085）
2. **補缺漏的 service / 版本對齊**：確認 image tag、port mapping 與 AGENTS.md §3 一致。
3. **掛載 volume**：`lucky_kafka_data`（Kafka 持久化），DB 各自 named volume，重啟不掉資料。
4. **`.env.example` 補齊**：`JWT_SECRET`、`INTERNAL_SECRET`、`CORS_ALLOWED_ORIGINS`（缺了服務啟動失敗）+ 各 DB 帳密 + port。
5. **健康檢查**：各 service 加 `healthcheck`，Kafka 加 `depends_on` 順序。
6. **Kafka topic 初始化**：確認 `kafka/kafka-init.sh` 在 compose 內被執行（init container 或 entrypoint）。

### 交付物
`docker-compose.yml` + `.env.example`（可一鍵啟動）。

### 驗收標準
- `cp .env.example .env` 後 `docker compose up -d` 全部 healthy。
- Kafka UI（localhost:8085）看得到 topic 清單。
- `docker compose down && up` 後資料仍在（volume 生效）。

### 驗證
```bash
docker compose up -d
docker compose ps           # 全部 healthy / running
docker compose down && docker compose up -d   # 驗證持久化
```

### 地雷
- Kafka 用 KRaft，**不要**再加 Zookeeper service。
- port 用專案約定（MySQL 3307、PG 5433），不要用預設 3306/5432，避免撞本機既有 DB。
- 改 topic 要同步 `tests/infra/kafka.test.js`（§地雷 7）。

**工時**：3h
