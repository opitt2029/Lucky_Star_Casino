package com.luckystar.gateway.dto;

/**
 * Gateway 統一 API 回應格式，供 FallbackController 使用。
 * 此 DTO 僅限 gateway-service 內部使用，不與下游服務共用。
 */
public record ApiResponse(boolean success, Object data, String message) {}
