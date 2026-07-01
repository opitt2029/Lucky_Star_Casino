package com.luckystar.member.dto;

/**
 * 領取月度累計簽到獎勵的結果。
 *
 * @param milestoneDays    領取的里程碑天數
 * @param rewardAmount     入帳的星幣金額
 * @param rewardMonth      所屬年月 yyyy-MM
 * @param monthCheckinDays 當月累計簽到天數（領取當下）
 */
public record MonthlyRewardClaimResponse(
        Integer milestoneDays,
        Long rewardAmount,
        String rewardMonth,
        int monthCheckinDays
) {}
