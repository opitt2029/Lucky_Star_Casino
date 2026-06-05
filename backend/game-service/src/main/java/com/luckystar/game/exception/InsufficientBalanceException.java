package com.luckystar.game.exception;

/**
 * 玩家星幣餘額不足以支付下注。由 {@code WalletClient} 在 wallet-service 回 HTTP 422 時拋出，
 * 經 {@code GlobalExceptionHandler} 對外回 422。
 */
public class InsufficientBalanceException extends RuntimeException {

    public InsufficientBalanceException(String message) {
        super(message);
    }
}
