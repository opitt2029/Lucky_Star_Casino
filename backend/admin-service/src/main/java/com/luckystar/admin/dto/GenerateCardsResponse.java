package com.luckystar.admin.dto;

import java.util.List;

/** 批量生成點數卡回應（T-105）：回傳生成的序號供匯出。 */
public record GenerateCardsResponse(
        int count,
        long faceValue,
        List<String> cardCodes
) {}
