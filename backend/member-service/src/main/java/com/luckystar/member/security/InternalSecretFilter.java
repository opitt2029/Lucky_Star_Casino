package com.luckystar.member.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;

@Slf4j
@Component
public class InternalSecretFilter extends OncePerRequestFilter {

    private static final String HEADER = "X-Internal-Secret";
    private static final String INTERNAL_PATH_PREFIX = "/internal/";

    private final byte[] expectedSecret;

    public InternalSecretFilter(@Value("${internal.secret}") String secret) {
        this.expectedSecret = secret.getBytes(StandardCharsets.UTF_8);
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        String path = request.getRequestURI();
        if (!path.startsWith(INTERNAL_PATH_PREFIX)) {
            filterChain.doFilter(request, response);
            return;
        }

        String provided = request.getHeader(HEADER);
        if (provided == null || !MessageDigest.isEqual(
                provided.getBytes(StandardCharsets.UTF_8), expectedSecret)) {
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            response.getWriter().write("{\"success\":false,\"data\":null,\"message\":\"Unauthorized internal request\"}");
            return;
        }

        filterChain.doFilter(request, response);
    }
}
