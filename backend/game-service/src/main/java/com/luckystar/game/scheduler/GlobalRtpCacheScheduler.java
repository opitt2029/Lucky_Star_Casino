package com.luckystar.game.scheduler;

import com.luckystar.game.service.RiskControlService;
import java.util.List;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 全局 RTP 快取排程（T-090 效能調校 Phase A1）。
 *
 * <p>把「近 N 局全局 RTP」的聚合從請求熱路徑移到排程：每 2 秒（{@code risk.rtp-cache-refresh-ms}）
 * 對每個遊戲跑一次既有 {@code aggregateRecent} 聚合，寫入 Redis（key {@code risk:rtp:{gameType}}、
 * TTL 10 秒）。{@link RiskControlService} 熱路徑只讀快取，miss 時退回直查 DB（保守降級）。
 *
 * <p>單一遊戲刷新失敗不可中斷其他遊戲（DB/Redis 瞬斷時 TTL 內舊值仍可用，過期後熱路徑自動降級）。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class GlobalRtpCacheScheduler {

    /** 需維護快取的遊戲類型（對齊 game_rounds.chk_gr_game_type）。 */
    private static final List<String> GAME_TYPES = List.of("SLOT", "BACCARAT", "FISHING");

    private final RiskControlService riskControlService;

    @Scheduled(fixedDelayString = "${risk.rtp-cache-refresh-ms:2000}")
    public void run() {
        for (String gameType : GAME_TYPES) {
            try {
                riskControlService.refreshGlobalRtpCache(gameType);
            } catch (Exception ex) {
                log.warn("[風控] 全局 RTP 快取刷新失敗 gameType={}: {}", gameType, ex.toString());
            }
        }
    }
}
