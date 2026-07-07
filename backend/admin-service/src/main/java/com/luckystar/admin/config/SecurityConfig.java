package com.luckystar.admin.config;

import com.luckystar.admin.security.AdminJwtAuthFilter;
import com.luckystar.admin.security.AdminJwtUtil;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

/**
 * 後台 Security 設定（T-050）。
 *
 * <ul>
 *   <li>{@code /admin/auth/**}：登入端點，放行（未帶 token 即可呼叫）。</li>
 *   <li>{@code /admin/**}：需 {@code ROLE_ADMIN}（SUPER_ADMIN / OPERATOR 皆具備）。</li>
 *   <li>{@code @EnableMethodSecurity}：開啟 {@code @PreAuthorize}，供 SUPER_ADMIN 限定操作。</li>
 * </ul>
 *
 * 過濾器以 {@code new AdminJwtAuthFilter(...)} 直接掛入鏈中（不註冊為 servlet bean，避免被
 * 容器對所有路徑重複套用）。
 */
@Configuration
@EnableWebSecurity
@EnableMethodSecurity
public class SecurityConfig {

    private final AdminJwtUtil adminJwtUtil;

    public SecurityConfig(AdminJwtUtil adminJwtUtil) {
        this.adminJwtUtil = adminJwtUtil;
    }

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
                .csrf(csrf -> csrf.disable())
                .sessionManagement(sm -> sm.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers("/admin/auth/**").permitAll()
                        // /actuator/prometheus 供本機 Prometheus scrape（gateway 不轉發 actuator 路徑）
                        .requestMatchers("/actuator/health", "/actuator/info", "/actuator/prometheus").permitAll()
                        // Swagger UI / OpenAPI 文件放行（T-092）。僅文件端點放寬；
                        // /admin/** 仍維持 ROLE_ADMIN，不可繞過授權。
                        .requestMatchers("/swagger-ui/**", "/swagger-ui.html", "/v3/api-docs/**").permitAll()
                        .requestMatchers("/admin/**").hasRole("ADMIN")
                        .anyRequest().authenticated())
                // 未認證（無 token / 玩家 token 驗章失敗）回 401；已認證但角色不足由預設
                // AccessDeniedHandler 回 403。否則純 filter 設定預設會把未認證也判成 403。
                .exceptionHandling(eh -> eh.authenticationEntryPoint(
                        (request, response, ex) -> response.sendError(HttpServletResponse.SC_UNAUTHORIZED)))
                .addFilterBefore(new AdminJwtAuthFilter(adminJwtUtil),
                        UsernamePasswordAuthenticationFilter.class);

        return http.build();
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }
}
