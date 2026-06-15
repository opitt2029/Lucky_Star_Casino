package com.luckystar.admin.controller;

import com.luckystar.admin.dto.GmGrantRequest;
import com.luckystar.admin.dto.GmGrantResponse;
import com.luckystar.admin.service.GmRewardService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * GM 後台操作 API（T-055）。
 * 發幣為敏感操作，僅 {@code SUPER_ADMIN} 可呼叫（OPERATOR 會被 @PreAuthorize 擋成 403）。
 */
@Tag(name = "GM 工具", description = "T-055 GM 發幣等敏感操作（僅 SUPER_ADMIN）")
@RestController
@RequestMapping("/admin/gm")
public class GmController {

    private final GmRewardService gmRewardService;

    public GmController(GmRewardService gmRewardService) {
        this.gmRewardService = gmRewardService;
    }

    @Operation(summary = "GM 發幣", description = "向指定玩家發放星幣，僅 SUPER_ADMIN；OPERATOR 會被擋成 403。")
    @PostMapping("/grant")
    @PreAuthorize("hasRole('SUPER_ADMIN')")
    public ResponseEntity<GmGrantResponse> grant(
            @Valid @RequestBody GmGrantRequest req,
            Authentication authentication) {
        GmGrantResponse response = gmRewardService.grant(authentication.getName(), req);
        return ResponseEntity.ok(response);
    }
}
