package com.luckystar.game.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Data;

/**
 * 捕魚機開場請求。對應 {@code POST /api/v1/game/fishing/session/start}。
 *
 * <p>buy-in 制：開場一次性自 wallet 扣 {@code buyIn} 轉入局內餘額，之後射擊只動局內餘額。
 */
@Data
public class FishingStartRequest {

    /** 帶入金額（星幣）。 */
    @NotNull
    @Min(value = 100, message = "帶入金額最低 100 星幣")
    @Max(value = 50000, message = "帶入金額上限 50,000 星幣")
    private Long buyIn;

    /** 炮台等級 1~3：決定單發注額（10 / 50 / 100）與射速上限。 */
    @NotNull
    @Min(value = 1, message = "炮台等級為 1~3")
    @Max(value = 3, message = "炮台等級為 1~3")
    private Integer cannonLevel;

    /** 玩家自訂 client seed（選填，Provably Fair）。 */
    @Size(max = 200, message = "clientSeed 長度上限 200")
    private String clientSeed;
}
