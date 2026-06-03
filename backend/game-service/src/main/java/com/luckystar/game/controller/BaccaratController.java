package com.luckystar.game.controller;

import com.luckystar.game.common.ApiResponse;
import com.luckystar.game.dto.BaccaratBetRequest;
import com.luckystar.game.dto.BaccaratBetResponse;
import com.luckystar.game.dto.BaccaratResultResponse;
import com.luckystar.game.service.BaccaratService;
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
 * 百家樂遊戲 API（T-035）。對外前綴 {@code /api/v1/game/baccarat}，由 gateway 路由並驗證 JWT。
 *
 * <p>兩階段 commit-ahead：
 * <ul>
 *   <li>{@code POST /bet}：一局多區押注並扣款，回傳 serverSeedHash 承諾（不揭露 serverSeed）。</li>
 *   <li>{@code POST /{roundId}/result}：結算本局，發牌、各區派彩、揭露 serverSeed。</li>
 * </ul>
 *
 * <p>玩家身分取自 gateway 注入的 {@code X-User-Id} header。
 */
@RestController
@RequestMapping("/api/v1/game/baccarat")
@RequiredArgsConstructor
public class BaccaratController {

    private final BaccaratService baccaratService;

    /** 下注（多區）並扣款。 */
    @PostMapping("/bet")
    public ResponseEntity<ApiResponse<BaccaratBetResponse>> bet(
            @RequestHeader(value = "X-User-Id", required = false) String playerIdStr,
            @Valid @RequestBody BaccaratBetRequest request) {

        Long playerId = parsePlayerId(playerIdStr);
        if (playerId == null) {
            return badPlayerId(playerIdStr);
        }
        BaccaratBetResponse result = baccaratService.placeBet(
                playerId, request.getPlayer(), request.getBanker(), request.getTie(), request.getClientSeed());
        return ResponseEntity.ok(ApiResponse.ok(result));
    }

    /** 結算指定對局。 */
    @PostMapping("/{roundId}/result")
    public ResponseEntity<ApiResponse<BaccaratResultResponse>> result(
            @RequestHeader(value = "X-User-Id", required = false) String playerIdStr,
            @PathVariable String roundId) {

        Long playerId = parsePlayerId(playerIdStr);
        if (playerId == null) {
            return badPlayerId(playerIdStr);
        }
        BaccaratResultResponse result = baccaratService.settle(playerId, roundId);
        return ResponseEntity.ok(ApiResponse.ok(result));
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
