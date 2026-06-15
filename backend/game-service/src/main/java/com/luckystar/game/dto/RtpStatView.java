package com.luckystar.game.dto;

import java.time.LocalDateTime;
import lombok.Builder;
import lombok.Data;

/**
 * 單一遊戲的 RTP 統計視圖（T-037）。供 {@code GET /api/v1/game/rtp} 回傳。
 */
@Data
@Builder
public class RtpStatView {

    /** SLOT / BACCARAT。 */
    private String gameType;

    /** 統計區間下注總額。 */
    private long totalBet;

    /** 統計區間派彩總額。 */
    private long totalWin;

    /** 納入統計的局數。 */
    private int roundCount;

    /** 實際 RTP = totalWin / totalBet（無下注時為 0）；四捨五入至小數第 4 位。 */
    private double rtp;

    /** 此筆統計計算時間。 */
    private LocalDateTime calculatedAt;
}
