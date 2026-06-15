package com.luckystar.admin.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;

/** 批量生成點數卡請求（T-105）。單次最多 1000 張，面額需為正。 */
public record GenerateCardsRequest(
        @NotNull @Min(1) @Max(1000) Integer count,
        @NotNull @Positive Long faceValue
) {}
