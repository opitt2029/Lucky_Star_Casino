package com.luckystar.admin.controller;

import com.luckystar.admin.dto.CardStatusFilter;
import com.luckystar.admin.dto.DiamondCardView;
import com.luckystar.admin.dto.GenerateCardsRequest;
import com.luckystar.admin.dto.GenerateCardsResponse;
import com.luckystar.admin.service.DiamondCardService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 鑽石點數卡後台 API（T-105 生成 / T-106 列表）。{@code /admin/**} 需 ROLE_ADMIN。
 * 生成為敏感操作（等同印出可兌換星幣的價值），僅 {@code SUPER_ADMIN} 可呼叫，比照 GM 發幣。
 */
@Tag(name = "鑽石點數卡", description = "T-105 生成 / T-106 列表")
@RestController
@RequestMapping("/admin/diamond/cards")
public class AdminDiamondController {

    private static final int MAX_PAGE_SIZE = 200;

    private final DiamondCardService diamondCardService;

    public AdminDiamondController(DiamondCardService diamondCardService) {
        this.diamondCardService = diamondCardService;
    }

    @Operation(summary = "生成點數卡", description = "批次生成指定面額的鑽石點數卡，僅 SUPER_ADMIN；OPERATOR 會被擋成 403。")
    @PostMapping
    @PreAuthorize("hasRole('SUPER_ADMIN')")
    public ResponseEntity<GenerateCardsResponse> generate(
            @Valid @RequestBody GenerateCardsRequest request,
            Authentication authentication) {
        GenerateCardsResponse response = diamondCardService.generateCards(
                authentication.getName(), request.count(), request.faceValue());
        return ResponseEntity.status(HttpStatus.CREATED).body(response);
    }

    @Operation(summary = "點數卡列表", description = "分頁查詢點數卡，可依 status 篩選（all/unused/used 等）。")
    @GetMapping
    public Page<DiamondCardView> list(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(defaultValue = "all") String status) {
        int safeSize = Math.min(Math.max(size, 1), MAX_PAGE_SIZE);
        int safePage = Math.max(page, 0);
        PageRequest pageable = PageRequest.of(safePage, safeSize, Sort.by(Sort.Direction.DESC, "id"));
        return diamondCardService.listCards(CardStatusFilter.from(status), pageable);
    }
}
