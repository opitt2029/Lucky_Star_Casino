package com.luckystar.rank.controller;

import com.luckystar.rank.dto.RankEntryResponse;
import com.luckystar.rank.service.RankService;
import java.util.List;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/rank")
public class RankController {

    private final RankService rankService;

    public RankController(RankService rankService) {
        this.rankService = rankService;
    }

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
}
