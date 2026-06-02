package com.luckystar.game.controller;

import com.luckystar.game.common.ApiResponse;
import com.luckystar.game.dto.SpinRequest;
import com.luckystar.game.dto.SpinResponse;
import com.luckystar.game.service.SlotService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 老虎機遊戲 API（T-032）。對外前綴 {@code /api/v1/game/slot}，由 gateway 路由並驗證 JWT。
 *
 * <p>玩家身分取自 gateway 注入的 {@code X-User-Id} header（= JWT subject = player_id）；
 * 服務層不再自行驗 JWT。
 */
@RestController
@RequestMapping("/api/v1/game/slot")
@RequiredArgsConstructor
public class SlotController {

    private final SlotService slotService;

    /**
     * 下注並轉動老虎機。
     *
     * @param playerIdStr gateway 注入的玩家 ID
     * @param request     下注內容（金額、可選 client seed）
     */
    @PostMapping("/spin")
    public ResponseEntity<ApiResponse<SpinResponse>> spin(
            @RequestHeader(value = "X-User-Id", required = false) String playerIdStr,
            @Valid @RequestBody SpinRequest request) {

        if (playerIdStr == null || playerIdStr.isBlank()) {
            return ResponseEntity.badRequest().body(ApiResponse.error("Missing X-User-Id header"));
        }
        long playerId;
        try {
            playerId = Long.parseLong(playerIdStr.trim());
        } catch (NumberFormatException ex) {
            return ResponseEntity.badRequest().body(ApiResponse.error("Invalid X-User-Id header"));
        }

        SpinResponse result = slotService.spin(playerId, request.getBet(), request.getClientSeed());
        return ResponseEntity.ok(ApiResponse.ok(result));
    }
}
