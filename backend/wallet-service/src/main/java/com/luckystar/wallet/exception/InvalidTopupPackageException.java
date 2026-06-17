package com.luckystar.wallet.exception;

/** 加值方案代號不存在（T-自助加值）→ 400。 */
public class InvalidTopupPackageException extends RuntimeException {
    public InvalidTopupPackageException(String message) {
        super(message);
    }
}
