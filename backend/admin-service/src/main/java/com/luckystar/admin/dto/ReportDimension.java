package com.luckystar.admin.dto;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.temporal.TemporalAdjusters;
import java.util.Locale;

/** 報表時間維度（T-052）。 */
public enum ReportDimension {
    DAY,
    WEEK,
    MONTH;

    public static ReportDimension from(String value) {
        if (value == null) {
            return DAY;
        }
        return ReportDimension.valueOf(value.trim().toUpperCase(Locale.ROOT));
    }

    /** 把日期歸入該維度的桶鍵：day=yyyy-MM-dd、week=該週週一(yyyy-MM-dd)、month=yyyy-MM。 */
    public String bucketOf(LocalDate date) {
        return switch (this) {
            case DAY -> date.toString();
            case WEEK -> date.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY)).toString();
            case MONTH -> YearMonth.from(date).toString();
        };
    }
}
