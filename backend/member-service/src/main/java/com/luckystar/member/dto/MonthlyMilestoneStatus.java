package com.luckystar.member.dto;

/**
 * 單一月度累計簽到里程碑的狀態（供前端渲染領取按鈕）。
 *
 * @param milestoneDays 累計天數門檻（10/20/28）
 * @param rewardAmount  達標可領的星幣金額
 * @param reached       當月累計簽到天數是否已達門檻
 * @param claimed       是否已領取
 * @param claimable     是否「現在可領」= reached && !claimed && 查詢的是當月
 */
public record MonthlyMilestoneStatus(
        Integer milestoneDays,
        Long rewardAmount,
        boolean reached,
        boolean claimed,
        boolean claimable
) {}
