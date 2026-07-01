package com.luckystar.game.service;

import com.luckystar.game.config.RiskProperties;
import com.luckystar.game.repository.GameRoundRepository;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
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
 *
 * <p><b>並發閘（concurrency gate）</b>：{@link #shouldIntercept} 呼叫時，以 Redis INCR
 * 原子性地標記一個「進行中名額」（key：{@code risk:inflight:{playerId}}）。
 * 若同一玩家有兩個請求同時進行（counter &gt; 1），第二個保守攔截，
 * 避免兩個並發請求同時讀取相同舊 DB 值而雙倍超限。
 * 呼叫端在完整處理完畢後<b>必須</b>呼叫 {@link #releaseRiskSlot(long)}
 * 釋放名額；TTL 30 秒作為安全保底（崩潰或例外時自動清除）。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class RiskControlService {

    private static final Duration INFLIGHT_TTL = Duration.ofSeconds(30);

    private final GameRoundRepository roundRepository;
    private final StringRedisTemplate redisTemplate;
    private final RiskProperties riskProperties;

    /**
     * 判斷本局是否應被風控攔截。
     *
     * <p>此方法會原子性地遞增玩家的「進行中」計數器（Redis INCR）。
     * 無論回傳值為何，呼叫端完成整局處理後<b>必須</b>呼叫 {@link #releaseRiskSlot(long)}。
     *
     * @param playerId 玩家 ID
     * @param gameType 遊戲類型（SLOT / FISHING / BACCARAT）
     * @return true = 應攔截（本局介入）；false = 正常放行
     */
    public boolean shouldIntercept(long playerId, String gameType) {
        // 並發閘：原子性取號，若同一玩家已有進行中請求則保守攔截
        String inflightKey = "risk:inflight:" + playerId;
        try {
            Long count = redisTemplate.opsForValue().increment(inflightKey, 1L);
            redisTemplate.expire(inflightKey, INFLIGHT_TTL);
            if (count != null && count > 1) {
                log.warn("[風控] 並發請求攔截 playerId={} inflight={}", playerId, count);
                return true;
            }
        } catch (Exception e) {
            log.warn("[風控] Redis 並發閘失效，降級為直查 playerId={}: {}", playerId, e.toString());
        }

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

    /**
     * 釋放 {@link #shouldIntercept} 佔用的並發名額。
     * 無論本局是否被攔截，呼叫端完整處理後須在 finally 區塊呼叫此方法。
     */
    public void releaseRiskSlot(long playerId) {
        try {
            redisTemplate.opsForValue().decrement("risk:inflight:" + playerId);
        } catch (Exception e) {
            log.warn("[風控] releaseRiskSlot 失敗 playerId={}: {}", playerId, e.toString());
        }
    }

    /** 今日該玩家在此遊戲的淨贏是否超過上限。 */
    private boolean isPlayerOverLimit(long playerId, String gameType) {
        LocalDateTime startOfDay = LocalDate.now().atStartOfDay();
        Object[] agg = firstRow(
                roundRepository.aggregatePlayerToday(playerId, gameType, startOfDay));
        long totalBet = toLong(agg[0]);
        long totalWin = toLong(agg[1]);
        long netWin = totalWin - totalBet;
        return netWin >= riskProperties.getPlayerWinLimit();
    }

    /**
     * 近 N 局的全局 RTP（含本金口徑）是否超過該遊戲的上限。
     *
     * <p>門檻為 per-game（{@link RiskProperties#globalRtpLimitFor}）：因各遊戲結構性莊家優勢不同，
     * 含本金 RTP 的正常水位也不同，單一門檻會把低莊優遊戲（百家樂 ≈ 0.99）每局都誤判超限。
     */
    private boolean isGlobalRtpOverLimit(String gameType) {
        Object[] agg = firstRow(
                roundRepository.aggregateRecent(gameType, riskProperties.getRtpSampleSize()));
        long totalBet = toLong(agg[0]);
        long totalWin = toLong(agg[1]);
        if (totalBet <= 0) return false;
        double rtp = (double) totalWin / totalBet;
        return rtp >= riskProperties.globalRtpLimitFor(gameType);
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
