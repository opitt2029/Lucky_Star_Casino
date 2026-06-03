package com.luckystar.game.service;

import com.luckystar.game.dto.RtpStatView;
import com.luckystar.game.entity.GameRtpStat;
import com.luckystar.game.repository.GameRoundRepository;
import com.luckystar.game.repository.GameRtpStatRepository;
import java.util.ArrayList;
import java.util.List;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 遊戲 RTP 統計（T-037）。每小時統計各遊戲「近一萬局」已結算對局的下注/派彩總額，寫入
 * {@code game_rtp_stats}，供 Admin 監控實際 RTP（{@code total_win / total_bet}）是否偏離設計值。
 *
 * <p>排程寫入為歷史快照（每小時一筆/每遊戲）；查詢 API 取各遊戲最新一筆。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class RtpStatsService {

    /** 納入統計的最近局數上限。 */
    static final int SAMPLE_SIZE = 10_000;

    /** 目前支援統計的遊戲類型。 */
    private static final List<String> GAME_TYPES = List.of("SLOT", "BACCARAT");

    private final GameRoundRepository roundRepository;
    private final GameRtpStatRepository rtpStatRepository;

    /**
     * 每小時整點重算各遊戲 RTP 並寫入一筆統計。
     */
    @Scheduled(cron = "${game.rtp.cron:0 0 * * * *}")
    public void scheduledRecalculate() {
        log.info("RTP 統計排程啟動");
        recalculateAll();
    }

    /**
     * 重算所有支援遊戲的 RTP 並各寫入一筆統計。
     *
     * @return 本次寫入的統計（每遊戲一筆）
     */
    @Transactional
    public List<GameRtpStat> recalculateAll() {
        List<GameRtpStat> saved = new ArrayList<>();
        for (String gameType : GAME_TYPES) {
            saved.add(recalculate(gameType));
        }
        return saved;
    }

    /** 重算單一遊戲 RTP 並寫入一筆。 */
    public GameRtpStat recalculate(String gameType) {
        Object[] agg = firstRow(roundRepository.aggregateRecent(gameType, SAMPLE_SIZE));
        long totalBet = toLong(agg[0]);
        long totalWin = toLong(agg[1]);
        int roundCount = (int) toLong(agg[2]);

        GameRtpStat stat = new GameRtpStat();
        stat.setGameType(gameType);
        stat.setTotalBet(totalBet);
        stat.setTotalWin(totalWin);
        stat.setRoundCount(roundCount);
        GameRtpStat persisted = rtpStatRepository.save(stat);

        log.info("RTP 統計 gameType={} rounds={} totalBet={} totalWin={} rtp={}",
                gameType, roundCount, totalBet, totalWin, computeRtp(totalBet, totalWin));
        return persisted;
    }

    /**
     * 取各遊戲最新一筆 RTP 統計（供 API）。無資料的遊戲略過。
     */
    @Transactional(readOnly = true)
    public List<RtpStatView> latestStats() {
        List<RtpStatView> views = new ArrayList<>();
        for (String gameType : GAME_TYPES) {
            rtpStatRepository.findTopByGameTypeOrderByCalculatedAtDesc(gameType)
                    .ifPresent(s -> views.add(toView(s)));
        }
        return views;
    }

    private static RtpStatView toView(GameRtpStat s) {
        return RtpStatView.builder()
                .gameType(s.getGameType())
                .totalBet(s.getTotalBet())
                .totalWin(s.getTotalWin())
                .roundCount(s.getRoundCount())
                .rtp(computeRtp(s.getTotalBet(), s.getTotalWin()))
                .calculatedAt(s.getCalculatedAt())
                .build();
    }

    /** RTP = totalWin / totalBet，四捨五入至小數第 4 位；無下注回 0。 */
    static double computeRtp(long totalBet, long totalWin) {
        if (totalBet <= 0) {
            return 0.0d;
        }
        return Math.round((double) totalWin / totalBet * 10000.0d) / 10000.0d;
    }

    private static Object[] firstRow(List<Object[]> rows) {
        if (rows == null || rows.isEmpty() || rows.get(0) == null) {
            return new Object[] {0L, 0L, 0L};
        }
        return rows.get(0);
    }

    /** 將 DB 回傳的數值（可能為 BigInteger/BigDecimal/Long）統一轉 long。 */
    private static long toLong(Object value) {
        return value == null ? 0L : ((Number) value).longValue();
    }
}
