package com.luckystar.admin.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;

/** GM 手動發放星幣請求（T-055）。amount 需為正整數。 */
public record GmGrantRequest(
        @NotNull Long playerId,
        @NotNull @Positive Long amount,
        String reason
) {}
