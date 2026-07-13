# docs 索引

> 最後整理：2026-07-13
>
> **文件分三類，先看清楚你手上這份是哪一類**，這是本專案最容易踩的坑：
>
> | 類別 | 意思 | 能不能照著做 |
> |---|---|---|
> | 🟢 **現況** | 隨程式碼維護，描述「現在是什麼樣」 | ✅ 可信，發現不符請順手修（AGENTS.md §5） |
> | 🟡 **計畫** | 還沒做完的事，有進度表 | ✅ 可照著動工，做完要更新進度表 |
> | ⚪ **歷史** | 交付快照 / 已完成任務的紀錄 | ❌ **不要照著動工**，只當背景脈絡讀 |
>
> 判定任務是否完成，**永遠以程式碼與 `git log` 為準**，不要只信文件（AGENTS.md §1）。

---

## 🟢 現況：先讀這些

| 文件 | 內容 |
|---|---|
| [`architecture.md`](architecture.md) | **架構單一入口**：七服務職責、Kafka topic、DB 分配、Redis key、Port、請求流程、ADR 索引 |
| [`PROJECT_BASE_EXPLANATION.md`](PROJECT_BASE_EXPLANATION.md) | 專案功能總覽：玩家玩得到什麼、資料存哪、資料夾用途、還沒做的事 |
| [`ENV_SETUP_GUIDE.md`](ENV_SETUP_GUIDE.md) | **新人從零到一**：裝工具 → `.env` 密鑰 → `docker compose` → 前後端起來 |
| [`LOCAL_API_INTEGRATION_GUIDE.md`](LOCAL_API_INTEGRATION_GUIDE.md) | 本機前後端串接（會員 API 最小路徑）＋常見問題 |
| [`dual-datasource-guide.md`](dual-datasource-guide.md) | wallet / admin 的雙資料源怎麼用（`@Transactional` 要指定 manager、跨庫要拆 Bean） |
| [`baccarat-rules.md`](baccarat-rules.md) | 百家樂規則與派彩（含契約檔 `contracts/baccarat-rules.json` 的同步規則） |
| [`security/secret-rotation.md`](security/secret-rotation.md) | 密鑰用途/影響面/輪替 SOP、CI 為何不用 GitHub Secrets |
| [`adr/`](adr/) | **架構決策紀錄**（見下表） |
| [`performance/`](performance/) | T-090 壓測與效能剖析報告（見下表） |
| [`interview-prep/`](interview-prep/) | 00~13 面試/技術筆記，隨程式碼同步維護（含 `13-壓測與效能調校`） |

### ADR（架構決策）

| ADR | 主題 | 狀態 |
|---|---|---|
| [ADR-000](adr/ADR-000.md) | 後端選 Java（Spring Boot）而非 Go | ✅ |
| [ADR-001](adr/ADR-001.md) | PostgreSQL（寫）+ MySQL（讀）CQRS | ✅ |
| [ADR-002](adr/ADR-002.md) | 分離「入帳指令」`wallet.credit.request` 與「入帳事件」`wallet.credit` | ✅ |
| [ADR-003](adr/ADR-003.md) | 捕魚機血量/傷害模型 | ✅ |
| [ADR-004](adr/ADR-004.md) | 捕魚機經濟再平衡（殘血回收 + 面額自選） | ✅ |
| [ADR-005](adr/ADR-005.md) | 月度累計簽到獎勵 | ✅ |
| [ADR-006](adr/ADR-006.md) | 禮品商城後端化 | ✅ |
| [ADR-007](adr/ADR-007.md) | Testcontainers 補真 DB 測試（只新增、不取代 H2） | ✅ |
| ADR-008 | 捕魚 Redis session Lua CAS | 🅿️ **編號保留，未動工** |
| [ADR-009](adr/ADR-009.md) | game→wallet 最小 Saga 補償 | ✅ |

### performance

| 文件 | 內容 |
|---|---|
| [`T-090-load-test-report.md`](performance/T-090-load-test-report.md) | 壓測主報告：150 / 1,000 併發完整數據、根因鏈、調校前後對照 |
| [`T-090-B1-wallet-debit-analysis.md`](performance/T-090-B1-wallet-debit-analysis.md) | wallet debit 瓶頸剖析（JFR 定案＝Postgres 交易容量 ≈550–600/s） |
| [`T-090-C3-gateway-shedding-design-evaluation.md`](performance/T-090-C3-gateway-shedding-design-evaluation.md) | gateway 動態卸載方案評估（拍板 AIMD 在途上限） |
| [`T-091-accounting-reconciliation-report.md`](performance/T-091-accounting-reconciliation-report.md) | 帳務一致性對帳 |

---

## 🟡 計畫：還沒做完的事

| 文件 | 狀態 |
|---|---|
| [`plans/01-八項架構改進施工藍圖.md`](plans/01-八項架構改進施工藍圖.md) | 8 項中 **7 項已完成**；唯一未動工＝**Phase 3 捕魚 Redis session Lua CAS**（有完整施工說明） |
| [`plans/02-T-090-效能調校藍圖.md`](plans/02-T-090-效能調校藍圖.md) | A/B1/C1/C2/C3 已落地並對照重跑；**D1（驗收拓樸與 gate 語意）待拍板** |
| [`specs/SPEC-001-auth-token-session-hardening.md`](specs/SPEC-001-auth-token-session-hardening.md) | **待實作**：refresh token 仍存 localStorage、無絕對逾時、無改密碼端點 |
| [`plans/02-捕魚機升級-血量傷害模型.md`](plans/02-捕魚機升級-血量傷害模型.md) | Phase 1~4 皆已完成（⚠️ 檔內數值是草案，已被 ADR-003/004 取代，勿直接抄） |

---

## ⚪ 歷史：只讀不做

| 位置 | 說明 |
|---|---|
| [`Stage/`](Stage/) | 組員 D 的 8 個 Phase 施工計畫。**25 個任務已全數完成**，現為歷史紀錄 |
| [`bug/2026-06-25-bug-candidates.md`](bug/2026-06-25-bug-candidates.md) | 5 項 bug **全數已修**（逐項複核結果寫在檔案開頭） |
| [`handover-topup-自助加值.md`](handover-topup-自助加值.md) | 自助加值交接紀錄。**功能已完成並合併**（`TopupController` 等） |
| [`report/Lucky-Star-Casino-*.md`](report/) | 2026-06 中旬的**交付快照**（含 HTML/PDF 匯出），內容凍結，不隨程式碼更新 |
| [`report/PROJECT_ANALYSIS.md`](report/PROJECT_ANALYSIS.md) | 7/07 技術分析。⚠️ 其中 8 項改進建議**已完成 7 項**，開頭有更新框 |
| [`report/portfolio-*.md`](report/) | 作品集 / 面試衝刺素材（隨 interview-prep 同步，7/10 已對齊） |
| [`report/audit-snapshot-*.md`](report/) | `tools/audit/` 產生的當日進度快照 |
| [`_雜物/prompts/`](_雜物/prompts/) | 已完成任務的一次性施工提示詞（5 份功能 + 2 份 T-090 交接） |
| [`_雜物/`](_雜物/) | 舊草稿、報告的 HTML/PDF 匯出 |

---

## 其他

- [`skills/gen-prompt/SKILL.md`](skills/gen-prompt/SKILL.md) — Claude Code 技能：產生後端實作提示詞（會先讀真實專案檔）
- [`game-math/`](game-math/) — RTP 機率模型（`.xlsx` + `verify_rtp.py`）
- `幸運星幣城_工作分配表.xlsx` — **任務與分工的單一真相來源**（T-000~T-107）
- `幸運星幣城_工作事項詳細說明.docx`

## 不在 docs/ 但一定要讀

`AGENTS.md`（**22 條已知地雷，動工前必讀**）、`README.md`、`CLAUDE.md`、`AUDIT_REPORT.md`（附錄 A 進度）、`CHANGELOG.md`、`DEPLOY.md`、`CONTRIBUTING.md`
