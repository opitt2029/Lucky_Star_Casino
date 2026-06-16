package com.luckystar.game.controller;

import com.luckystar.game.common.ApiResponse;
import com.luckystar.game.dto.RtpStatView;
import com.luckystar.game.service.RtpStatsService;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 遊戲 RTP 統計查詢 API（T-037）。對外前綴 {@code /api/v1/game/rtp}。
 *
 * <p>回傳各遊戲最新一筆 RTP 統計（由排程每小時更新），供 Admin 監控實際 RTP 是否偏離設計值。
 */
@RestController
@RequestMapping("/api/v1/game/rtp")
@RequiredArgsConstructor
public class RtpController {

    private final RtpStatsService rtpStatsService;

    /** 取各遊戲最新 RTP 統計。 */
    @GetMapping
    public ResponseEntity<ApiResponse<List<RtpStatView>>> latest() {
        return ResponseEntity.ok(ApiResponse.ok(rtpStatsService.latestStats()));
    }
}
