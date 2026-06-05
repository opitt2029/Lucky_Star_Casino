package com.luckystar.game.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Data;

/**
 * 老虎機「開局」請求（T-033）。對應 {@code POST /api/v1/game/slot/round} 的 body。
 *
 * <p>commit-ahead 第一階段：玩家先宣告本局下注額與（可選）client seed，伺服器據此產生
 * serverSeed 並回傳其承諾雜湊 {@code serverSeedHash}。此時尚未扣款、亦不揭露 serverSeed；
 * 待第二階段 {@code .../round/{roundId}/settle} 才真正扣款轉動並揭露 serverSeed。
 */
@Data
public class PrepareRoundRequest {

    /**
     * 本局預定下注金額（星幣），約束與單次 spin 一致：{@code [100, 5000]}。
     * 結算時以開局所綁定的金額為準，玩家無法在揭露雜湊後改注。
     */
    @NotNull
    @Min(value = 100, message = "單局下注最低 100 星幣")
    @Max(value = 5000, message = "單局下注上限 5,000 星幣")
    private Long bet;

    /** 玩家自訂 client seed（選填）；未提供時由伺服器產生預設值。 */
    @Size(max = 200, message = "clientSeed 長度上限 200")
    private String clientSeed;
}
