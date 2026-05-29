package com.luckystar.gateway.controller;

import com.luckystar.gateway.dto.ApiResponse;
import io.github.resilience4j.circuitbreaker.CallNotPermittedException;
import org.springframework.cloud.gateway.support.ServerWebExchangeUtils;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

/**
 * 熔斷降級端點：當下游服務不可用時，Circuit Breaker 將請求 forward 至此 controller。
 *
 * <p>路徑 /fallback/** 已列入 JWT whitelist，不會被 JwtAuthenticationGlobalFilter 攔截。</p>
 */
@RestController
public class FallbackController {

    @RequestMapping("/fallback/{service}")
    public Mono<ResponseEntity<ApiResponse>> fallback(@PathVariable String service,
                                                      ServerWebExchange exchange) {
        Throwable cause = exchange.getAttribute(
                ServerWebExchangeUtils.CIRCUITBREAKER_EXECUTION_EXCEPTION_ATTR);
        // 熔斷開路時給出明確重試提示；其他錯誤（連線逾時等）給通用訊息
        String message = (cause instanceof CallNotPermittedException)
                ? service + " service is temporarily unavailable, please try again later"
                : service + " service is temporarily unavailable";
        return Mono.just(ResponseEntity
                .status(HttpStatus.SERVICE_UNAVAILABLE)
                .body(new ApiResponse(false, null, message)));
    }
}
