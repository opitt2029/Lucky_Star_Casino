package com.luckystar.game.controller;

import com.luckystar.game.common.ApiResponse;
import com.luckystar.game.dto.FishingEndResponse;
import com.luckystar.game.dto.FishingSessionView;
import com.luckystar.game.dto.FishingShotVerifyResponse;
import com.luckystar.game.dto.FishingShotsRequest;
import com.luckystar.game.dto.FishingShotsResponse;
import com.luckystar.game.dto.FishingStartRequest;
import com.luckystar.game.service.FishingService;
import jakarta.validation.Valid;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 捕魚機 API。對外前綴 {@code /api/v1/game/fishing}，由 gateway 路由並驗證 JWT，
 * 玩家身分取自注入的 {@code X-User-Id} header（比照 slot / baccarat）。
 *
 * <ul>
 *   <li>{@code POST /session/start}：buy-in 開場（冪等扣款；已有場次則續玩）。</li>
 *   <li>{@code GET  /session/active}：查進行中場次（斷線重連恢復）。</li>
 *   <li>{@code POST /{sessionId}/shots}：批次射擊（只動局內餘額）。</li>
 *   <li>{@code POST /{sessionId}/end}：結算（剩餘局內餘額回 wallet、揭露 serverSeed）。</li>
 *   <li>{@code GET  /{sessionId}/verify-shot}：結算後逐發公平性驗證。</li>
 * </ul>
 */
@RestController
@RequestMapping("/api/v1/game/fishing")
@RequiredArgsConstructor
public class FishingController {

    private final FishingService fishingService;

    @PostMapping("/session/start")
    public ResponseEntity<ApiResponse<FishingSessionView>> start(
            @RequestHeader(value = "X-User-Id", required = false) String playerIdStr,
            @Valid @RequestBody FishingStartRequest request) {

        Long playerId = parsePlayerId(playerIdStr);
        if (playerId == null) {
            return badPlayerId(playerIdStr);
        }
        FishingSessionView view = fishingService.start(
                playerId, request.getBuyIn(), request.getCannonLevel(), request.getClientSeed());
        return ResponseEntity.ok(ApiResponse.ok(view));
    }

    @GetMapping("/session/active")
    public ResponseEntity<ApiResponse<FishingSessionView>> active(
            @RequestHeader(value = "X-User-Id", required = false) String playerIdStr) {

        Long playerId = parsePlayerId(playerIdStr);
        if (playerId == null) {
            return badPlayerId(playerIdStr);
        }
        Optional<FishingSessionView> view = fishingService.findActive(playerId);
        // 無進行中場次回 data=null（前端據此顯示 buy-in 面板）
        return ResponseEntity.ok(ApiResponse.ok(view.orElse(null)));
    }

    @PostMapping("/{sessionId}/shots")
    public ResponseEntity<ApiResponse<FishingShotsResponse>> shots(
            @RequestHeader(value = "X-User-Id", required = false) String playerIdStr,
            @PathVariable String sessionId,
            @Valid @RequestBody FishingShotsRequest request) {

        Long playerId = parsePlayerId(playerIdStr);
        if (playerId == null) {
            return badPlayerId(playerIdStr);
        }
        FishingShotsResponse response = fishingService.shots(playerId, sessionId, request.getShots(), request.isFortuneFull());
        return ResponseEntity.ok(ApiResponse.ok(response));
    }

    @PostMapping("/{sessionId}/end")
    public ResponseEntity<ApiResponse<FishingEndResponse>> end(
            @RequestHeader(value = "X-User-Id", required = false) String playerIdStr,
            @PathVariable String sessionId) {

        Long playerId = parsePlayerId(playerIdStr);
        if (playerId == null) {
            return badPlayerId(playerIdStr);
        }
        FishingEndResponse response = fishingService.end(playerId, sessionId);
        return ResponseEntity.ok(ApiResponse.ok(response));
    }

    /** 結算後逐發公平性驗證（唯讀，不需登入者本人也可驗）。 */
    @GetMapping("/{sessionId}/verify-shot")
    public ResponseEntity<ApiResponse<FishingShotVerifyResponse>> verifyShot(
            @PathVariable String sessionId,
            @RequestParam long shotSeq,
            @RequestParam String fishType,
            @RequestParam long betPerShot) {

        FishingShotVerifyResponse response = fishingService.verifyShot(sessionId, shotSeq, fishType, betPerShot);
        return ResponseEntity.ok(ApiResponse.ok(response));
    }

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
