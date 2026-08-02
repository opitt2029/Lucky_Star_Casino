# 封閉 Beta 收尾 Runbook

本文件是封閉 Beta 前的執行清單。目標是讓測試玩家能進來玩，但內部服務、資料庫、後台權限與帳務風險仍保持可控。

## 1. 版本鎖定

1. 確認工作區乾淨：
   ```bash
   git status --short
   ```
2. 確認 CI gate 通過後建立 commit。
3. 對封閉 Beta 版本打 tag：
   ```bash
   git tag beta-closed-YYYYMMDD
   ```
4. 記錄本次版本的 commit SHA、tag、部署時間與操作者。

## 2. Beta 環境設定

1. 複製 `.env.beta.example` 為 beta 主機的 `.env`。
2. 替換所有 `CHANGE_ME`，尤其是：
   - `JWT_SECRET`
   - `ADMIN_JWT_SECRET`
   - `INTERNAL_SECRET`
   - `INTERNAL_SERVICE_SECRET`
   - `MYSQL_ROOT_PASSWORD`
   - `MYSQL_PASSWORD`
   - `POSTGRES_PASSWORD`
   - `KAFKA_CLUSTER_ID`
3. `VITE_USE_MOCK_API` 必須是 `false`。
4. `ADMIN_SEED_ENABLED` 預設維持 `false`。若全新 DB 需要播種管理員，只能短暫改成 `true` 啟動一次，登入後立刻改密碼，再改回 `false` 重啟。
5. `CORS_ALLOWED_ORIGINS` 只填正式 Beta 玩家端與後台來源。

## 3. 網路暴露

封閉 Beta 使用 beta overlay 啟動：

```bash
docker compose -f docker-compose.yml -f docker-compose.beta.yml --env-file .env up -d --build
```

預期只有 `gateway-service` publish 到 host。資料庫、Redis、Kafka、Kafka UI、member/wallet/game/rank/admin/notification 服務不應有 host port。

檢查：

```bash
docker compose -f docker-compose.yml -f docker-compose.beta.yml --env-file .env ps
```

若需要 Kafka UI、Prometheus、Grafana，只能在維運內網或臨時 SSH tunnel 使用，不要對 Beta 玩家公開。

## 4. Beta Smoke

後端健康檢查：

```bash
curl -f http://localhost:8080/actuator/health
```

全鏈路 smoke：

```bash
node tests/smoke/smoke.mjs
```

玩家端 real API 驗收：

1. 註冊新帳號。
2. 登入。
3. 領取新手禮。
4. 確認星幣餘額更新。
5. 玩老虎機、百家樂、捕魚。
6. 兌換商城道具。
7. 在背包使用或裝備道具。
8. 檢查排行榜、遊戲紀錄、錢包交易。
9. 後台登入，確認可查玩家、停權、GM 發幣、查看報表。

帳務 smoke 後跑對帳：

```powershell
.\tests\performance\run-accounting-reconciliation.ps1
```

接受標準：負餘額、重複冪等鍵、超扣、帳本不平衡皆為 0。

## 5. 監控與回報

封閉 Beta 期間至少追蹤：

- Gateway 5xx / 429。
- 服務 `/actuator/health`。
- wallet outbox pending。
- Kafka consumer lag。
- DB 連線池與磁碟空間。
- 新手禮領取量、註冊量、同 IP 異常註冊。

玩家回報入口必須在開測前準備好，並明確告知：

- 本站為模擬幣封閉 Beta。
- 星幣與鑽石沒有真實金流價值。
- 測試期間資料可能因修復或重置而異動。

## 6. 回滾

1. 保留上一個可用 tag。
2. 回滾前先備份 MySQL、PostgreSQL、Redis volume。
3. 若新版本只改前端，可先回滾前端資產。
4. 若含 DB migration，必須確認 migration 是否可逆；不可直接用舊服務打新 schema。
5. 回滾後重跑 smoke 與帳務對帳。
