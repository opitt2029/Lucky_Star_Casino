# 已完成任務的施工提示詞（歷史歸檔）

> 這裡的檔案原本散在 `docs/` 根目錄與 `docs/performance/`，2026-07-13 歸檔至此。
>
> **它們全都是「當時要交給 AI / 組員動工用的一次性提示詞」，對應的功能已經全部做完了。**
> 保留是為了留下「當時怎麼描述問題、怎麼拆解」的紀錄，**不是待辦清單**。
> 要看功能現況，一律以程式碼與 `docs/architecture.md` 為準。

| 檔案 | 對應任務 | 現況 |
|---|---|---|
| `prompt-fishing-优化.md` | 捕魚機優化 | ✅ 已完成（後續演進為 ADR-003 血量模型 + ADR-004 經濟再平衡 + PixiJS 引擎） |
| `prompt-slot-機率修復.md` | 老虎機機率修復 + 幸運值保底 | ✅ 機率已修（`SlotSymbol` 加權 + 兩階賠付）。⚠️ **「幸運值」FortuneMeter 功能後來整個被移除**，前端已無此元件 |
| `prompt-security-獲利攔截風控.md` | 獲利攔截風控 | ✅ 已完成（`RiskControlService`；門檻改為 per-game 含本金口徑，見雷區 17） |
| `prompt-security-上一頁防呆.md` | 瀏覽器上一頁防呆 | ✅ 已完成（`frontend/src/hooks/useGameLeaveGuard.js`） |
| `prompt-security-多帳號數據隔離.md` | 幸運值/咪牌偏好跨帳號殘留 | ✅ 已不適用——FortuneMeter 已移除，問題隨之消失 |
| `t090-1000-rerun-handoff-prompt.md` | T-090 1,000 併發重跑交接 | ✅ 已完成（2026-07-08，TimeLimiter 修正後重跑） |
| `t090-b1-handoff-prompt.md` | T-090 B1 wallet debit 剖析交接 | ✅ 已完成（2026-07-09，JFR 定案瓶頸＝Postgres 交易容量） |

T-090 的完整結果請看 [`../../performance/T-090-load-test-report.md`](../../performance/T-090-load-test-report.md)；
後續調校進度看 [`../../plans/02-T-090-效能調校藍圖.md`](../../plans/02-T-090-效能調校藍圖.md)。
