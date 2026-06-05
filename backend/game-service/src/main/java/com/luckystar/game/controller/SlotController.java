package com.luckystar.game.controller;

import com.luckystar.game.common.ApiResponse;
import com.luckystar.game.dto.PrepareRoundRequest;
import com.luckystar.game.dto.PrepareRoundResponse;
import com.luckystar.game.dto.SpinRequest;
import com.luckystar.game.dto.SpinResponse;
import com.luckystar.game.service.SlotService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 老虎機遊戲 API（T-032 + T-033）。對外前綴 {@code /api/v1/game/slot}，由 gateway 路由並驗證 JWT。
 *
 * <p>玩家身分取自 gateway 注入的 {@code X-User-Id} header（= JWT subject = player_id）；
 * 服務層不再自行驗 JWT。
 *
 * <p>提供兩種玩法：
 * <ul>
 *   <li>{@code POST /spin}：單次模式（相容前端一次呼叫）。</li>
 *   <li>{@code POST /round} → {@code POST /round/{roundId}/settle}：兩階段 commit-ahead——
 *       先取得 serverSeedHash 承諾，再結算並揭露 serverSeed（T-033）。</li>
 * </ul>
 */
@RestController
@RequestMapping("/api/v1/game/slot")
@RequiredArgsConstructor
public class SlotController {

    private final SlotService slotService;

    /**
     * 單次模式：下注並轉動老虎機，於同一回應揭露 serverSeed。
     */
    @PostMapping("/spin")
    public ResponseEntity<ApiResponse<SpinResponse>> spin(
            @RequestHeader(value = "X-User-Id", required = false) String playerIdStr,
            @Valid @RequestBody SpinRequest request) {

        Long playerId = parsePlayerId(playerIdStr);
        if (playerId == null) {
            return badPlayerId(playerIdStr);
        }
        SpinResponse result = slotService.spin(playerId, request.getBet(), request.getClientSeed());
        return ResponseEntity.ok(ApiResponse.ok(result));
    }

    /**
     * commit-ahead 第一階段：開局，回傳 serverSeedHash 承諾（不揭露 serverSeed、不扣款）。
     */
    @PostMapping("/round")
    public ResponseEntity<ApiResponse<PrepareRoundResponse>> prepareRound(
            @RequestHeader(value = "X-User-Id", required = false) String playerIdStr,
            @Valid @RequestBody PrepareRoundRequest request) {

        Long playerId = parsePlayerId(playerIdStr);
        if (playerId == null) {
            return badPlayerId(playerIdStr);
        }
        PrepareRoundResponse result = slotService.prepareRound(
                playerId, request.getBet(), request.getClientSeed());
        return ResponseEntity.ok(ApiResponse.ok(result));
    }

    /**
     * commit-ahead 第二階段：結算指定對局，扣款、轉動、派彩並揭露 serverSeed。
     */
    @PostMapping("/round/{roundId}/settle")
    public ResponseEntity<ApiResponse<SpinResponse>> settle(
            @RequestHeader(value = "X-User-Id", required = false) String playerIdStr,
            @PathVariable String roundId) {

        Long playerId = parsePlayerId(playerIdStr);
        if (playerId == null) {
            return badPlayerId(playerIdStr);
        }
        SpinResponse result = slotService.settle(playerId, roundId);
        return ResponseEntity.ok(ApiResponse.ok(result));
    }

    /**
     * 解析 gateway 注入的 X-User-Id；缺漏或非數字回 {@code null}（由呼叫端轉 400）。
     */
    private static Long parsePlayerId(String playerIdStr) {
        if (playerIdStr == null || playerIdStr.isBlank()) {
            return null;
        }
        try {
            return Long.parseLong(playerIdStr.trim());
        } catch (NumberFormatException ex) {
            return null;
        }
    }

    private static <T> ResponseEntity<ApiResponse<T>> badPlayerId(String playerIdStr) {
        String message = (playerIdStr == null || playerIdStr.isBlank())
                ? "Missing X-User-Id header"
                : "Invalid X-User-Id header";
        return ResponseEntity.badRequest().body(ApiResponse.error(message));
    }
}
