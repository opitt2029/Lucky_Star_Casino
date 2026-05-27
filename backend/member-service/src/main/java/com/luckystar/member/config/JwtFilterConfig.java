package com.luckystar.member.config;

import com.luckystar.member.security.JwtAuthenticationFilter;
import com.luckystar.member.security.JwtTokenProvider;
import com.luckystar.member.service.TokenRedisService;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
@RequiredArgsConstructor
public class JwtFilterConfig {

    private final JwtTokenProvider jwtTokenProvider;
    private final TokenRedisService tokenRedisService;

    @Bean
    public JwtAuthenticationFilter jwtAuthenticationFilter() {
        return new JwtAuthenticationFilter(jwtTokenProvider, tokenRedisService);
    }

    /**
     * 禁止 Spring Boot 將此 filter 自動註冊為 Servlet filter，
     * 避免與 SecurityFilterChain 的 addFilterBefore 造成雙重執行。
     */
    @Bean
    public FilterRegistrationBean<JwtAuthenticationFilter> jwtFilterRegistration(
            JwtAuthenticationFilter jwtAuthenticationFilter) {
        FilterRegistrationBean<JwtAuthenticationFilter> registration =
                new FilterRegistrationBean<>(jwtAuthenticationFilter);
        registration.setEnabled(false);
        return registration;
    }
}
