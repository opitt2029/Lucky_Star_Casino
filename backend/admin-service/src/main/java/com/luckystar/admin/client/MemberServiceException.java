package com.luckystar.admin.client;

/**
 * 呼叫 member-service 內部 API 失敗（連線不上 / 非 2xx 回應）。
 * 由 {@link com.luckystar.admin.controller.AdminExceptionHandler} 轉成 502，
 * 讓前端能區分「後台自身錯誤」與「下游服務不可用」。
 */
public class MemberServiceException extends RuntimeException {

    public MemberServiceException(String message) {
        super(message);
    }

    public MemberServiceException(String message, Throwable cause) {
        super(message, cause);
    }
}
