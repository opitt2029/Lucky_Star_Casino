package com.luckystar.admin.dto;

import java.time.LocalDateTime;

/** 玩家列表單筆（T-051）。 */
public record PlayerSummary(
        Long playerId,
        String username,
        String nickname,
        String role,
        String status,
        boolean disabled,
        LocalDateTime createdAt
) {}
