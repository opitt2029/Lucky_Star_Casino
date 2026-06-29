package com.luckystar.member.exception;

/** 當月該里程碑已領取過 → 409。 */
public class MonthlyRewardAlreadyClaimedException extends RuntimeException {
    public MonthlyRewardAlreadyClaimedException(int milestoneDays) {
        super("Monthly reward already claimed for milestone: " + milestoneDays);
    }
}
