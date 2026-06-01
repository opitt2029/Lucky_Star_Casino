package com.luckystar.wallet.exception;

/** 對已解決（RESOLVED）的 DLT 訊息再次重試等不合法狀態操作（T-028）→ HTTP 409。 */
public class IllegalDltStateException extends RuntimeException {
    public IllegalDltStateException(String message) {
        super(message);
    }
}
