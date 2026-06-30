package com.luckystar.game.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Data;

/** In-session fishing top-up request. */
@Data
public class FishingTopUpRequest {

    @NotNull(message = "amount is required")
    @Min(value = 100, message = "amount minimum is 100")
    @Max(value = 1000000, message = "amount maximum is 1,000,000")
    private Long amount;

    @NotBlank(message = "clientRequestId is required")
    @Size(max = 80, message = "clientRequestId is too long")
    private String clientRequestId;
}
