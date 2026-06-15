package com.luckystar.admin.security;

import io.jsonwebtoken.Claims;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.util.StringUtils;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * 解析後台 JWT 並塞入 {@link SecurityContextHolder}（T-050）。
 *
 * 通過驗章者授予兩個權限：{@code ROLE_ADMIN}（保護 /admin/**）與 {@code ROLE_<角色>}
 * （供 {@code @PreAuthorize("hasRole('SUPER_ADMIN')")} 等方法級授權）。
 * 驗章失敗（含玩家 token）不塞 context → 後續授權判定為未認證 → 401。
 */
public class AdminJwtAuthFilter extends OncePerRequestFilter {

    private final AdminJwtUtil adminJwtUtil;

    public AdminJwtAuthFilter(AdminJwtUtil adminJwtUtil) {
        this.adminJwtUtil = adminJwtUtil;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        String token = extractToken(request);
        if (StringUtils.hasText(token) && adminJwtUtil.validateToken(token)) {
            Claims claims = adminJwtUtil.getClaims(token);
            String adminId = claims.getSubject();
            String role = claims.get("role", String.class);
            if (StringUtils.hasText(role)) {
                List<GrantedAuthority> authorities = List.of(
                        new SimpleGrantedAuthority("ROLE_ADMIN"),
                        new SimpleGrantedAuthority("ROLE_" + role));
                UsernamePasswordAuthenticationToken auth =
                        new UsernamePasswordAuthenticationToken(adminId, null, authorities);
                SecurityContextHolder.getContext().setAuthentication(auth);
            }
        }
        filterChain.doFilter(request, response);
    }

    private String extractToken(HttpServletRequest request) {
        String header = request.getHeader("Authorization");
        if (StringUtils.hasText(header) && header.startsWith("Bearer ")) {
            return header.substring(7);
        }
        return null;
    }
}
