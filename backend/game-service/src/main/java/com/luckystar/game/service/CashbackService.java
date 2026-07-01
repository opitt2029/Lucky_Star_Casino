package com.luckystar.game.service;

import com.luckystar.game.entity.CashbackRecord;
import com.luckystar.game.kafka.CashbackEventPublisher;
import com.luckystar.game.repository.CashbackRecordRepository;
import com.luckystar.game.repository.GameRoundRepository;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 虧損返利核心邏輯（日返利 + 週返利）。
 *
 * <p>返利規則：
 * <pre>
 *   日返利門檻 ≥ 1,000：1,000~4,999 → 5%；5,000~9,999 → 8%；10,000+ → 10%
 *   週返利門檻 ≥ 3,000：3,000~4,999 → 8%；5,000~9,999 → 12%；10,000+ → 15%
 * </pre>
 *
 * <p>流程：
 * <ol>
 *   <li>查 {@code game_rounds} 彙整期間內每位玩家的淨虧損。</li>
 *   <li>超過門檻者計算返利金額，建立 {@code CashbackRecord(PENDING)}，
 *       {@code UNIQUE(player_id, period_type, period_start)} 防重複。</li>
 *   <li>發 {@code wallet.credit.request} 指令，成功後更新狀態 CREDITED；失敗標 FAILED。</li>
 *   <li>best-effort 推播 {@code notification.push}。</li>
 * </ol>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class CashbackService {

    private static final String PERIOD_DAILY  = "DAILY";
    private static final String PERIOD_WEEKLY = "WEEKLY";
    private static final DateTimeFormatter DATE_FMT = DateTimeFormatter.ofPattern("yyyyMMdd");

    // 日返利階梯（門檻/比例）
    private static final long    DAILY_TIER1_MIN  = 1_000L;
    private static final long    DAILY_TIER2_MIN  = 5_000L;
    private static final long    DAILY_TIER3_MIN  = 10_000L;
    private static final BigDecimal DAILY_RATE1   = new BigDecimal("0.05");
    private static final BigDecimal DAILY_RATE2   = new BigDecimal("0.08");
    private static final BigDecimal DAILY_RATE3   = new BigDecimal("0.10");

    // 週返利階梯
    private static final long    WEEKLY_TIER1_MIN = 3_000L;
    private static final long    WEEKLY_TIER2_MIN = 5_000L;
    private static final long    WEEKLY_TIER3_MIN = 10_000L;
    private static final BigDecimal WEEKLY_RATE1  = new BigDecimal("0.08");
    private static final BigDecimal WEEKLY_RATE2  = new BigDecimal("0.12");
    private static final BigDecimal WEEKLY_RATE3  = new BigDecimal("0.15");

    private final GameRoundRepository       roundRepository;
    private final CashbackRecordRepository  cashbackRepository;
    private final CashbackEventPublisher    publisher;

    /**
     * 計算並發放日返利。
     *
     * @param targetDate 要計算的目標日期（通常為昨天）
     * @return 成功入帳的筆數
     */
    public int processDailyCashback(LocalDate targetDate) {
        LocalDateTime start = targetDate.atStartOfDay();
        LocalDateTime end   = targetDate.atTime(LocalTime.MAX);
        log.info("[日返利] 開始計算 date={} window=[{}, {}]", targetDate, start, end);

        List<Object[]> rows = roundRepository.aggregateNetLossPerPlayer(start, end);
        int credited = 0;
        for (Object[] row : rows) {
            long playerId  = toLong(row[0]);
            long totalBet  = toLong(row[1]);
            long totalWin  = toLong(row[2]);
            long netLoss   = totalBet - totalWin;
            BigDecimal rate = dailyRate(netLoss);
            if (rate == null) continue;

            credited += issue(playerId, PERIOD_DAILY, targetDate, netLoss, rate);
        }
        log.info("[日返利] 完成 date={} 共 {} 筆入帳", targetDate, credited);
        return credited;
    }

    /**
     * 計算並發放週返利。
     *
     * @param weekStart 上週一（計算期間：weekStart ~ weekStart+6 日）
     * @return 成功入帳的筆數
     */
    public int processWeeklyCashback(LocalDate weekStart) {
        LocalDateTime start = weekStart.atStartOfDay();
        LocalDateTime end   = weekStart.plusDays(7).atStartOfDay();
        log.info("[週返利] 開始計算 weekStart={} window=[{}, {})", weekStart, start, end);

        List<Object[]> rows = roundRepository.aggregateNetLossPerPlayer(start, end);
        int credited = 0;
        for (Object[] row : rows) {
            long playerId  = toLong(row[0]);
            long totalBet  = toLong(row[1]);
            long totalWin  = toLong(row[2]);
            long netLoss   = totalBet - totalWin;
            BigDecimal rate = weeklyRate(netLoss);
            if (rate == null) continue;

            credited += issue(playerId, PERIOD_WEEKLY, weekStart, netLoss, rate);
        }
        log.info("[週返利] 完成 weekStart={} 共 {} 筆入帳", weekStart, credited);
        return credited;
    }

    /**
     * 對單一玩家建立 CashbackRecord 並發 Kafka 指令。
     * 以 @Transactional 確保「落庫 PENDING + 標 CREDITED」的原子性；
     * Kafka 重送被 wallet 端冪等鍵擋住，最多一次重複入帳風險已消除。
     */
    @Transactional
    int issue(long playerId, String periodType, LocalDate periodStart,
              long netLoss, BigDecimal rate) {
        String idemKey = buildIdemKey(periodType, periodStart, playerId);

        // 去重：同一玩家同一期間已有記錄（排程重複執行保護）
        if (cashbackRepository.existsByPlayerIdAndPeriodTypeAndPeriodStart(
                playerId, periodType, periodStart)) {
            log.debug("[返利] 已存在，跳過 playerId={} periodType={} periodStart={}",
                    playerId, periodType, periodStart);
            return 0;
        }

        long cashbackAmount = BigDecimal.valueOf(netLoss)
                .multiply(rate)
                .setScale(0, RoundingMode.FLOOR)
                .longValue();

        CashbackRecord record = new CashbackRecord();
        record.setPlayerId(playerId);
        record.setPeriodType(periodType);
        record.setPeriodStart(periodStart);
        record.setLossAmount(netLoss);
        record.setCashbackRate(rate);
        record.setCashbackAmount(cashbackAmount);
        record.setIdempotencyKey(idemKey);
        record.setStatus("PENDING");
        cashbackRepository.save(record);

        try {
            publisher.publishCredit(playerId, cashbackAmount, idemKey);
            record.setStatus("CREDITED");
            record.setCreditedAt(java.time.LocalDateTime.now());
            cashbackRepository.save(record);

            publisher.publishNotification(playerId, periodType, periodStart, netLoss, cashbackAmount);

            log.info("[返利] 已入帳 playerId={} periodType={} loss={} rate={} cashback={}",
                    playerId, periodType, netLoss, rate, cashbackAmount);
            return 1;
        } catch (Exception ex) {
            record.setStatus("FAILED");
            cashbackRepository.save(record);
            log.error("[返利] 發送失敗 playerId={} idemKey={}: {}", playerId, idemKey, ex.toString());
            return 0;
        }
    }

    private static String buildIdemKey(String periodType, LocalDate periodStart, long playerId) {
        String tag = "DAILY".equals(periodType) ? "daily" : "weekly";
        return "cashback-" + tag + "-" + periodStart.format(DATE_FMT) + "-" + playerId;
    }

    /** 日返利階梯。未達門檻回 null 表示不發放。 */
    static BigDecimal dailyRate(long netLoss) {
        if (netLoss >= DAILY_TIER3_MIN) return DAILY_RATE3;
        if (netLoss >= DAILY_TIER2_MIN) return DAILY_RATE2;
        if (netLoss >= DAILY_TIER1_MIN) return DAILY_RATE1;
        return null;
    }

    /** 週返利階梯。未達門檻回 null 表示不發放。 */
    static BigDecimal weeklyRate(long netLoss) {
        if (netLoss >= WEEKLY_TIER3_MIN) return WEEKLY_RATE3;
        if (netLoss >= WEEKLY_TIER2_MIN) return WEEKLY_RATE2;
        if (netLoss >= WEEKLY_TIER1_MIN) return WEEKLY_RATE1;
        return null;
    }

    private static long toLong(Object o) {
        if (o instanceof Number n) return n.longValue();
        return 0L;
    }
}
