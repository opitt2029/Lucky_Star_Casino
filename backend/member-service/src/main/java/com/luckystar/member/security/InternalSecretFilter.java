package com.luckystar.member.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

@Component
public class InternalSecretFilter extends OncePerRequestFilter {

    @Value("${internal.secret}")
    private String internalSecret;

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {

        // Step 1: 非 /internal/** 路由直接放行，此 filter 只管服務間呼叫
        if (!request.getRequestURI().startsWith("/internal/")) {
            filterChain.doFilter(request, response);
            return;
        }

        // Step 2: 讀取 Gateway 轉發時附加的 secret header
        String incomingSecret = request.getHeader("X-Internal-Secret");

        // Step 3: 使用 constant-time 比較防止 timing attack；String.equals 不適用
        boolean valid = incomingSecret != null &&
                MessageDigest.isEqual(
                        internalSecret.getBytes(StandardCharsets.UTF_8),
                        incomingSecret.getBytes(StandardCharsets.UTF_8)
                );

        if (!valid) {
            response.setContentType("application/json");
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.getWriter().write(
                    "{\"success\":false,\"data\":null,\"message\":\"Unauthorized internal request\"}"
            );
            // 絕不呼叫 filterChain.doFilter — 避免請求繼續往下洩漏
            return;
        }

        // Step 4: secret 驗證通過，繼續處理
        filterChain.doFilter(request, response);
    }
}
