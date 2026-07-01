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

    /** 帶入金額（星幣）。上限為安全天花板（實質不限，僅再受錢包餘額約束）。 */
    @NotNull
    @Min(value = 100, message = "帶入金額最低 100 星幣")
    @Max(value = 1_000_000, message = "帶入金額上限 1,000,000 星幣")
    private Long buyIn;

    /** 炮台等級 1~3：決定火力/擊殺速度/變異度與射速上限（注額已與砲台解耦，見 {@link #betPerShot}）。 */
    @NotNull
    @Min(value = 1, message = "炮台等級為 1~3")
    @Max(value = 3, message = "炮台等級為 1~3")
    private Integer cannonLevel;

    /** 子彈面額（單發注額，星幣）：玩家自選、整場固定，與砲台解耦（ADR-004）。上限為安全天花板防單發暴險。 */
    @NotNull
    @Min(value = 10, message = "子彈面額最低 10 星幣")
    @Max(value = 10_000, message = "子彈面額上限 10,000 星幣")
    private Long betPerShot;

    /** 玩家自訂 client seed（選填，Provably Fair）。 */
    @Size(max = 200, message = "clientSeed 長度上限 200")
    private String clientSeed;
}
