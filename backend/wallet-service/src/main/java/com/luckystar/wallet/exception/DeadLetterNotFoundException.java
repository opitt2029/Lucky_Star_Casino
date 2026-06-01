package com.luckystar.wallet.exception;

/** 查無指定的 DLT 失敗訊息（T-028）→ HTTP 404。 */
public class DeadLetterNotFoundException extends RuntimeException {
    public DeadLetterNotFoundException(String message) {
        super(message);
    }
}
