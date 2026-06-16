package com.luckystar.game.exception;

/**
 * 呼叫 wallet-service 失敗（連線不通、逾時、非預期的 HTTP 狀態或回應格式異常）。
 * 經 {@code GlobalExceptionHandler} 對外回 502 Bad Gateway。
 */
public class WalletUnavailableException extends RuntimeException {

    public WalletUnavailableException(String message) {
        super(message);
    }

    public WalletUnavailableException(String message, Throwable cause) {
        super(message, cause);
    }
}
