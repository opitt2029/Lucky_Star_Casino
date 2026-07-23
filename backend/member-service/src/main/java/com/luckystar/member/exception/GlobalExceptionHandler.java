package com.luckystar.member.exception;

import com.luckystar.member.dto.ApiResponse;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.stream.Collectors;

@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(MemberAlreadyExistsException.class)
    public ResponseEntity<ApiResponse<Void>> handleMemberAlreadyExists(MemberAlreadyExistsException ex) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(ApiResponse.error(ex.getMessage()));
    }

    @ExceptionHandler(MemberNotFoundException.class)
    public ResponseEntity<ApiResponse<Void>> handleMemberNotFound(MemberNotFoundException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(ApiResponse.error(ex.getMessage()));
    }

    @ExceptionHandler(InvalidCredentialsException.class)
    public ResponseEntity<ApiResponse<Void>> handleInvalidCredentials(InvalidCredentialsException ex) {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(ApiResponse.error(ex.getMessage()));
    }

    @ExceptionHandler(AccountDisabledException.class)
    public ResponseEntity<ApiResponse<Void>> handleAccountDisabled(AccountDisabledException ex) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(ApiResponse.error(ex.getMessage()));
    }

    @ExceptionHandler(InvalidTokenException.class)
    public ResponseEntity<ApiResponse<Void>> handleInvalidToken(InvalidTokenException ex) {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(ApiResponse.error("Refresh token is invalid or expired"));
    }

    @ExceptionHandler(NoUpdateFieldException.class)
    public ResponseEntity<ApiResponse<Void>> handleNoUpdateField(NoUpdateFieldException ex) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(ApiResponse.error(ex.getMessage()));
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ApiResponse<Void>> handleIllegalArgument(IllegalArgumentException ex) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(ApiResponse.error(ex.getMessage()));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiResponse<Void>> handleValidation(MethodArgumentNotValidException ex) {
        String message = ex.getBindingResult().getFieldErrors().stream()
                .map(FieldError::getDefaultMessage)
                .collect(Collectors.joining("; "));
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(ApiResponse.error(message));
    }

    @ExceptionHandler(SelfFriendRequestException.class)
    public ResponseEntity<ApiResponse<Void>> handleSelfFriendRequest(SelfFriendRequestException ex) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(ApiResponse.error(ex.getMessage()));
    }

    @ExceptionHandler(FriendLimitExceededException.class)
    public ResponseEntity<ApiResponse<Void>> handleFriendLimitExceeded(FriendLimitExceededException ex) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(ApiResponse.error(ex.getMessage()));
    }

    @ExceptionHandler(FriendshipAlreadyExistsException.class)
    public ResponseEntity<ApiResponse<Void>> handleFriendshipAlreadyExists(FriendshipAlreadyExistsException ex) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(ApiResponse.error(ex.getMessage()));
    }

    @ExceptionHandler(FriendshipNotFoundException.class)
    public ResponseEntity<ApiResponse<Void>> handleFriendshipNotFound(FriendshipNotFoundException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(ApiResponse.error(ex.getMessage()));
    }

    @ExceptionHandler(ForbiddenOperationException.class)
    public ResponseEntity<ApiResponse<Void>> handleForbiddenOperation(ForbiddenOperationException ex) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(ApiResponse.error(ex.getMessage()));
    }

    @ExceptionHandler(InvalidFriendshipStatusException.class)
    public ResponseEntity<ApiResponse<Void>> handleInvalidFriendshipStatus(InvalidFriendshipStatusException ex) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(ApiResponse.error(ex.getMessage()));
    }

    @ExceptionHandler(TaskDefinitionNotFoundException.class)
    public ResponseEntity<ApiResponse<Void>> handleTaskDefinitionNotFound(TaskDefinitionNotFoundException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(ApiResponse.error(ex.getMessage()));
    }

    @ExceptionHandler(PlayerTaskNotFoundException.class)
    public ResponseEntity<ApiResponse<Void>> handlePlayerTaskNotFound(PlayerTaskNotFoundException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(ApiResponse.error(ex.getMessage()));
    }

    @ExceptionHandler(AlreadyCheckedInException.class)
    public ResponseEntity<ApiResponse<Void>> handleAlreadyCheckedIn(AlreadyCheckedInException ex) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(ApiResponse.error(ex.getMessage()));
    }

    @ExceptionHandler(InvalidMonthlyMilestoneException.class)
    public ResponseEntity<ApiResponse<Void>> handleInvalidMonthlyMilestone(InvalidMonthlyMilestoneException ex) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(ApiResponse.error(ex.getMessage()));
    }

    @ExceptionHandler(MonthlyRewardNotEligibleException.class)
    public ResponseEntity<ApiResponse<Void>> handleMonthlyRewardNotEligible(MonthlyRewardNotEligibleException ex) {
        return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY)
                .body(ApiResponse.error(ex.getMessage()));
    }

    @ExceptionHandler(MonthlyRewardAlreadyClaimedException.class)
    public ResponseEntity<ApiResponse<Void>> handleMonthlyRewardAlreadyClaimed(MonthlyRewardAlreadyClaimedException ex) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(ApiResponse.error(ex.getMessage()));
    }

    // DB ?臭???蝝?銵????函雯嚗蔥??find-then-insert嚗酉?? username/email?偷?唳??嗆?臭??萇?嚗?
    // ?賢甇方??? 409 ?? 500???臭??葉?把末?蔥?澆歇??FriendshipService ?抒移皞???
    // FriendshipAlreadyExistsException嚗??末??靽歇摮??嚗ㄐ銝撖急香憟賢?閮隞亙?隤斗??嗡?銵???
    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<ApiResponse<Void>> handleDataIntegrityViolation(DataIntegrityViolationException ex) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(ApiResponse.error("鞈?銵?嚗?蝔??岫"));
    }

    // 璅???蝒?Friendship.@Version嚗????唾?鋡思蔥?潭??????銝?蝡嗆???
    // 敺?鈭斗???409 霈?蝡舫?閰佗??? 500??
    @ExceptionHandler(ObjectOptimisticLockingFailureException.class)
    public ResponseEntity<ApiResponse<Void>> handleOptimisticLockingFailure(ObjectOptimisticLockingFailureException ex) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(ApiResponse.error("憟賢???撌脰◤?嗡?隢??湔嚗??岫"));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiResponse<Void>> handleGeneral(Exception ex) {
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(ApiResponse.error("Internal server error"));
    }
}
