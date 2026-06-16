package com.luckystar.admin.service;

import com.luckystar.admin.dto.RtpReport;
import com.luckystar.admin.postgres.entity.GameRtpStatRead;
import com.luckystar.admin.postgres.repository.GameRtpStatReadRepository;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

/**
 * 遊戲 RTP 監控（T-053）。
 *
 * 讀 PostgreSQL {@code game_rtp_stats}（由 game-service T-037 排程寫入），彙整區間內各遊戲的
 * 下注/派彩總額算實際 RTP，對照設計 RTP；偏差絕對值 &gt; 門檻（預設 5%）標 ABNORMAL。
 * admin 不重算 RTP（地雷：取 game 既有統計）。設計值與門檻可由設定覆寫。
 */
@Service
public class RtpReportService {

    public static final String STATUS_NORMAL = "NORMAL";
    public static final String STATUS_ABNORMAL = "ABNORMAL";

    private final GameRtpStatReadRepository rtpStatRepository;
    private final double slotDesignRtp;
    private final double baccaratDesignRtp;
    private final double deviationThreshold;

    public RtpReportService(
            GameRtpStatReadRepository rtpStatRepository,
            @Value("${admin.rtp.design.slot:0.95}") double slotDesignRtp,
            @Value("${admin.rtp.design.baccarat:0.98}") double baccaratDesignRtp,
            @Value("${admin.rtp.deviation-threshold:0.05}") double deviationThreshold) {
        this.rtpStatRepository = rtpStatRepository;
        this.slotDesignRtp = slotDesignRtp;
        this.baccaratDesignRtp = baccaratDesignRtp;
        this.deviationThreshold = deviationThreshold;
    }

    public RtpReport getRtpReport(String gameType, LocalDate from, LocalDate to) {
        List<GameRtpStatRead> stats = StringUtils.hasText(gameType)
                ? rtpStatRepository.findByGameTypeAndCalculatedAtBetween(
                        gameType.trim().toUpperCase(), from.atStartOfDay(), to.atTime(LocalTime.MAX))
                : rtpStatRepository.findByCalculatedAtBetween(from.atStartOfDay(), to.atTime(LocalTime.MAX));

        // 依 game_type 彙整（LinkedHashMap 保留首次出現順序）
        Map<String, long[]> agg = new LinkedHashMap<>();
        for (GameRtpStatRead s : stats) {
            long[] sums = agg.computeIfAbsent(s.getGameType(), k -> new long[3]);
            sums[0] += s.getTotalBet() != null ? s.getTotalBet() : 0L;
            sums[1] += s.getTotalWin() != null ? s.getTotalWin() : 0L;
            sums[2] += s.getRoundCount() != null ? s.getRoundCount() : 0L;
        }

        List<RtpReport.Item> items = new ArrayList<>(agg.size());
        for (Map.Entry<String, long[]> e : agg.entrySet()) {
            long totalBet = e.getValue()[0];
            long totalWin = e.getValue()[1];
            long roundCount = e.getValue()[2];
            double actual = totalBet > 0 ? (double) totalWin / totalBet : 0.0;
            double design = designRtpFor(e.getKey());
            double deviation = actual - design;
            // 用 epsilon 容忍浮點誤差：剛好等於門檻(5%)視為 NORMAL，嚴格大於才 ABNORMAL
            String status = (Math.abs(deviation) - deviationThreshold > 1e-9)
                    ? STATUS_ABNORMAL : STATUS_NORMAL;
            items.add(new RtpReport.Item(
                    e.getKey(), design, round4(actual), totalBet, totalWin, roundCount,
                    round4(deviation), status));
        }

        return new RtpReport(from, to, deviationThreshold, items);
    }

    private double designRtpFor(String gameType) {
        return switch (gameType == null ? "" : gameType) {
            case "SLOT" -> slotDesignRtp;
            case "BACCARAT" -> baccaratDesignRtp;
            default -> 0.0;
        };
    }

    private double round4(double value) {
        return Math.round(value * 10000.0) / 10000.0;
    }
}
