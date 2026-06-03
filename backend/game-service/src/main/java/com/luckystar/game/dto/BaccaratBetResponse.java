package com.luckystar.game.dto;

import java.util.Map;
import lombok.Builder;
import lombok.Data;

/**
 * 百家樂下注回應（T-035）。commit-ahead 承諾階段輸出：扣款完成、本局已開局（STARTED），
 * 回傳 {@code serverSeedHash} 承諾與各押注區金額，<b>刻意不含 serverSeed</b>——待 {@code /result}
 * 結算後才揭露。玩家以 {@code roundId} 呼叫 {@code POST .../baccarat/{roundId}/result} 取得結果。
 */
@Data
@Builder
public class BaccaratBetResponse {

    /** 本局唯一識別碼（UUID）。 */
    private String roundId;

    /** 遊戲類型固定為 {@code "baccarat"}。 */
    private String game;

    /** 各押注區金額（鍵：player / banker / tie）。 */
    private Map<String, Long> bets;

    /** 三押注區下注總額（= 已扣款金額）。 */
    private long totalBet;

    /** server seed 的承諾雜湊 {@code SHA-256(serverSeed)}，下注時即公布。 */
    private String serverSeedHash;

    /** 本局使用的 client seed。 */
    private String clientSeed;
}
