package com.luckystar.game.service;

import com.luckystar.game.config.RiskProperties;
import com.luckystar.game.repository.GameRoundRepository;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.data.redis.core.script.RedisScript;
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
 * <p><b>統計來源（T-090 效能調校 Phase A1/A2）</b>：兩個維度的統計原本都在請求路徑上即時
 * 重算 DB 聚合（每局一次近 500 局排序聚合＋一次 per-player 聚合），1,000 併發時互相爭搶、
 * 是 P99 的主因。現改為「事件驅動維護、熱路徑只讀 Redis」：
 * <ul>
 *   <li><b>全局 RTP</b>：排程（{@link com.luckystar.game.scheduler.GlobalRtpCacheScheduler}）
 *       每 2 秒重算一次寫入 {@code risk:rtp:{gameType}}（TTL 10 秒）；熱路徑只讀該 key，
 *       cache miss（排程尚未跑過或 Redis 故障）時退回直查 DB（保守降級，行為同舊版）。
 *       可接受 2 秒舊資料：全局 RTP 是「統計性水位警報」而非帳務正確性機制（帳務由 wallet
 *       冪等鍵＋樂觀鎖守，雷區 8），延遲觸發的風險上限與 {@code rtp-sample-size: 500}
 *       本身的統計慣性同量級。</li>
 *   <li><b>玩家今日水位</b>：每局結算落地後由呼叫端呼叫 {@link #recordRoundSettled} 以
 *       HINCRBY 累加 {@code risk:player-day:{playerId}:{yyyyMMdd}:{gameType}}（TTL 48 小時，
 *       日期入 key 天然跨日歸零）；熱路徑讀該 hash，miss 時退回 DB 聚合並回填。
 *       單一真相仍在 {@code game_rounds}（計數器僅是水位快取，可隨時由 DB 重建）。</li>
 * </ul>
 *
 * <p><b>並發閘（concurrency gate）</b>：{@link #shouldIntercept} 呼叫時，以單一 Lua script
 * 原子性地標記一個「進行中名額」（key：{@code risk:inflight:{playerId}}；INCR，且僅在
 * 計數器首次取號時 PEXPIRE——連續請求不會不斷續命 TTL）。
 * 若同一玩家有兩個請求同時進行（counter &gt; 1），第二個保守攔截，
 * 避免兩個並發請求同時讀取相同舊統計值而雙倍超限。
 * 呼叫端在完整處理完畢後<b>必須</b>呼叫 {@link #releaseRiskSlot(long)}
 * 釋放名額；TTL 30 秒作為安全保底（崩潰或例外時自動清除）。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class RiskControlService {

    private static final Duration INFLIGHT_TTL = Duration.ofSeconds(30);
    /** 全局 RTP 快取 TTL：排程每 2 秒重寫，10 秒 TTL 容忍數次排程失敗後才降級直查 DB。 */
    private static final Duration RTP_CACHE_TTL = Duration.ofSeconds(10);
    /** 玩家日水位計數器 TTL：48 小時，確保跨日後舊 key 自然過期（跨日歸零靠日期入 key）。 */
    private static final Duration PLAYER_DAY_TTL = Duration.ofHours(48);

    private static final String RTP_CACHE_KEY_PREFIX = "risk:rtp:";
    private static final DateTimeFormatter DAY_KEY_FORMAT = DateTimeFormatter.ofPattern("yyyyMMdd");

    /**
     * 並發閘取號（Phase A4）：INCR＋「僅首次取號才 PEXPIRE」合併為單一往返。
     * 舊版 INCR＋EXPIRE 是兩次往返，且每次 INCR 都重設 TTL（連續請求會不斷續命）。
     */
    private static final RedisScript<Long> INFLIGHT_ACQUIRE_SCRIPT = new DefaultRedisScript<>("""
            local c = redis.call('INCR', KEYS[1])
            if c == 1 then
                redis.call('PEXPIRE', KEYS[1], ARGV[1])
            end
            return c
            """, Long.class);

    /**
     * 並發閘釋放：DECR 後歸零（或因 stale release 變負）即刪 key。
     * 若僅裸 DECR：請求耗時超過 TTL（或 Redis 重啟）使 key 先過期時，補釋放會把 key 重建為 -1
     * 且無 TTL——取號 Lua 只在 0→1 時設 TTL，計數器從負值起跳將永遠達不到 &gt;1，
     * 並發閘對該玩家靜默失效且不會自癒。刪 key 讓下次取號回到乾淨的 0→1 路徑。
     */
    private static final RedisScript<Long> INFLIGHT_RELEASE_SCRIPT = new DefaultRedisScript<>("""
            local c = redis.call('DECR', KEYS[1])
            if c <= 0 then
                redis.call('DEL', KEYS[1])
            end
            return c
            """, Long.class);

    /** 玩家日水位累加（Phase A2）：HINCRBY bet/win＋PEXPIRE 合併為單一往返。 */
    private static final RedisScript<Long> PLAYER_DAY_RECORD_SCRIPT = new DefaultRedisScript<>("""
            redis.call('HINCRBY', KEYS[1], 'bet', ARGV[1])
            redis.call('HINCRBY', KEYS[1], 'win', ARGV[2])
            redis.call('PEXPIRE', KEYS[1], ARGV[3])
            return 1
            """, Long.class);

    private final GameRoundRepository roundRepository;
    private final StringRedisTemplate redisTemplate;
    private final RiskProperties riskProperties;

    /**
     * 判斷本局是否應被風控攔截。
     *
     * <p>此方法會原子性地遞增玩家的「進行中」計數器（Redis Lua：INCR＋首次取號 PEXPIRE）。
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
            Long count = redisTemplate.execute(INFLIGHT_ACQUIRE_SCRIPT,
                    List.of(inflightKey), String.valueOf(INFLIGHT_TTL.toMillis()));
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
            redisTemplate.execute(INFLIGHT_RELEASE_SCRIPT,
                    List.of("risk:inflight:" + playerId));
        } catch (Exception e) {
            log.warn("[風控] releaseRiskSlot 失敗 playerId={}: {}", playerId, e.toString());
        }
    }

    /**
     * 每局結算落地後，把本局注額/派彩累加進玩家日水位計數器（Phase A2）。
     *
     * <p><b>呼叫時機</b>：對局紀錄成功寫入 DB <b>之後</b>（各遊戲 {@code roundRepository.save}
     * 成功處），與 {@code aggregatePlayerToday} 的口徑一致（status=SETTLED 的 bet/win 含本金）。
     * <b>best-effort</b>：失敗僅記 log——寧可風控水位少計一局（下次 cache miss 由 DB 回填補正），
     * 不可因 Redis 故障讓結算失敗。
     *
     * @param playerId 玩家 ID
     * @param gameType 遊戲類型
     * @param bet      本局注額（對應 game_rounds.bet_amount）
     * @param win      本局派彩（含本金口徑，對應 game_rounds.win_amount）
     */
    public void recordRoundSettled(long playerId, String gameType, long bet, long win) {
        try {
            redisTemplate.execute(PLAYER_DAY_RECORD_SCRIPT,
                    List.of(playerDayKey(playerId, gameType)),
                    String.valueOf(bet), String.valueOf(win),
                    String.valueOf(PLAYER_DAY_TTL.toMillis()));
        } catch (Exception e) {
            log.warn("[風控] 玩家日水位累加失敗（best-effort，待 DB 回填）playerId={} gameType={}: {}",
                    playerId, gameType, e.toString());
        }
    }

    /**
     * 重算某遊戲近 N 局的全局聚合並寫入 Redis 快取（Phase A1；由排程呼叫，不在請求路徑上）。
     * value 格式 {@code totalBet:totalWin}，TTL 10 秒。
     */
    public void refreshGlobalRtpCache(String gameType) {
        Object[] agg = firstRow(
                roundRepository.aggregateRecent(gameType, riskProperties.getRtpSampleSize()));
        String value = toLong(agg[0]) + ":" + toLong(agg[1]);
        redisTemplate.opsForValue().set(RTP_CACHE_KEY_PREFIX + gameType, value, RTP_CACHE_TTL);
    }

    /**
     * 今日該玩家在此遊戲的淨贏是否超過上限。
     *
     * <p>先讀 Redis 日水位 hash（Phase A2）；miss（尚無 key 或 Redis 故障）時退回 DB 聚合，
     * 並以 HSETNX 回填（不覆蓋並發中的 HINCRBY 累加，避免把別局剛加上的量蓋掉）。
     *
     * <p><b>已知取捨</b>：hash 兩欄一旦存在即被信任、當日不再對 DB 重驗。極窄窗口（讀取時
     * Redis 例外且回填失敗、累加時 Redis 已恢復；或 Redis 從舊快照還原）可能低估當日水位、
     * 欠攔到隔日——方向是欠攔非誤攔，且單一真相仍在 game_rounds，可由對帳發現，故接受。
     */
    private boolean isPlayerOverLimit(long playerId, String gameType) {
        String key = playerDayKey(playerId, gameType);
        try {
            List<Object> vals = redisTemplate.opsForHash()
                    .multiGet(key, List.of("bet", "win"));
            // 兩欄皆存在才信任快取：回填非原子，若只寫入一欄就中斷，殘缺 hash 會讓水位恆為負
            // （上限實質停用）——部分缺欄一律視同 miss、退回 DB 重算。
            if (vals != null && vals.get(0) != null && vals.get(1) != null) {
                long netWin = parseLong(vals.get(1)) - parseLong(vals.get(0));
                return netWin >= riskProperties.getPlayerWinLimit();
            }
        } catch (Exception e) {
            log.warn("[風控] 玩家日水位快取讀取失敗，降級為直查 DB playerId={}: {}", playerId, e.toString());
        }

        // cache miss：退回 DB 聚合（單一真相），並 best-effort 回填快取
        LocalDateTime startOfDay = LocalDate.now().atStartOfDay();
        Object[] agg = firstRow(
                roundRepository.aggregatePlayerToday(playerId, gameType, startOfDay));
        long totalBet = toLong(agg[0]);
        long totalWin = toLong(agg[1]);
        backfillPlayerDay(key, totalBet, totalWin);
        return totalWin - totalBet >= riskProperties.getPlayerWinLimit();
    }

    /** 以 HSETNX 回填日水位（僅在欄位不存在時寫入，避免覆蓋並發 HINCRBY；失敗僅 log）。 */
    private void backfillPlayerDay(String key, long totalBet, long totalWin) {
        try {
            redisTemplate.opsForHash().putIfAbsent(key, "bet", String.valueOf(totalBet));
            redisTemplate.opsForHash().putIfAbsent(key, "win", String.valueOf(totalWin));
            redisTemplate.expire(key, PLAYER_DAY_TTL);
        } catch (Exception e) {
            log.warn("[風控] 玩家日水位回填失敗（best-effort）key={}: {}", key, e.toString());
        }
    }

    /**
     * 近 N 局的全局 RTP（含本金口徑）是否超過該遊戲的上限。
     *
     * <p>門檻為 per-game（{@link RiskProperties#globalRtpLimitFor}）：因各遊戲結構性莊家優勢不同，
     * 含本金 RTP 的正常水位也不同，單一門檻會把低莊優遊戲（百家樂 ≈ 0.99）每局都誤判超限。
     *
     * <p>統計值先讀排程維護的 Redis 快取（Phase A1）；miss 時退回直查 DB（行為同舊版）。
     * 只改「數據怎麼來」，不改「怎麼判」（門檻口徑不動，雷區 17）。
     */
    private boolean isGlobalRtpOverLimit(String gameType) {
        long totalBet;
        long totalWin;
        long[] cached = readRtpCache(gameType);
        if (cached != null) {
            totalBet = cached[0];
            totalWin = cached[1];
        } else {
            Object[] agg = firstRow(
                    roundRepository.aggregateRecent(gameType, riskProperties.getRtpSampleSize()));
            totalBet = toLong(agg[0]);
            totalWin = toLong(agg[1]);
        }
        if (totalBet <= 0) return false;
        double rtp = (double) totalWin / totalBet;
        return rtp >= riskProperties.globalRtpLimitFor(gameType);
    }

    /** 讀取全局 RTP 快取；miss、格式異常或 Redis 故障皆回 null（呼叫端降級直查 DB）。 */
    private long[] readRtpCache(String gameType) {
        try {
            String value = redisTemplate.opsForValue().get(RTP_CACHE_KEY_PREFIX + gameType);
            if (value == null) return null;
            int sep = value.indexOf(':');
            if (sep <= 0) return null;
            return new long[]{
                    Long.parseLong(value.substring(0, sep)),
                    Long.parseLong(value.substring(sep + 1))};
        } catch (Exception e) {
            log.warn("[風控] 全局 RTP 快取讀取失敗，降級為直查 DB gameType={}: {}", gameType, e.toString());
            return null;
        }
    }

    private static String playerDayKey(long playerId, String gameType) {
        return "risk:player-day:" + playerId + ":" + LocalDate.now().format(DAY_KEY_FORMAT) + ":" + gameType;
    }

    private static long parseLong(Object value) {
        return value == null ? 0L : Long.parseLong(value.toString());
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
