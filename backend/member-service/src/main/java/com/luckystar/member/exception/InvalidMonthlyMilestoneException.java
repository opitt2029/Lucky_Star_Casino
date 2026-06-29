package com.luckystar.member.exception;

/** 領取的里程碑天數不在允許清單（10/20/28）→ 400。 */
public class InvalidMonthlyMilestoneException extends RuntimeException {
    public InvalidMonthlyMilestoneException(Integer milestoneDays) {
        super("Invalid monthly milestone: " + milestoneDays);
    }
}
