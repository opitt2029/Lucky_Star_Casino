package com.luckystar.wallet.exception;

/**
 * 贈送超過當日上限（贈出上限或收受上限）。對應 HTTP 422。
 * 由 {@link com.luckystar.wallet.service.GiftService} 在 Redis 當日累計檢查不通過時拋出。
 */
public class GiftLimitExceededException extends RuntimeException {
    public GiftLimitExceededException(String message) {
        super(message);
    }
}
