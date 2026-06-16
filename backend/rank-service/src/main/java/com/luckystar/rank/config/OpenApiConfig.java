package com.luckystar.rank.config;

import io.swagger.v3.oas.annotations.OpenAPIDefinition;
import io.swagger.v3.oas.annotations.info.Info;
import io.swagger.v3.oas.annotations.enums.SecuritySchemeType;
import io.swagger.v3.oas.annotations.security.SecurityScheme;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import org.springframework.context.annotation.Configuration;

/**
 * Swagger UI / OpenAPI 設定（T-092）。
 *
 * <p>啟動後可在 {@code /swagger-ui.html} 檢視，{@code /v3/api-docs} 取得 OpenAPI 規格。
 * rank-service 無 spring-security，無需放行設定。對外 JWT 由 gateway 驗證，
 * 此處宣告 bearerAuth 僅供文件層級標註與線上測試帶 token。
 */
@Configuration
@OpenAPIDefinition(
    info = @Info(title = "排行榜服務 API", version = "v1",
                 description = "Lucky Star Casino 排行榜服務端點（全球榜、好友榜、今日贏幣王）"),
    security = @SecurityRequirement(name = "bearerAuth"))
@SecurityScheme(name = "bearerAuth", type = SecuritySchemeType.HTTP,
                scheme = "bearer", bearerFormat = "JWT")
public class OpenApiConfig {
}
