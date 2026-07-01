package com.luckystar.member.config;

import io.swagger.v3.oas.annotations.OpenAPIDefinition;
import io.swagger.v3.oas.annotations.enums.SecuritySchemeType;
import io.swagger.v3.oas.annotations.info.Info;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.security.SecurityScheme;
import org.springframework.context.annotation.Configuration;

/**
 * Swagger / OpenAPI 設定（T-092）。
 *
 * <p>定義 Bearer JWT security scheme，讓 Swagger UI 可在 Authorize 對話框輸入 token，
 * 對受保護端點帶上 {@code Authorization: Bearer <jwt>}。Swagger 路徑由 SecurityConfig 放行。
 */
@Configuration
@OpenAPIDefinition(
        info = @Info(title = "會員服務 API", version = "v1",
                description = "Lucky Star Casino 會員服務端點（註冊/登入/好友/簽到/玩家資料）"),
        security = @SecurityRequirement(name = "bearerAuth"))
@SecurityScheme(name = "bearerAuth", type = SecuritySchemeType.HTTP,
        scheme = "bearer", bearerFormat = "JWT")
public class OpenApiConfig {
}
