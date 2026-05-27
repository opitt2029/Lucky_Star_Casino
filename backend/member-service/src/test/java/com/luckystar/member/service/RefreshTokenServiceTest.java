package com.luckystar.member.service;

import com.luckystar.member.dto.RefreshRequest;
import com.luckystar.member.dto.RefreshResponse;
import com.luckystar.member.entity.Member;
import com.luckystar.member.exception.InvalidTokenException;
import com.luckystar.member.repository.MemberRepository;
import com.luckystar.member.security.JwtTokenProvider;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InOrder;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class RefreshTokenServiceTest {

    @Mock
    private JwtTokenProvider jwtTokenProvider;

    @Mock
    private TokenRedisService tokenRedisService;

    @Mock
    private MemberRepository memberRepository;

    @InjectMocks
    private AuthService authService;

    private static final String OLD_REFRESH_TOKEN = "old.refresh.token";
    private static final String NEW_ACCESS_TOKEN  = "new.access.token";
    private static final String NEW_REFRESH_TOKEN = "new.refresh.token";
    private static final Long   MEMBER_ID         = 1L;

    private RefreshRequest buildRequest() {
        RefreshRequest req = new RefreshRequest();
        req.setRefreshToken(OLD_REFRESH_TOKEN);
        return req;
    }

    private Member buildMember() {
        Member m = new Member();
        m.setId(MEMBER_ID);
        m.setUsername("testuser");
        m.setEmail("test@example.com");
        m.setActive(true);
        return m;
    }

    private void stubSuccessPath() {
        when(jwtTokenProvider.validateToken(OLD_REFRESH_TOKEN)).thenReturn(true);
        when(jwtTokenProvider.getMemberIdFromToken(OLD_REFRESH_TOKEN)).thenReturn(MEMBER_ID);
        when(tokenRedisService.getRefreshToken(MEMBER_ID)).thenReturn(Optional.of(OLD_REFRESH_TOKEN));
        when(memberRepository.findById(MEMBER_ID)).thenReturn(Optional.of(buildMember()));
        when(jwtTokenProvider.generateAccessToken(MEMBER_ID, "testuser")).thenReturn(NEW_ACCESS_TOKEN);
        when(jwtTokenProvider.generateRefreshToken(MEMBER_ID)).thenReturn(NEW_REFRESH_TOKEN);
        when(jwtTokenProvider.getRefreshTokenExpiryMs()).thenReturn(604800000L);
    }

    // ── Test 1: 成功換發新 Token ───────────────────────────────────────────────

    @Test
    void refreshToken_success() {
        stubSuccessPath();

        RefreshResponse response = authService.refreshToken(buildRequest());

        assertNotNull(response.getAccessToken());
        assertNotNull(response.getRefreshToken());
        // 新 Refresh Token 必須與舊 Token 不同（輪換語意）
        assertNotEquals(OLD_REFRESH_TOKEN, response.getRefreshToken());

        // delete 必須在 save 之前呼叫
        InOrder inOrder = inOrder(tokenRedisService);
        inOrder.verify(tokenRedisService).deleteRefreshToken(MEMBER_ID);
        inOrder.verify(tokenRedisService).saveRefreshToken(eq(MEMBER_ID), eq(NEW_REFRESH_TOKEN), anyLong());
    }

    // ── Test 2: JWT 簽章無效或已過期 ──────────────────────────────────────────

    @Test
    void refreshToken_invalidJwt() {
        when(jwtTokenProvider.validateToken(OLD_REFRESH_TOKEN)).thenReturn(false);

        assertThrows(InvalidTokenException.class, () -> authService.refreshToken(buildRequest()));
    }

    // ── Test 3: Token 已被撤銷（Redis 中不存在）─────────────────────────────────

    @Test
    void refreshToken_revokedToken() {
        when(jwtTokenProvider.validateToken(OLD_REFRESH_TOKEN)).thenReturn(true);
        when(jwtTokenProvider.getMemberIdFromToken(OLD_REFRESH_TOKEN)).thenReturn(MEMBER_ID);
        when(tokenRedisService.getRefreshToken(MEMBER_ID)).thenReturn(Optional.empty());

        assertThrows(InvalidTokenException.class, () -> authService.refreshToken(buildRequest()));
    }

    // ── Test 4: Token 值不匹配（可能是重放攻擊）────────────────────────────────

    @Test
    void refreshToken_tokenMismatch() {
        when(jwtTokenProvider.validateToken(OLD_REFRESH_TOKEN)).thenReturn(true);
        when(jwtTokenProvider.getMemberIdFromToken(OLD_REFRESH_TOKEN)).thenReturn(MEMBER_ID);
        // Redis 中存的是另一個 token，與請求不符
        when(tokenRedisService.getRefreshToken(MEMBER_ID))
                .thenReturn(Optional.of("completely.different.token"));

        assertThrows(InvalidTokenException.class, () -> authService.refreshToken(buildRequest()));
    }

    // ── Test 5: 驗證輪換順序 — delete 必須先於 save ──────────────────────────

    @Test
    void refreshToken_verifyRotationOrder() {
        stubSuccessPath();

        authService.refreshToken(buildRequest());

        InOrder inOrder = inOrder(tokenRedisService);
        inOrder.verify(tokenRedisService).deleteRefreshToken(MEMBER_ID);
        inOrder.verify(tokenRedisService).saveRefreshToken(eq(MEMBER_ID), anyString(), anyLong());
    }
}
