package com.luckystar.wallet.exception;

/**
 * 不合法的贈送請求（例如贈送給自己）。對應 HTTP 400。
 */
public class InvalidGiftException extends RuntimeException {
    public InvalidGiftException(String message) {
        super(message);
    }
}
