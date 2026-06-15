package com.luckystar.admin.dto;

/**
 * GM 發幣回應（T-055）。
 * status 固定 {@code QUEUED}：已寄出 wallet.credit.request 指令，由 wallet-service 非同步入帳（ADR-002）。
 */
public record GmGrantResponse(
        Long playerId,
        Long amount,
        String idempotencyKey,
        String status
) {}
