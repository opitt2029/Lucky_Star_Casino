package com.luckystar.wallet.config;

import io.swagger.v3.oas.annotations.OpenAPIDefinition;
import io.swagger.v3.oas.annotations.enums.SecuritySchemeType;
import io.swagger.v3.oas.annotations.info.Info;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.security.SecurityScheme;
import org.springframework.context.annotation.Configuration;

/**
 * Swagger / OpenAPI 設定（T-092）。
 *
 * <p>定義 Bearer JWT security scheme，讓 Swagger UI 可在 Authorize 對話框輸入 token。
 * Swagger 路徑由 SecurityConfig 放行。
 */
@Configuration
@OpenAPIDefinition(
        info = @Info(title = "錢包服務 API", version = "v1",
                description = "Lucky Star Casino 錢包服務端點（餘額/交易流水/贈幣/破產補助）"),
        security = @SecurityRequirement(name = "bearerAuth"))
@SecurityScheme(name = "bearerAuth", type = SecuritySchemeType.HTTP,
        scheme = "bearer", bearerFormat = "JWT")
public class OpenApiConfig {
}
