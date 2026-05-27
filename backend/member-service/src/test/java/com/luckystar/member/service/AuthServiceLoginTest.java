package com.luckystar.member.service;

import com.luckystar.member.dto.LoginRequest;
import com.luckystar.member.dto.LoginResponse;
import com.luckystar.member.entity.Member;
import com.luckystar.member.exception.AccountDisabledException;
import com.luckystar.member.exception.InvalidCredentialsException;
import com.luckystar.member.repository.MemberRepository;
import com.luckystar.member.security.JwtTokenProvider;
import io.jsonwebtoken.Claims;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.util.Date;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class AuthServiceLoginTest {

    @Mock
    private MemberRepository memberRepository;

    @Mock
    private PasswordEncoder passwordEncoder;

    @Mock
    private JwtTokenProvider jwtTokenProvider;

    @Mock
    private TokenRedisService tokenRedisService;

    @InjectMocks
    private AuthService authService;

    private LoginRequest buildLoginRequest() {
        LoginRequest req = new LoginRequest();
        req.setUsername("testuser");
        req.setPassword("Password1");
        return req;
    }

    private Member buildActiveMember() {
        Member m = new Member();
        m.setId(1L);
        m.setUsername("testuser");
        m.setEmail("test@example.com");
        m.setPasswordHash("$2a$hashed");
        m.setActive(true);
        return m;
    }

    // ── Login Tests ───────────────────────────────────────────────────────────

    @Test
    void login_success() {
        LoginRequest request = buildLoginRequest();
        Member member = buildActiveMember();

        when(memberRepository.findByUsername("testuser")).thenReturn(Optional.of(member));
        when(passwordEncoder.matches("Password1", "$2a$hashed")).thenReturn(true);
        when(jwtTokenProvider.generateAccessToken(1L, "testuser")).thenReturn("access.token.here");
        when(jwtTokenProvider.generateRefreshToken(1L)).thenReturn("refresh.token.here");
        when(jwtTokenProvider.getRefreshTokenExpiryMs()).thenReturn(604800000L);

        LoginResponse response = authService.login(request);

        assertNotNull(response.getAccessToken());
        assertNotNull(response.getRefreshToken());
        verify(tokenRedisService, times(1))
                .saveRefreshToken(eq(1L), eq("refresh.token.here"), eq(604800000L));
    }

    @Test
    void login_usernameNotFound() {
        LoginRequest request = buildLoginRequest();

        when(memberRepository.findByUsername("testuser")).thenReturn(Optional.empty());

        assertThrows(InvalidCredentialsException.class, () -> authService.login(request));
    }

    @Test
    void login_wrongPassword() {
        LoginRequest request = buildLoginRequest();
        Member member = buildActiveMember();

        when(memberRepository.findByUsername("testuser")).thenReturn(Optional.of(member));
        when(passwordEncoder.matches("Password1", "$2a$hashed")).thenReturn(false);

        InvalidCredentialsException ex = assertThrows(
                InvalidCredentialsException.class, () -> authService.login(request));

        // 防止帳號枚舉：錯誤訊息必須與「帳號不存在」相同
        assertEquals("Invalid username or password", ex.getMessage());
    }

    @Test
    void login_accountDisabled() {
        LoginRequest request = buildLoginRequest();
        Member member = buildActiveMember();
        member.setActive(false);

        when(memberRepository.findByUsername("testuser")).thenReturn(Optional.of(member));
        when(passwordEncoder.matches("Password1", "$2a$hashed")).thenReturn(true);

        assertThrows(AccountDisabledException.class, () -> authService.login(request));
    }

    // ── Logout Tests ──────────────────────────────────────────────────────────

    @Test
    void logout_success() {
        String rawToken = "eyJrawToken";
        String authHeader = "Bearer " + rawToken;
        Long memberId = 1L;
        String jti = "some-jti-uuid";

        Claims claims = mock(Claims.class);
        // 設定過期時間為 60 秒後，確保 remainingTtl > 0
        when(claims.getExpiration()).thenReturn(new Date(System.currentTimeMillis() + 60_000L));

        when(jwtTokenProvider.getJtiFromToken(rawToken)).thenReturn(jti);
        when(jwtTokenProvider.getClaimsFromToken(rawToken)).thenReturn(claims);

        authService.logout(authHeader, memberId);

        verify(tokenRedisService, times(1)).addToBlacklist(eq(jti), anyLong());
        verify(tokenRedisService, times(1)).deleteRefreshToken(memberId);
    }
}
