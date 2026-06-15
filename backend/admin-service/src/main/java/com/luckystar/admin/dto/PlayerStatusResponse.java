package com.luckystar.admin.dto;

/** 變更玩家狀態回應（T-051）。disabled=true 表示已加入 Redis 使用者級封鎖。 */
public record PlayerStatusResponse(
        Long playerId,
        boolean disabled
) {}
