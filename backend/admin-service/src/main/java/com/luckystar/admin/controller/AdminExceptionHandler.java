package com.luckystar.admin.controller;

import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * 後台共用例外處理：把不合法參數（如不支援的報表維度）轉成 400 而非 500。
 */
@RestControllerAdvice
public class AdminExceptionHandler {

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, String>> handleIllegalArgument(IllegalArgumentException ex) {
        return ResponseEntity.badRequest().body(Map.of("error", "invalid request", "detail",
                ex.getMessage() == null ? "" : ex.getMessage()));
    }
}
