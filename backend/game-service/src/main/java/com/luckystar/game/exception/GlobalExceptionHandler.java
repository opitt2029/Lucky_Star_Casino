package com.luckystar.game.exception;

import com.luckystar.game.common.ApiResponse;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * game-service 全域例外處理，統一回傳 {@link ApiResponse} 格式。
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    /** 餘額不足 → 422（與 wallet-service 對齊）。 */
    @ExceptionHandler(InsufficientBalanceException.class)
    @ResponseStatus(HttpStatus.UNPROCESSABLE_ENTITY)
    public ApiResponse<Void> handleInsufficientBalance(InsufficientBalanceException ex) {
        return ApiResponse.error(ex.getMessage());
    }

    /** 錢包服務不可用 → 502。 */
    @ExceptionHandler(WalletUnavailableException.class)
    @ResponseStatus(HttpStatus.BAD_GATEWAY)
    public ApiResponse<Void> handleWalletUnavailable(WalletUnavailableException ex) {
        return ApiResponse.error(ex.getMessage());
    }

    /** Bean Validation 失敗 → 400，回傳第一個欄位錯誤訊息。 */
    @ExceptionHandler(MethodArgumentNotValidException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public ApiResponse<Void> handleValidation(MethodArgumentNotValidException ex) {
        String message = ex.getBindingResult().getFieldErrors().stream()
                .findFirst()
                .map(fe -> fe.getField() + ": " + fe.getDefaultMessage())
                .orElse("請求參數錯誤");
        return ApiResponse.error(message);
    }

    /** 其他非法參數 → 400。 */
    @ExceptionHandler(IllegalArgumentException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public ApiResponse<Void> handleIllegalArgument(IllegalArgumentException ex) {
        return ApiResponse.error(ex.getMessage());
    }
}
