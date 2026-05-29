package com.luckystar.wallet.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import lombok.Data;

@Data
public class CreditRequest {

    @NotNull
    private Long playerId;

    @NotNull
    @Positive
    private Long amount;

    @NotBlank
    @Pattern(regexp = "WIN|CHECKIN|TASK|GIFT|GM_REWARD|BANKRUPTCY_AID")
    private String subType;

    @NotBlank
    @Size(max = 100)
    private String idempotencyKey;

    @Size(max = 100)
    private String referenceId;
}
