package com.luckystar.admin.dto;

import com.luckystar.admin.postgres.entity.AdminAlert;
import java.time.LocalDateTime;

/**
 * 異常告警查詢回應（T-054 查詢端）。
 * 與 entity 欄位一對一，仍走 DTO 隔離：避免 API 形狀直接綁死 JPA entity（比照其他後台端點慣例）。
 */
public record AlertView(
        Long id,
        Long playerId,
        String alertType,
        String detail,
        boolean resolved,
        String resolvedBy,
        LocalDateTime resolvedAt,
        LocalDateTime createdAt) {

    public static AlertView from(AdminAlert alert) {
        return new AlertView(
                alert.getId(),
                alert.getPlayerId(),
                alert.getAlertType(),
                alert.getDetail(),
                alert.isResolved(),
                alert.getResolvedBy(),
                alert.getResolvedAt(),
                alert.getCreatedAt());
    }
}
