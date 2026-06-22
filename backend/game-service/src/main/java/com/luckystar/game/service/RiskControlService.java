package com.luckystar.game.service;

import com.luckystar.game.repository.GameRoundRepository;
import java.time.LocalDate;
import java.time.LocalDateTime;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * 風控攔截服務。
 *
 * <p>在每局派彩前檢查兩個維度：
 * <ul>
 *   <li>單一玩家今日淨贏是否超過上限（{@code risk.player-win-limit}）。</li>
 *   <li>近 N 局全局 RTP 是否超過上限（{@code risk.global-rtp-limit}）。</li>
 * </ul>
 * 任一超過則回傳 {@code true}（「應攔截」），由呼叫端決定介入方式。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class RiskControlService {

    /** 單一玩家今日淨贏上限（星幣）。 */
    @Value("${risk.player-win-limit:50000}")
    private long playerWinLimit;

    /** 全局 RTP 上限（0-1 之間的小數）。 */
    @Value("${risk.global-rtp-limit:0.95}")
    private double globalRtpLimit;

    /** 計算全局 RTP 時使用的近 N 局樣本數。 */
    @Value("${risk.rtp-sample-size:500}")
    private int rtpSampleSize;

    private final GameRoundRepository roundRepository;

    /**
     * 判斷本局是否應被風控攔截。
     *
     * @param playerId 玩家 ID
     * @param gameType 遊戲類型（SLOT / FISHING / BACCARAT）
     * @return true = 應攔截（本局介入）；false = 正常放行
     */
    public boolean shouldIntercept(long playerId, String gameType) {
        if (isPlayerOverLimit(playerId, gameType)) {
            log.warn("[風控] 玩家今日淨贏超限 playerId={} gameType={}", playerId, gameType);
            return true;
        }
        if (isGlobalRtpOverLimit(gameType)) {
            log.warn("[風控] 全局 RTP 超限 gameType={}", gameType);
            return true;
        }
        return false;
    }

    /** 今日該玩家在此遊戲的淨贏是否超過上限。 */
    private boolean isPlayerOverLimit(long playerId, String gameType) {
        LocalDateTime startOfDay = LocalDate.now().atStartOfDay();
        Object[] agg = firstRow(
                roundRepository.aggregatePlayerToday(playerId, gameType, startOfDay));
        long totalBet = toLong(agg[0]);
        long totalWin = toLong(agg[1]);
        long netWin = totalWin - totalBet;
        return netWin >= playerWinLimit;
    }

    /** 近 rtpSampleSize 局的全局 RTP 是否超過上限。 */
    private boolean isGlobalRtpOverLimit(String gameType) {
        Object[] agg = firstRow(
                roundRepository.aggregateRecent(gameType, rtpSampleSize));
        long totalBet = toLong(agg[0]);
        long totalWin = toLong(agg[1]);
        if (totalBet <= 0) return false;
        double rtp = (double) totalWin / totalBet;
        return rtp >= globalRtpLimit;
    }

    private static Object[] firstRow(java.util.List<Object[]> rows) {
        if (rows == null || rows.isEmpty() || rows.get(0) == null)
            return new Object[]{0L, 0L, 0L};
        return rows.get(0);
    }

    private static long toLong(Object value) {
        return value == null ? 0L : ((Number) value).longValue();
    }
}
