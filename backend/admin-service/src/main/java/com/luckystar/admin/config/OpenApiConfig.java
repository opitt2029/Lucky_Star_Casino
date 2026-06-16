package com.luckystar.admin.config;

import io.swagger.v3.oas.annotations.OpenAPIDefinition;
import io.swagger.v3.oas.annotations.info.Info;
import io.swagger.v3.oas.annotations.enums.SecuritySchemeType;
import io.swagger.v3.oas.annotations.security.SecurityScheme;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import org.springframework.context.annotation.Configuration;

/**
 * Swagger UI / OpenAPI 設定（T-092）。
 *
 * <p>後台採獨立 ADMIN JWT（Bearer），於 Swagger UI 右上「Authorize」貼上 {@code <token>} 即可
 * 對 {@code /admin/**} 端點帶上 {@code Authorization: Bearer <token>} 試打。</p>
 */
@Configuration
@OpenAPIDefinition(
    info = @Info(title = "Admin 後台 API", version = "v1",
                 description = "Lucky Star Casino 後台管理端點（需 ADMIN JWT）"),
    security = @SecurityRequirement(name = "adminBearerAuth"))
@SecurityScheme(name = "adminBearerAuth", type = SecuritySchemeType.HTTP,
                scheme = "bearer", bearerFormat = "JWT")
public class OpenApiConfig {
}
