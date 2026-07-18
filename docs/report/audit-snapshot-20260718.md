# 工作分配表進度快照 — 2026-07-18

> 由 `node tools/audit/generate-audit-snapshot.mjs` 產生（git HEAD：`d8e576b`）。
> 證據清單：`tools/audit/tasks.json`；判定規則見該工具檔頭註解。

### A.1 全域 / 基礎建設（S0-W1）

| 任務 | 負責人 | 優先 | 任務名稱 | 狀態 | 盤點依據（自動產生） |
|---|---|:--:|---|:--:|---|
| T-000 | 組長A | P0 | GitHub Repo 與分支策略 | ✅ | 檔案 3/3 |
| T-001 | 組長A | P0 | 架構圖與 ADR | ✅ | 檔案 2/2；git log --grep "T-001" → 2 筆 |
| T-002 | 組員D | P0 | Docker Compose 環境 | ✅ | 檔案 1/1；git log --grep "T-002" → 5 筆 |
| T-003 | 組員D | P0 | 各 Service Spring Boot 初始化 | ✅ | 檔案 7/7 |
| T-004 | 組員E | P0 | React 前端初始化 | ✅ | 檔案 3/3 |
| T-005 | 組長A | P0 | Kafka Topic 規劃 | ✅ | 檔案 1/1；git log --grep "T-005" → 1 筆 |
| T-006 | 全員 | P0 | DB Schema 與 DDL | ✅ | 檔案 2/2；git log --grep "T-006" → 2 筆 |

### A.2 Member Service（組長A）

| 任務 | 優先 | 任務名稱 | 狀態 | 盤點依據（自動產生） |
|---|:--:|---|:--:|---|
| T-010 | P0 | 會員註冊 API | ✅ | 檔案 1/1；git log --grep "T-010" → 4 筆 |
| T-011 | P0 | JWT 登入/登出 API | ✅ | 檔案 2/2；git log --grep "T-011" → 5 筆 |
| T-012 | P0 | JWT Token 刷新 | ✅ | 檔案 1/1；git log --grep "T-012" → 3 筆 |
| T-013 | P0 | Spring Security 過濾器鏈 | ✅ | 檔案 2/2；git log --grep "T-013" → 3 筆 |
| T-014 | P0 | 玩家個人資料 CRUD | ✅ | 檔案 2/2；git log --grep "T-014" → 6 筆 |
| T-015 | P1 | 好友系統 API | ✅ | 檔案 2/2；git log --grep "T-015" → 2 筆 |
| T-016 | P1 | 任務系統資料結構 | ✅ | 檔案 3/3 |
| T-017 | P1 | 每日簽到 API | ✅ | 檔案 3/3；git log --grep "T-017" → 2 筆 |
| T-018 | P1 | 新手禮包自動發放 | ✅ | 檔案 2/2；git log --grep "T-018" → 1 筆 |

### A.3 Wallet Service（組員C）

| 任務 | 優先 | 任務名稱 | 狀態 | 盤點依據（自動產生） |
|---|:--:|---|:--:|---|
| T-020 | P0 | Wallet 初始化（開戶） | ✅ | 檔案 1/1；git log --grep "T-020" → 5 筆 |
| T-021 | P0 | 查詢星幣餘額 API | ✅ | 檔案 1/1；git log --grep "T-021" → 5 筆 |
| T-022 | P0 | 下注扣款 API | ✅ | 檔案 2/2；git log --grep "T-022" → 3 筆 |
| T-023 | P0 | 派彩入帳 API | ✅ | 檔案 2/2；git log --grep "T-023" → 5 筆 |
| T-024 | P0 | 冪等性防重複 | ✅ | 檔案 1/1；git log --grep "T-024" → 4 筆 |
| T-025 | P0 | 帳務流水查詢 API | ✅ | 檔案 2/2；git log --grep "T-025" → 5 筆 |
| T-026 | P1 | 好友星幣贈送 API | ✅ | 檔案 1/1；git log --grep "T-026" → 4 筆 |
| T-027 | P1 | 破產補助 API | ✅ | 檔案 1/1；git log --grep "T-027" → 4 筆 |
| T-028 | P2 | Kafka DLT 處理 | ✅ | 檔案 2/2；git log --grep "T-028" → 7 筆 |

### A.4 RNG Game Service（組員B）

| 任務 | 優先 | 任務名稱 | 狀態 | 盤點依據（自動產生） |
|---|:--:|---|:--:|---|
| T-030 | P0 | Provably Fair RNG 引擎 | ✅ | 檔案 2/2；git log --grep "T-030" → 13 筆 |
| T-031 | P0 | 老虎機遊戲邏輯 | ✅ | 檔案 2/2；git log --grep "T-031" → 6 筆 |
| T-032 | P0 | 老虎機遊戲 API | ✅ | 檔案 3/3；git log --grep "T-032" → 7 筆 |
| T-033 | P0 | Redis 遊戲 Session 管理 | ✅ | 檔案 1/1；git log --grep "T-033" → 7 筆 |
| T-034 | P1 | 百家樂遊戲邏輯 | ✅ | 檔案 1/1；git log --grep "T-034" → 5 筆 |
| T-035 | P1 | 百家樂遊戲 API | ✅ | 檔案 2/2；git log --grep "T-035" → 3 筆 |
| T-036 | P1 | RNG 公平性驗證 API | ✅ | 檔案 2/2；git log --grep "T-036" → 6 筆 |
| T-037 | P2 | 遊戲 RTP 統計 | ✅ | 檔案 3/3；git log --grep "T-037" → 9 筆 |

### A.5 Rank Service（組員D）

| 任務 | 優先 | 任務名稱 | 狀態 | 盤點依據（自動產生） |
|---|:--:|---|:--:|---|
| T-040 | P0 | Redis ZSet 全服排行榜 | ✅ | 檔案 2/2 |
| T-041 | P0 | 好友排行榜 | ✅ | 檔案 1/1；git log --grep "T-041" → 9 筆 |
| T-042 | P0 | 排行榜查詢 API | ✅ | 檔案 1/1；git log --grep "T-042" → 9 筆；註：頭像欄位待 member 端發布頭像後補（跨組待辦） |
| T-043 | P1 | 每週排行榜重置排程 | ✅ | 檔案 3/3 |
| T-044 | P1 | 每日持幣快照任務 | ✅ | 檔案 3/3 |
| T-045 | P2 | 今日贏幣王排行榜 | ✅ | 檔案 1/1；git log --grep "T-045" → 3 筆 |

### A.6 Admin Service（組員D）

| 任務 | 優先 | 任務名稱 | 狀態 | 盤點依據（自動產生） |
|---|:--:|---|:--:|---|
| T-050 | P1 | Admin JWT 認證（角色區分） | ✅ | 檔案 3/3；git log --grep "T-050" → 4 筆 |
| T-051 | P1 | 玩家帳號管理 API | ✅ | 檔案 3/3；git log --grep "T-051" → 7 筆 |
| T-052 | P1 | 星幣流通量報表 API | ✅ | 檔案 2/2；git log --grep "T-052" → 3 筆 |
| T-053 | P1 | 遊戲 RTP 監控儀表板 API | ✅ | 檔案 1/1；git log --grep "T-053" → 3 筆 |
| T-054 | P2 | 異常玩家偵測機制 | ✅ | 檔案 3/3；git log --grep "T-054" → 7 筆 |
| T-055 | P2 | 手動發放星幣 API（GM 工具） | ✅ | 檔案 2/2；git log --grep "T-055" → 6 筆 |

### A.7 Gateway（組長A）

| 任務 | 優先 | 任務名稱 | 狀態 | 盤點依據（自動產生） |
|---|:--:|---|:--:|---|
| T-060 | P0 | Spring Cloud Gateway 路由 | ✅ | 檔案 1/1 |
| T-061 | P0 | Gateway JWT 驗證過濾器 | ✅ | 檔案 1/1；git log --grep "T-061" → 1 筆 |
| T-062 | P0 | 每玩家速率限制 | ✅ | 檔案 2/2；git log --grep "T-062" → 2 筆 |
| T-063 | P1 | Circuit Breaker 熔斷 | ✅ | 檔案 1/1；git log --grep "T-063" → 2 筆 |

### A.8 Notification Service（組員D）

| 任務 | 優先 | 任務名稱 | 狀態 | 盤點依據（自動產生） |
|---|:--:|---|:--:|---|
| T-070 | P1 | WebSocket STOMP Server | ✅ | 檔案 2/2；git log --grep "T-070" → 6 筆 |
| T-071 | P1 | Kafka → WebSocket 推播橋接 | ✅ | 檔案 1/1；git log --grep "T-071" → 4 筆 |
| T-072 | P1 | 遊戲結果推播 | ✅ | 檔案 1/1；git log --grep "T-072" → 5 筆 |
| T-073 | P2 | 排行榜變動廣播 | ✅ | 檔案 1/1；git log --grep "T-073" → 5 筆 |

### A.9 前端（組員E）

| 任務 | 優先 | 任務名稱 | 狀態 | 盤點依據（自動產生） |
|---|:--:|---|:--:|---|
| T-080 | P0 | 登入/註冊頁面 | ✅ | 檔案 3/3 |
| T-081 | P0 | Redux Toolkit 全域狀態 | ✅ | 檔案 5/5 |
| T-082 | P0 | 遊戲大廳頁面 | ✅ | 檔案 1/1 |
| T-083 | P0 | 老虎機遊戲頁面 | ✅ | 檔案 2/2；git log --grep "T-083" → 3 筆 |
| T-084 | P0 | WebSocket 連線管理 | ⚠️ | 人工判定：檔案齊備（useWebSocket.js/RealtimeBridge.jsx）且 notification-service 已完成，但端對端驗收未留存紀錄、dev 預設 VITE_ENABLE_WS=false；實測通過後移除本 override 改回自動判定 |
| T-085 | P1 | 排行榜頁面 | ✅ | 檔案 2/2；git log --grep "T-085" → 2 筆 |
| T-086 | P1 | 帳務明細頁面 | ⚠️ | 檔案 1/2（缺 `frontend/src/pages/Transactions.jsx`）；git log --grep "T-086" → 1 筆 |
| T-087 | P1 | 百家樂遊戲頁面 | ✅ | 檔案 2/2；git log --grep "T-087" → 3 筆 |
| T-088 | P1 | 個人資料/好友管理頁面 | ✅ | 檔案 2/2 |
| T-089 | P2 | RWD 響應式優化 | ❓ | 人工判定：無法由檔案結構直接判定，需實機檢視三斷點 |

### A.10 測試 / DevOps / 收尾（組員D + 組長A）

| 任務 | 優先 | 任務名稱 | 狀態 | 盤點依據（自動產生） |
|---|:--:|---|:--:|---|
| T-090 | P0 | JMeter 高併發壓測腳本 | ✅ | 檔案 3/3；git log --grep "T-090" → 54 筆；註：2026-07-18 E3 結案輪正式驗收通過（D1-c：150 全綠 P99 377ms＋1,000 韌性 PASS 成功率 99.2%＋T-091 0 新違規），報告 Status=CLOSED，原效能 gate 未達標 override 已移除 |
| T-091 | P0 | 帳務一致性對帳腳本 | ✅ | 檔案 2/2；git log --grep "T-091" → 12 筆 |
| T-092 | P1 | Swagger UI API 文件 | ✅ | 檔案 1/1；git log --grep "T-092" → 3 筆 |
| T-093 | P0 | End-to-End 整合測試 | ⚠️ | 人工判定：後端已實作、Playwright E2E 已存在（playwright.config.js），但尚未涵蓋跨服務全鏈路（下注→帳務→排行→通知）整合驗證；補齊後移除本 override |
| T-094 | P0 | README 與部署文件 | ✅ | 檔案 2/2；git log --grep "T-094" → 1 筆 |
| T-095 | P0 | ADR 整理（ADR-001~005） | ✅ | 檔案 5/5；git log --grep "T-095" → 2 筆 |
| T-096 | P0 | 結業簡報 | ❌ | 檔案 0/1（缺 `docs/**/*簡報*`） |

### A.11 鑽石點數卡系統（T-100~T-107，後續新增需求）

| 任務 | 負責人 | 優先 | 任務名稱 | 狀態 | 盤點依據（自動產生） |
|---|---|:--:|---|:--:|---|
| T-100 | 組員D | P0 | 鑽石相關資料表 | ✅ | 檔案 2/2；git log --grep "T-100" → 9 筆 |
| T-101 | 組員C | P0 | 鑽石錢包初始化 | ✅ | 檔案 1/1；git log --grep "T-101" → 4 筆 |
| T-102 | 組員C | P0 | 點數卡序號兌換鑽石 API | ✅ | 檔案 2/2；git log --grep "T-102" → 8 筆 |
| T-103 | 組員C | P0 | 鑽石兌換星幣 API | ✅ | 檔案 1/1；git log --grep "T-103" → 5 筆 |
| T-104 | 組員C | P0 | 查詢鑽石餘額 API | ✅ | 檔案 1/1；git log --grep "T-104" → 8 筆 |
| T-105 | 組員D | P1 | 批量生成點數卡序號 API | ✅ | 檔案 2/2；git log --grep "T-105" → 5 筆 |
| T-106 | 組員D | P1 | 查詢點數卡列表 API | ✅ | 檔案 1/1；git log --grep "T-106" → 5 筆 |
| T-107 | 組員E | P1 | 鑽石錢包頁面（前端） | ✅ | 檔案 3/3；git log --grep "T-107" → 4 筆 |

### A.12 新增任務（T-108~T-114）

| 任務 | 任務名稱 | 狀態 | 盤點依據（自動產生） |
|---|---|:--:|---|
| T-108 | 停用玩家即時封鎖（Redis 封鎖 + token min-iat） | ✅ | 檔案 2/2；git log --grep "T-108" → 2 筆 |
| T-109 | Gateway 補 /api/v1/friends/** 路由 | ✅ | 檔案 1/1 |
| T-110 | Windows 一鍵啟動腳本（start-all.bat） | ✅ | 人工判定：已完成後由後端容器化取代（docker compose up -d --build，CHANGELOG 2026-07-07），原生腳本已移除；歷史 commit 見 git log --grep start-all |
| T-111 | 捕魚機遊戲（game-service fishing） | ✅ | 檔案 4/4 |
| T-112 | CasinoShop 頁面 | ✅ | 檔案 1/1 |
| T-113 | CheckIn 頁面 | ✅ | 檔案 1/1 |
| T-114 | 統一客服入口（SupportModal / uiSlice） | ✅ | 檔案 2/2；git log --grep "T-114" → 2 筆 |

### A.13 進度統計（自動計算）

| 狀態 | 任務數 | 占比 |
|---|:--:|:--:|
| ✅ 已完成 | 80 | 94% |
| ⚠️ 部分完成 | 3 | 4% |
| ❌ 未開始 | 1 | 1% |
| ❓ 待確認 | 1 | 1% |
| **總計** | **85** | 100% |

