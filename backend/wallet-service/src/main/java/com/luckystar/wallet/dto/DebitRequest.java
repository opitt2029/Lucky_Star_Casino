package com.luckystar.wallet.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import lombok.Data;

@Data
public class DebitRequest {

    @NotNull
    private Long playerId;

    @NotNull
    @Positive
    private Long amount;

    /**
     * 扣款子類型，必須是 DB 約束允許的 DEBIT 類子型之一（選填，預設 BET）。
     * 對應 schema {@code chk_wt_sub_type}。目前 DEBIT 類：BET（下注）、SHOP_PURCHASE（商城兌換扣星幣）。
     * <p>game-service 經 {@code /internal/wallet/debit} 送的 JSON 不帶此欄位 → null → 服務端預設記 BET，
     * 既有行為不變；商城在 process 內呼叫時帶 SHOP_PURCHASE。
     */
    @Pattern(regexp = "BET|SHOP_PURCHASE",
             message = "subType must be one of BET/SHOP_PURCHASE")
    private String subType;

    @NotBlank
    @Size(max = 100)
    private String idempotencyKey;

    @Size(max = 100)
    private String referenceId;
}
