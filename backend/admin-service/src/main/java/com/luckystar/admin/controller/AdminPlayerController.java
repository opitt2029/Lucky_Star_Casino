package com.luckystar.admin.controller;

import com.luckystar.admin.dto.PlayerDetail;
import com.luckystar.admin.dto.PlayerStatusRequest;
import com.luckystar.admin.dto.PlayerStatusResponse;
import com.luckystar.admin.dto.PlayerSummary;
import com.luckystar.admin.service.AdminPlayerService;
import jakarta.validation.Valid;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 後台玩家帳號管理 API（T-051）。{@code /admin/**} 由 SecurityConfig 要求 ROLE_ADMIN。
 */
@RestController
@RequestMapping("/admin/players")
public class AdminPlayerController {

    private static final int MAX_PAGE_SIZE = 100;

    private final AdminPlayerService adminPlayerService;

    public AdminPlayerController(AdminPlayerService adminPlayerService) {
        this.adminPlayerService = adminPlayerService;
    }

    @GetMapping
    public Page<PlayerSummary> listPlayers(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(required = false) String keyword) {
        int safeSize = Math.min(Math.max(size, 1), MAX_PAGE_SIZE);
        int safePage = Math.max(page, 0);
        PageRequest pageable = PageRequest.of(safePage, safeSize, Sort.by(Sort.Direction.DESC, "id"));
        return adminPlayerService.listPlayers(keyword, pageable);
    }

    @GetMapping("/{playerId}")
    public ResponseEntity<PlayerDetail> getPlayer(@PathVariable Long playerId) {
        return adminPlayerService.getPlayerDetail(playerId)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    @PatchMapping("/{playerId}/status")
    public ResponseEntity<PlayerStatusResponse> setStatus(
            @PathVariable Long playerId,
            @Valid @RequestBody PlayerStatusRequest request) {
        return adminPlayerService.setStatus(playerId, request.enabled())
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }
}
