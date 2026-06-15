package com.luckystar.admin.dto;

import java.util.Locale;

/** 點數卡查詢狀態過濾（T-106）。 */
public enum CardStatusFilter {
    ALL,
    REDEEMED,
    UNREDEEMED;

    public static CardStatusFilter from(String value) {
        if (value == null) {
            return ALL;
        }
        return CardStatusFilter.valueOf(value.trim().toUpperCase(Locale.ROOT));
    }
}
