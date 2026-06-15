package com.luckystar.admin.dto;

import java.time.LocalDateTime;

/** 點數卡列表單筆（T-106）。 */
public record DiamondCardView(
        String cardCode,
        long faceValue,
        boolean redeemed,
        Long redeemedBy,
        LocalDateTime redeemedAt,
        LocalDateTime createdAt
) {}
