package com.luckystar.game.scheduler;

import com.luckystar.game.service.RiskControlService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 玩家日水位重校排程（T-090 風控 Phase A2 補強）。
 *
 * <p>{@link RiskControlService#recordRoundSettled} 是 best-effort，Redis 寫失敗那局的 bet/win
 * 就永久遺失，而 {@code isPlayerOverLimit} 一旦看到 hash 兩欄存在即終日信任、不再對 DB 重驗——
 * 漂移是<b>無界</b>的（方向為欠攔）。本排程每 {@code risk.player-day-reconcile-ms} 以 game_rounds
 * 聚合值 HSET 覆蓋 Redis 水位 hash，把無界漂移壓成「≤ 一個排程間隔」。
 *
 * <p><b>Scaling note</b>：{@code aggregateAllPlayersToday} 每個「今日有玩過的 (player, game)」回一列。
 * 超過約 10 萬日活玩家時需改 keyset 分頁；在專案目前規模下單一查詢正確且更簡單。
 *
 * <p>結構、註解與 log 風格比照 {@link GlobalRtpCacheScheduler}：{@code reconcile...} 本身已 never-throw，
 * 此處 try/catch 為第二層保險——排程方法拋例外會讓 Spring scheduler 靜默停掉後續執行。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class PlayerDayWaterlineReconcileScheduler {

    private final RiskControlService riskControlService;

    @Scheduled(fixedDelayString = "${risk.player-day-reconcile-ms:60000}")
    public void run() {
        try {
            riskControlService.reconcilePlayerDayWaterlines();
        } catch (Exception ex) {
            log.warn("[風控] 玩家日水位重校失敗: {}", ex.toString());
        }
    }
}
