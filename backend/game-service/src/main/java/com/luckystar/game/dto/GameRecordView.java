package com.luckystar.game.dto;

import java.time.LocalDateTime;
import lombok.Builder;
import lombok.Data;

/**
 * 玩家「遊戲紀錄」單筆注單視圖（對應一筆 {@link com.luckystar.game.entity.GameRound}）。
 *
 * <p>提供完整稽核欄位：流水號/注單號（{@code roundId}）、局號（{@code nonce}）、
 * 精確到毫秒的下注時間（{@code betAt}）與派彩時間（{@code settledAt}）、
 * 以及「投注前餘額 → 投注金額 → 派彩 → 派彩後餘額」的餘額變化軌跡。
 */
@Data
@Builder
public class GameRecordView {

    /** 流水號 / 注單號（對外唯一識別碼，UUID）。 */
    private String roundId;

    /** 遊戲類型：SLOT / BACCARAT / FISHING。 */
    private String gameType;

    /** 遊戲局號（本局 nonce；捕魚為最後一發序號）。 */
    private Long nonce;

    /** 投注金額。 */
    private Long betAmount;

    /** 派彩金額（含本金）。 */
    private Long winAmount;

    /** 本局淨損益（派彩 − 投注；無資料時為 null）。 */
    private Long profit;

    /** 投注前錢包餘額。 */
    private Long balanceBefore;

    /** 派彩後錢包餘額。 */
    private Long balanceAfter;

    /** 下注時間（毫秒精度）。 */
    private LocalDateTime betAt;

    /** 派彩 / 結算時間（毫秒精度）。 */
    private LocalDateTime settledAt;

    /** 對局狀態：STARTED / SETTLED。 */
    private String status;

    /** server seed 承諾雜湊（供事後公平性驗證對照）。 */
    private String serverSeedHash;

    /** 本局 client seed。 */
    private String clientSeed;

    /** 遊戲結果 JSON 字串（盤面 / 牌面 / 彙總等）。 */
    private String resultData;
}
