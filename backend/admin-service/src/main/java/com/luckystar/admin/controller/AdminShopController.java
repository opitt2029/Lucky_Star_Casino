package com.luckystar.admin.controller;

import com.luckystar.admin.dto.ShopItemRequest;
import com.luckystar.admin.dto.ShopItemUpdateRequest;
import com.luckystar.admin.dto.ShopItemView;
import com.luckystar.admin.service.AdminShopService;
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
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 禮品商城目錄後台 API（ADR-006）。{@code /admin/**} 需 ROLE_ADMIN。
 * 新增/改價/上下架皆寫 {@code admin_action_logs} 稽核。
 */
@Tag(name = "禮品商城目錄", description = "後台管理商城商品（新增/改價/上下架）")
@RestController
@RequestMapping("/admin/shop/items")
public class AdminShopController {

    private static final int MAX_PAGE_SIZE = 200;

    private final AdminShopService adminShopService;

    public AdminShopController(AdminShopService adminShopService) {
        this.adminShopService = adminShopService;
    }

    @Operation(summary = "新增商品", description = "新增一個商城商品；item_code 需唯一（重複 → 409）。")
    @PostMapping
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<ShopItemView> create(
            @Valid @RequestBody ShopItemRequest request,
            Authentication authentication) {
        ShopItemView view = adminShopService.create(authentication.getName(), request);
        return ResponseEntity.status(HttpStatus.CREATED).body(view);
    }

    @Operation(summary = "更新商品", description = "部分更新（改價/上下架/改名等）；商品不存在 → 404。")
    @PutMapping("/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<ShopItemView> update(
            @PathVariable Long id,
            @Valid @RequestBody ShopItemUpdateRequest request,
            Authentication authentication) {
        return ResponseEntity.ok(adminShopService.update(authentication.getName(), id, request));
    }

    @Operation(summary = "商品列表", description = "分頁查詢全部商品（含已下架），依 sort_order、id 排序。")
    @GetMapping
    public Page<ShopItemView> list(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        int safeSize = Math.min(Math.max(size, 1), MAX_PAGE_SIZE);
        int safePage = Math.max(page, 0);
        PageRequest pageable = PageRequest.of(safePage, safeSize,
                Sort.by(Sort.Direction.ASC, "sortOrder", "id"));
        return adminShopService.list(pageable);
    }
}
