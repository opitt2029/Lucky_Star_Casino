package com.luckystar.game.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Data;

/**
 * 老虎機下注請求（T-032）。對應 {@code POST /api/v1/game/slot/spin} 的 body。
 *
 * <p>玩家身分不在 body，而是由 gateway 驗證 JWT 後注入的 {@code X-User-Id} header 決定。
 */
@Data
public class SpinRequest {

    /**
     * 下注金額（星幣）。前端下注選項為 100 / 500 / 1,000 / MAX，且單局上限 5,000，
     * 故約束為 {@code [100, 5000]}。
     */
    @NotNull
    @Min(value = 100, message = "單局下注最低 100 星幣")
    @Max(value = 5000, message = "單局下注上限 5,000 星幣")
    private Long bet;

    /**
     * 玩家自訂的 client seed（選填）。未提供時由伺服器產生預設值。
     * 用於 Provably Fair：玩家可指定種子以參與結果的不可預測性。
     */
    @Size(max = 200, message = "clientSeed 長度上限 200")
    private String clientSeed;
}
