package com.luckystar.notification.config;

import io.swagger.v3.oas.annotations.OpenAPIDefinition;
import io.swagger.v3.oas.annotations.enums.SecuritySchemeType;
import io.swagger.v3.oas.annotations.info.Info;
import io.swagger.v3.oas.annotations.security.SecurityScheme;
import org.springframework.context.annotation.Configuration;

/**
 * Swagger / OpenAPI metadata for notification-service (T-092).
 *
 * <p>The service exposes STOMP over {@code /ws}; clients authenticate the
 * CONNECT frame with the same player Bearer JWT used by member/gateway.
 * Runtime broadcasts are delivered on {@code /user/queue/notifications} and
 * {@code /topic/rank}; Kafka inputs are {@code notification.push},
 * {@code game.result}, and {@code rank.update}.
 */
@Configuration
@OpenAPIDefinition(
        info = @Info(
                title = "Lucky Star Notification Service API",
                version = "v1",
                description = "WebSocket/STOMP notification bridge. Endpoint: /ws; private queue: /user/queue/notifications; public rank topic: /topic/rank."))
@SecurityScheme(name = "bearerAuth", type = SecuritySchemeType.HTTP,
        scheme = "bearer", bearerFormat = "JWT")
public class OpenApiConfig {
}
