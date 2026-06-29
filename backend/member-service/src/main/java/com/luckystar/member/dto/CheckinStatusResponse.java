package com.luckystar.member.dto;

import java.time.LocalDate;
import java.util.List;

/**
 * 簽到狀態（後端權威來源）。前端月曆／本月天數／月度里程碑領取狀態皆以此為準，
 * 取代過去只存在 localStorage 的脆弱前端狀態。
 *
 * @param month           查詢的年月，格式 yyyy-MM（台北時區）
 * @param signedDates     當月已簽到日期清單（升冪）
 * @param monthCheckinDays 當月累計簽到天數（= signedDates.size()）
 * @param consecutiveDays 最新連續簽到天數（跨月仍延續）
 * @param checkedInToday  今日（台北）是否已簽到
 * @param milestones      月度累計里程碑狀態清單
 */
public record CheckinStatusResponse(
        String month,
        List<LocalDate> signedDates,
        int monthCheckinDays,
        int consecutiveDays,
        boolean checkedInToday,
        List<MonthlyMilestoneStatus> milestones
) {}
