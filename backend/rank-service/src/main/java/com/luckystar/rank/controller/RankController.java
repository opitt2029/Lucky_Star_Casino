package com.luckystar.rank.controller;

import com.luckystar.rank.dto.RankEntryResponse;
import com.luckystar.rank.service.RankService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.List;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/rank")
@Tag(name = "排行榜", description = "全球榜、好友榜、今日贏幣王查詢")
public class RankController {

    private final RankService rankService;

    public RankController(RankService rankService) {
        this.rankService = rankService;
    }

    @Operation(summary = "全球持幣榜 Top 100")
    @GetMapping({"/global", "/global/top"})
    public List<RankEntryResponse> getGlobalTop100() {
        return rankService.getTopGlobalCoins();
    }

    @GetMapping("/global/{playerId}")
    public ResponseEntity<RankEntryResponse> getGlobalRank(@PathVariable Long playerId) {
        return rankService.getGlobalRank(playerId)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    @Operation(summary = "好友持幣榜")
    @GetMapping("/friends")
    public List<RankEntryResponse> getFriendsLeaderboard(
            @RequestHeader("X-User-Id") Long playerId) {
        return rankService.getTopFriendCoins(playerId);
    }

    @GetMapping("/friends/me")
    public ResponseEntity<RankEntryResponse> getMyFriendRank(
            @RequestHeader("X-User-Id") Long playerId) {
        return rankService.getFriendRank(playerId)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    @Operation(summary = "今日贏幣王榜")
    @GetMapping("/daily/winnings")
    public List<RankEntryResponse> getDailyWinnings(
            @RequestParam(defaultValue = "100") int limit) {
        return rankService.getTopDailyWinnings(limit);
    }

    @GetMapping("/daily/winnings/me")
    public ResponseEntity<RankEntryResponse> getMyDailyWinnings(
            @RequestHeader("X-User-Id") Long playerId) {
        return rankService.getDailyWinningsRank(playerId)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }
}
