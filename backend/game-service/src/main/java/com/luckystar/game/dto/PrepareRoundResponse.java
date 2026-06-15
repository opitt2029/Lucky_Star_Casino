package com.luckystar.game.dto;

import lombok.Builder;
import lombok.Data;

/**
 * 老虎機「開局」回應（T-033）。包在 {@code ApiResponse.data} 內。
 *
 * <p>commit-ahead 的承諾階段輸出：只回傳 {@code serverSeedHash}（= {@code SHA-256(serverSeed)}）
 * 與 {@code clientSeed}，<b>刻意不含 serverSeed</b>——serverSeed 在結算後（settle）才揭露，
 * 確保伺服器在玩家下注前已鎖定本局結果且事後無法竄改。
 */
@Data
@Builder
public class PrepareRoundResponse {

    /** 本局唯一識別碼（UUID）；結算時以此呼叫 {@code .../round/{roundId}/settle}。 */
    private String roundId;

    /** 遊戲類型固定為 {@code "slot"}。 */
    private String game;

    /** 開局綁定的下注金額。 */
    private long bet;

    /** server seed 的承諾雜湊 {@code SHA-256(serverSeed)}，開局即公布。 */
    private String serverSeedHash;

    /** 本局使用的 client seed（玩家提供或伺服器產生）。 */
    private String clientSeed;
}
