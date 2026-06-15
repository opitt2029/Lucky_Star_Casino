package com.luckystar.game.exception;

/**
 * 找不到對局 Session（T-033）。通常代表 commit-ahead 的開局 Session 已逾時（TTL 30 分鐘）、
 * 從未開局，或 roundId 不屬於該玩家。由 {@code GlobalExceptionHandler} 對應為 HTTP 404。
 */
public class RoundNotFoundException extends RuntimeException {

    public RoundNotFoundException(String message) {
        super(message);
    }
}
