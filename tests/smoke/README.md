# Smoke Test（全功能實機）

經由 gateway(8080) 真打 member / wallet / game / rank 的核心端點，驗證整條
「路由 + JWT + 業務邏輯」鏈路是否可用。屬 end-to-end smoke，**非**單元測試（單元/整合測試見各服務 `src/test`、CI 已涵蓋 gateway/member/wallet）。

## 前置

1. 啟動基礎設施並確認全 healthy：
   ```bash
   docker compose up -d
   docker compose ps          # 全部 healthy
   ```
2. 載入 `.env`（`JWT_SECRET` / `INTERNAL_SECRET` / `CORS_ALLOWED_ORIGINS`）到每個後端 shell。
3. 依序啟動 5 個後端服務（見 DEPLOY.md §4）：
   ```bash
   mvn -pl backend/member-service  spring-boot:run
   mvn -pl backend/wallet-service  spring-boot:run
   mvn -pl backend/game-service    spring-boot:run
   mvn -pl backend/rank-service    spring-boot:run
   mvn -pl backend/gateway-service spring-boot:run
   ```
   就緒檢查：`GET http://localhost:8080/actuator/health` = `UP`。

## 執行

```bash
node tests/smoke/smoke.mjs
```

可調環境變數：`GATEWAY_URL`（預設 `http://localhost:8080`）。

## 涵蓋範圍

- **member**：register → login → profile(GET/PUT) → refresh → logout
- **wallet**：錢包建立(Kafka) → bankruptcy-aid 注資 → balance / transactions / daily-checkin / diamond balance
- **game**：slot spin、slot commit-ahead 兩階段、baccarat bet+result、fishing 開場→射擊→結算→逐發驗證、rtp、RNG verify
- **rank**：global / global/{playerId} / friends

退出碼：有任何 `FAIL` → 1；只有 `WARN`（如當日已簽到、玩家未進榜）→ 0。

> admin-service 仍是骨架、notification 尚未建立，不在本腳本範圍。
