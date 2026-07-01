package com.luckystar.wallet.exception;

/** 對非待付款狀態的訂單重複付款等不合法狀態操作 → 409。 */
public class IllegalTopupStateException extends RuntimeException {
    public IllegalTopupStateException(String message) {
        super(message);
    }
}
