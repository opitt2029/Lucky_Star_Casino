package com.luckystar.game.controller;

import com.luckystar.game.common.ApiResponse;
import com.luckystar.game.dto.FishingEndResponse;
import com.luckystar.game.dto.FishingSessionView;
import com.luckystar.game.dto.FishingShotVerifyResponse;
import com.luckystar.game.dto.FishingShotsRequest;
import com.luckystar.game.dto.FishingShotsResponse;
import com.luckystar.game.dto.FishingStartRequest;
import com.luckystar.game.dto.FishingTopUpRequest;
import com.luckystar.game.dto.FishingTopUpResponse;
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
 * ??璈?API??憭?蝬?{@code /api/v1/game/fishing}嚗 gateway 頝舐銝阡?霅?JWT嚗?
 * ?拙振頨怠??瘜典??{@code X-User-Id} header嚗???slot / baccarat嚗?
 *
 * <ul>
 *   <li>{@code POST /session/start}嚗uy-in ?嚗蝑甈橘?撌脫??湔活???抬???/li>
 *   <li>{@code GET  /session/active}嚗?脰?銝剖甈∴??瑞???敺抬???/li>
 *   <li>{@code POST /{sessionId}/shots}嚗甈∪????芸?撅?折?憿???/li>
 *   <li>{@code POST /{sessionId}/end}嚗?蝞??拚?撅?折?憿? wallet???serverSeed嚗?/li>
 *   <li>{@code GET  /{sessionId}/verify-shot}嚗?蝞???砍像?折?霅?/li>
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
                playerId, request.getBuyIn(), request.getCannonLevel(),
                request.getBetPerShot(), request.getClientSeed());
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
        // ?⊿脰?銝剖甈∪? data=null嚗?蝡舀?甇日＊蝷?buy-in ?Ｘ嚗?
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
        FishingShotsResponse response = fishingService.shots(playerId, sessionId, request.getShots());
        return ResponseEntity.ok(ApiResponse.ok(response));
    }


    @PostMapping("/{sessionId}/top-up")
    public ResponseEntity<ApiResponse<FishingTopUpResponse>> topUp(
            @RequestHeader(value = "X-User-Id", required = false) String playerIdStr,
            @PathVariable String sessionId,
            @Valid @RequestBody FishingTopUpRequest request) {

        Long playerId = parsePlayerId(playerIdStr);
        if (playerId == null) {
            return badPlayerId(playerIdStr);
        }
        FishingTopUpResponse response = fishingService.topUp(
                playerId, sessionId, request.getAmount(), request.getClientRequestId());
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

    /** 蝯?敺?砍像?折?霅??航?嚗???餃?鈭箔??舫?嚗?*/
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
