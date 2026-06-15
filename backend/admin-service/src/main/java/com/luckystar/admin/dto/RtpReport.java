package com.luckystar.admin.dto;

import java.time.LocalDate;
import java.util.List;

/**
 * 遊戲 RTP 監控報表（T-053）。
 * 比對各遊戲實際 RTP（讀 game_rtp_stats 彙整）與設計值，偏差超過門檻標記 ABNORMAL。
 */
public record RtpReport(
        LocalDate from,
        LocalDate to,
        double deviationThreshold,
        List<Item> items
) {

    public record Item(
            String gameType,
            double designRtp,
            double actualRtp,
            long totalBet,
            long totalWin,
            long roundCount,
            double deviation,
            String status   // NORMAL / ABNORMAL
    ) {}
}
