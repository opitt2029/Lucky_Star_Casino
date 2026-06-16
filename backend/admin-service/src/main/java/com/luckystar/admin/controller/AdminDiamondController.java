package com.luckystar.admin.controller;

import com.luckystar.admin.dto.CardStatusFilter;
import com.luckystar.admin.dto.DiamondCardView;
import com.luckystar.admin.dto.GenerateCardsRequest;
import com.luckystar.admin.dto.GenerateCardsResponse;
import com.luckystar.admin.service.DiamondCardService;
import jakarta.validation.Valid;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 鑽石點數卡後台 API（T-105 生成 / T-106 列表）。{@code /admin/**} 需 ROLE_ADMIN。
 */
@RestController
@RequestMapping("/admin/diamond/cards")
public class AdminDiamondController {

    private static final int MAX_PAGE_SIZE = 200;

    private final DiamondCardService diamondCardService;

    public AdminDiamondController(DiamondCardService diamondCardService) {
        this.diamondCardService = diamondCardService;
    }

    @PostMapping
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<GenerateCardsResponse> generate(@Valid @RequestBody GenerateCardsRequest request) {
        GenerateCardsResponse response =
                diamondCardService.generateCards(request.count(), request.faceValue());
        return ResponseEntity.status(HttpStatus.CREATED).body(response);
    }

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
