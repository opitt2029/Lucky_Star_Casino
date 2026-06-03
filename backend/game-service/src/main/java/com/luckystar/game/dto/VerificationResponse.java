package com.luckystar.game.dto;

import lombok.Builder;
import lombok.Data;

/**
 * RNG 公平性驗證回應（T-036）。對應 {@code GET /api/v1/game/verify/{roundId}}。
 *
 * <p>系統以 {@code serverSeed}（玩家提供或對局已揭露者）重算本局結果，並與 {@code game_rounds}
 * 既有紀錄比對，回報三項判定：承諾雜湊是否相符、重算結果是否一致、整體是否通過。
 */
@Data
@Builder
public class VerificationResponse {

    /** 對局識別碼。 */
    private String roundId;

    /** 遊戲類型（SLOT / BACCARAT）。 */
    private String gameType;

    /** 本次驗證所用的 server seed（玩家提供或對局揭露值）。 */
    private String serverSeed;

    /** 對局下注前公布的承諾雜湊。 */
    private String serverSeedHash;

    /** 本局 client seed。 */
    private String clientSeed;

    /** 本局 nonce。 */
    private Long nonce;

    /** 本次是否採用玩家提供的 serverSeed（false 表示用對局已揭露值）。 */
    private boolean usedProvidedSeed;

    /** 承諾雜湊是否相符：{@code SHA-256(serverSeed) == serverSeedHash}。 */
    private boolean commitmentValid;

    /** 以該 seed 重算的結果是否與紀錄一致（盤面/牌局與派彩相符）。 */
    private boolean resultMatches;

    /** 整體公平性判定：{@code commitmentValid && resultMatches}。 */
    private boolean valid;

    /** 重算出的結果（供玩家比對；盤面/牌局與點數等）。 */
    private Object recomputed;

    /** 對局既有紀錄的結果（{@code game_rounds.result_data} 解析後）。 */
    private Object stored;

    /** 說明文字。 */
    private String message;
}
