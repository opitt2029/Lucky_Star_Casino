package com.luckystar.member.config;

import com.luckystar.member.security.InternalSecretFilter;
import com.luckystar.member.security.JwtAuthenticationFilter;
import com.luckystar.member.security.JwtTokenProvider;
import com.luckystar.member.service.TokenRedisService;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

@Configuration
@EnableWebSecurity
public class SecurityConfig {

    private final JwtTokenProvider jwtTokenProvider;
    private final TokenRedisService tokenRedisService;
    private final InternalSecretFilter internalSecretFilter;

    public SecurityConfig(JwtTokenProvider jwtTokenProvider,
                          TokenRedisService tokenRedisService,
                          InternalSecretFilter internalSecretFilter) {
        this.jwtTokenProvider = jwtTokenProvider;
        this.tokenRedisService = tokenRedisService;
        this.internalSecretFilter = internalSecretFilter;
    }

    @Bean
    public JwtAuthenticationFilter jwtAuthenticationFilter() {
        return new JwtAuthenticationFilter(jwtTokenProvider, tokenRedisService);
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .csrf(AbstractHttpConfigurer::disable)
            .formLogin(AbstractHttpConfigurer::disable)
            .httpBasic(AbstractHttpConfigurer::disable)
            .sessionManagement(session ->
                session.sessionCreationPolicy(SessionCreationPolicy.STATELESS)
            )
            .authorizeHttpRequests(auth -> auth
                // T-010~T-012 auth endpoints — 公開
                .requestMatchers("/api/v1/auth/**").permitAll()
                // 服務間 internal 路由 — 由 InternalSecretFilter 自行驗證，不需要 JWT
                .requestMatchers("/internal/**").permitAll()
                // 健康檢查
                .requestMatchers("/actuator/health").permitAll()
                // 其他所有請求需認證
                .anyRequest().authenticated()
            )
            // 執行順序：InternalSecretFilter → JwtAuthenticationFilter → UPAF
            // 先將 JwtAuthenticationFilter 掛在 UPAF 之前，再把 InternalSecretFilter 掛在其之前
            .addFilterBefore(jwtAuthenticationFilter(), UsernamePasswordAuthenticationFilter.class)
            .addFilterBefore(internalSecretFilter, JwtAuthenticationFilter.class);

        return http.build();
    }

    // T-010 宣告的 Bean — 不可移動或刪除
    @Bean
    public BCryptPasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }
}
