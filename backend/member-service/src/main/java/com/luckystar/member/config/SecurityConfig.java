package com.luckystar.member.config;

import com.luckystar.member.security.InternalSecretFilter;
import com.luckystar.member.security.JwtAuthenticationFilter;
import com.luckystar.member.security.SocialOAuthFailureHandler;
import com.luckystar.member.security.SocialOAuthSuccessHandler;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.client.oidc.authentication.OidcIdTokenDecoderFactory;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.jose.jws.JwsAlgorithm;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.JwtDecoderFactory;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

@Configuration
@EnableWebSecurity
@RequiredArgsConstructor
public class SecurityConfig {

    private final JwtAuthenticationFilter jwtAuthenticationFilter;
    private final InternalSecretFilter internalSecretFilter;
    private final SocialOAuthSuccessHandler socialOAuthSuccessHandler;
    private final SocialOAuthFailureHandler socialOAuthFailureHandler;

    @Bean
    public JwtDecoderFactory<ClientRegistration> idTokenDecoderFactory() {
        OidcIdTokenDecoderFactory factory = new OidcIdTokenDecoderFactory();
        factory.setJwsAlgorithmResolver(registration ->
                resolveIdTokenAlgorithm(registration.getRegistrationId()));
        return factory;
    }

    public static JwsAlgorithm resolveIdTokenAlgorithm(String registrationId) {
        return "line".equals(registrationId)
                ? MacAlgorithm.HS256
                : SignatureAlgorithm.RS256;
    }

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
            .csrf(csrf -> csrf.disable())
            .sessionManagement(sm ->
                // 一般 API 仍使用 JWT；只有 OAuth authorization-code 握手需要短暫 HttpSession
                // 保存 state，callback 完成後 success/failure handler 立即銷毀。
                sm.sessionCreationPolicy(SessionCreationPolicy.IF_REQUIRED))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/api/v1/auth/**").permitAll()
                .requestMatchers("/internal/**").permitAll()
                // /actuator/prometheus 供本機 Prometheus scrape（gateway 不轉發 actuator 路徑）
                .requestMatchers("/actuator/health", "/actuator/info", "/actuator/prometheus").permitAll()
                // Swagger UI / OpenAPI 文件（T-092）— 放行需在 anyRequest().authenticated() 之前
                .requestMatchers("/swagger-ui/**", "/swagger-ui.html", "/v3/api-docs/**").permitAll()
                .anyRequest().authenticated()
            )
            .oauth2Login(oauth -> oauth
                .authorizationEndpoint(endpoint ->
                    endpoint.baseUri("/api/v1/auth/oauth2/authorization"))
                .redirectionEndpoint(endpoint ->
                    endpoint.baseUri("/api/v1/auth/oauth2/callback/*"))
                .successHandler(socialOAuthSuccessHandler)
                .failureHandler(socialOAuthFailureHandler)
            )
            // 兩個 filter 都跑在 UsernamePasswordAuthenticationFilter 之前
            // internalSecretFilter 只處理 /internal/**，jwtFilter 只處理有 Bearer token 的請求
            .addFilterBefore(jwtAuthenticationFilter, UsernamePasswordAuthenticationFilter.class)
            .addFilterBefore(internalSecretFilter, UsernamePasswordAuthenticationFilter.class);

        return http.build();
    }
}
