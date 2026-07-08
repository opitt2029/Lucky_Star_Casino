package com.luckystar.admin.controller;

import com.luckystar.admin.dto.AlertView;
import com.luckystar.admin.service.AdminAlertService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 後台異常告警 API（T-054 查詢端）。{@code /admin/**} 由 SecurityConfig 要求 ROLE_ADMIN。
 */
@Tag(name = "異常告警", description = "T-054 異常玩家告警查詢與處理")
@RestController
@RequestMapping("/admin/alerts")
public class AdminAlertController {

    private static final int MAX_PAGE_SIZE = 100;

    private final AdminAlertService adminAlertService;

    public AdminAlertController(AdminAlertService adminAlertService) {
        this.adminAlertService = adminAlertService;
    }

    @Operation(summary = "告警列表",
            description = "分頁查詢異常告警（新到舊）；alertType（BIG_WIN / HIGH_FREQUENCY / "
                    + "ABNORMAL_TRANSFER）與 resolved 皆可選，不帶即不篩選。")
    @GetMapping
    public Page<AlertView> listAlerts(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(required = false) String alertType,
            @RequestParam(required = false) Boolean resolved) {
        int safeSize = Math.min(Math.max(size, 1), MAX_PAGE_SIZE);
        int safePage = Math.max(page, 0);
        // id 自增 = 時間序，排 id DESC 即新到舊，且用主鍵排序免掃 created_at
        PageRequest pageable = PageRequest.of(safePage, safeSize, Sort.by(Sort.Direction.DESC, "id"));
        return adminAlertService.list(alertType, resolved, pageable);
    }

    @Operation(summary = "標記告警已處理",
            description = "冪等；記錄處理者（resolved_by）並落稽核；告警不存在回 404。")
    @PatchMapping("/{alertId}/resolve")
    public ResponseEntity<AlertView> resolveAlert(
            @PathVariable Long alertId, Authentication authentication) {
        return adminAlertService.resolve(alertId, authentication.getName())
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }
}
