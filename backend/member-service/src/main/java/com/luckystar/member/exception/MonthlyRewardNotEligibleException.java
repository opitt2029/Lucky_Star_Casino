package com.luckystar.member.exception;

/** 當月累計簽到天數未達里程碑，尚不可領取 → 422。 */
public class MonthlyRewardNotEligibleException extends RuntimeException {
    public MonthlyRewardNotEligibleException(int milestoneDays, long currentDays) {
        super("Monthly reward not eligible: need " + milestoneDays + " days, current " + currentDays);
    }
}
