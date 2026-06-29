package com.luckystar.member.dto;

import jakarta.validation.constraints.NotNull;

/**
 * 領取月度累計簽到獎勵請求。body：{ "milestoneDays": 10 }
 */
public record MonthlyRewardClaimRequest(
        @NotNull(message = "milestoneDays must not be null") Integer milestoneDays
) {}
