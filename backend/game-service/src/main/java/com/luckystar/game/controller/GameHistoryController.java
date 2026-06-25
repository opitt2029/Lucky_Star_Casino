package com.luckystar.game.controller;

import com.luckystar.game.common.ApiResponse;
import com.luckystar.game.dto.GameHistoryResponse;
import com.luckystar.game.service.GameHistoryService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 玩家「遊戲紀錄」API。對外前綴 {@code /api/v1/game/history}，由 gateway 路由並驗證 JWT。
 *
 * <p>玩家身分取自 gateway 注入的 {@code X-User-Id} header（= JWT subject = player_id）；
 * 只回傳該玩家自己的注單，分頁形狀與錢包交易紀錄一致。
 */
@RestController
@RequestMapping("/api/v1/game/history")
@RequiredArgsConstructor
@Tag(name = "遊戲紀錄", description = "玩家注單分頁查詢（流水號 / 局號 / 餘額變化 / 毫秒時間戳）")
public class GameHistoryController {

    private final GameHistoryService gameHistoryService;

    @Operation(summary = "查詢遊戲紀錄", description = "分頁回傳玩家注單，含流水號、局號、投注前後餘額與毫秒下注/派彩時間")
    @GetMapping
    public ResponseEntity<ApiResponse<GameHistoryResponse>> history(
            @RequestHeader(value = "X-User-Id", required = false) String playerIdStr,
            @RequestParam(value = "gameType", required = false) String gameType,
            @RequestParam(value = "page", defaultValue = "1") int page,
            @RequestParam(value = "pageSize", defaultValue = "10") int pageSize) {

        Long playerId = parsePlayerId(playerIdStr);
        if (playerId == null) {
            String message = (playerIdStr == null || playerIdStr.isBlank())
                    ? "Missing X-User-Id header"
                    : "Invalid X-User-Id header";
            return ResponseEntity.badRequest().body(ApiResponse.error(message));
        }
        GameHistoryResponse result = gameHistoryService.history(playerId, gameType, page, pageSize);
        return ResponseEntity.ok(ApiResponse.ok(result));
    }

    /** 解析 gateway 注入的 X-User-Id；缺漏或非數字回 {@code null}（由呼叫端轉 400）。 */
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
}
