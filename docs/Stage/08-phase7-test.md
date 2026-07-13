# Phase 7 — 測試 & 文件（P0 / P1）✅ 已完成

> **完成摘要（2026-07-13 複核）**：
> - **T-092 Swagger**：各服務加 springdoc，gateway 聚合 `/v3/api-docs/{service}`。
> - **T-090 JMeter 壓測**：✅ 已實跑完成（150 / 1,000 併發）。
>   結論與根因鏈見 `docs/performance/T-090-load-test-report.md`。
> - **T-091 帳務對帳**：✅ 帳務 gate 全程 PASS（`tests/performance/accounting-reconciliation.sql`、
>   `tools/reconciliation/reconcile-game-wallet.mjs`）。
>
> ⚠️ **T-090 的後續效能調校是另一條線、仍在進行**：Phase A/B1/C1/C2/C3 已落地並對照重跑
> （150 併發 P99 −48%、1,000 併發成功 +430%、401 歸零），但 D1（驗收拓樸與 gate 語意）
> 尚未拍板、1,000 併發下 429 佔比仍高。**要接手效能調校請看
> `docs/plans/02-T-090-效能調校藍圖.md`，不是本檔。**
>
> 以下為當時的施工計畫，保留作歷史紀錄。

> 含任務：T-092（Swagger）、T-090（JMeter 壓測）、T-091（帳務對帳）
> 為何排最後：T-090/T-091 雖 P0，但需**完整服務拓撲 + 真實數據**才能跑（AGENTS.md §地雷 12）；
> T-092 宜等 API 大致完成再整合，文件才完整。

---

## T-092　Swagger UI API 文件整合（P1）

**前置依賴**：各服務 API 大致完成（Rank/Admin/Notification）。
**涉及檔**：各服務 pom（`springdoc-openapi-starter-webmvc-ui`）、gateway 聚合設定。

### Step
1. 各服務加 `springdoc-openapi`，啟 `/swagger-ui.html` + `/v3/api-docs`。
2. controller/DTO 加 `@Operation`、`@Schema`、錯誤碼說明、認證方式（Bearer JWT）。
3. **Gateway 聚合**：在 gateway 設定 grouped openapi，一站看各服務文件。
4. 驗證每個端點 request/response schema 正確。

**交付物**：Swagger 設定 + 文件驗證。**工時**：3h
### 驗收
gateway swagger 看得到所有服務端點、schema、認證說明。

---

## T-090　JMeter 高併發壓力測試（P0）

**前置依賴**：完整拓撲啟動（T-002）、slot API（T-032✅）、1000 組已入金玩家 JWT。
**涉及檔**：`tests/performance/slot-1000-players.jmx`（骨架已存在）、`docs/performance/T-090-load-test-report.md`。

### Step
1. **前置**（§地雷 12）：對齊 jmx 與報告假設契約；端點 `POST /api/v1/game/slot/spin`（冪等鍵**伺服器端生成**，非 client 傳）。
2. 準備 1,000 組已入金玩家 JWT。
3. 啟動完整服務拓撲。
4. 情境：1,000 玩家同時下注，持續 60 秒。
5. 驗證指標：帳務無超扣、冪等防重複、**P99 < 500ms**、無 5xx。
6. **無實測數據不可填虛構 P99**。

**交付物**：JMeter .jmx + 壓測報告。**工時**：5h
### 驗收
報告含真實 P99、錯誤率、吞吐，達標 P99<500ms 且無 5xx。

---

## T-091　帳務一致性自動化驗證腳本（P0）

**前置依賴**：T-090 壓測跑完（要有交易數據）。
**涉及檔**：對帳 SQL + 驗證腳本（`tests/...`）。

### Step
1. 壓測後跑對帳 SQL：
   - `wallets.balance` == `wallet_transactions` 流水加總（逐玩家）。
   - 無負餘額玩家。
   - `frozenAmount` 全部歸零。
2. 包成可重跑腳本（CI 或手動），不一致 → 紅。
3. 輸出對帳報告。

**交付物**：對帳 SQL + 驗證腳本。**工時**：3h
### 驗收
壓測後對帳全綠：餘額一致、無負餘額、凍結歸零。

---

## 驗證
```bash
# 文件
mvn -pl backend/admin-service,backend/rank-service,backend/notification-service test
# 壓測（需完整環境）
docker compose up -d
jmeter -n -t tests/performance/slot-1000-players.jmx -l result.jtl
# 對帳
psql ... -f tests/.../reconcile.sql
```

### 地雷
- 壓測無真實數據→不可造假 P99。
- 冪等鍵伺服器端生成，jmx 別模擬 client 傳 key。
- 對帳要在壓測「結束後」跑，凍結金額需已釋放。

**Phase 工時合計**：11h
