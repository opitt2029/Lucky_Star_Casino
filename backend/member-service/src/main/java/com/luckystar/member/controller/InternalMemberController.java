package com.luckystar.member.controller;

import com.luckystar.member.dto.ApiResponse;
import com.luckystar.member.dto.UpdateMemberStatusRequest;
import com.luckystar.member.service.PlayerService;
import jakarta.validation.Valid;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 服務間內部 API（{@code /internal/**}）。
 *
 * 認證由 {@link com.luckystar.member.security.InternalSecretFilter} 以 {@code X-Internal-Secret}
 * header 守門（比照 wallet-service 的內部帳務 API）；此路徑不經 gateway 對外曝露，
 * 只供其他後端服務直連（目前是 admin-service 停用/啟用玩家時呼叫）。
 */
@RestController
@RequestMapping("/internal/members")
@RequiredArgsConstructor
public class InternalMemberController {

    private final PlayerService playerService;

    /**
     * T-051 補完：後台停用/啟用玩家時，把狀態持久化寫入 members.status
     * （ACTIVE / DISABLED），與 Redis 即時封鎖標記互補。
     * 會員不存在丟 MemberNotFoundException → GlobalExceptionHandler 轉 404。
     */
    @PatchMapping("/{memberId}/status")
    public ResponseEntity<ApiResponse<Map<String, Object>>> updateStatus(
            @PathVariable Long memberId,
            @Valid @RequestBody UpdateMemberStatusRequest request) {
        String status = playerService.updateStatus(memberId, request.getEnabled());
        // 回傳內容只有兩個欄位且僅內部使用，用 Map 即可、不另開 DTO
        return ResponseEntity.ok(ApiResponse.success(
                Map.of("memberId", memberId, "status", status), "Status updated"));
    }
}
