package com.luckystar.member.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.luckystar.member.dto.LoginRequest;
import com.luckystar.member.dto.LoginResponse;
import com.luckystar.member.entity.Member;
import com.luckystar.member.exception.AccountDisabledException;
import com.luckystar.member.exception.InvalidCredentialsException;
import com.luckystar.member.repository.MemberRepository;
import com.luckystar.member.security.JwtTokenProvider;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;

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

    @Mock
    private KafkaTemplate<String, String> kafkaTemplate;

    @Mock
    private ObjectMapper objectMapper;

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
        m.setRole("PLAYER");
        m.setStatus("ACTIVE");
        return m;
    }

    // ── Login Tests ───────────────────────────────────────────────────────────

    @Test
    void login_success() {
        LoginRequest request = buildLoginRequest();
        Member member = buildActiveMember();

        when(memberRepository.findByUsername("testuser")).thenReturn(Optional.of(member));
        when(passwordEncoder.matches("Password1", "$2a$hashed")).thenReturn(true);
        when(jwtTokenProvider.generateAccessToken(1L, "testuser", "PLAYER", "NORMAL")).thenReturn("access.token.here");
        when(jwtTokenProvider.generateRefreshToken(1L, "testuser", "PLAYER", "NORMAL")).thenReturn("refresh.token.here");
        when(jwtTokenProvider.getRemainingTtlMs("refresh.token.here")).thenReturn(604800000L);

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
    void login_socialOnlyAccountRejectsPasswordLogin() {
        LoginRequest request = buildLoginRequest();
        Member member = buildActiveMember();
        member.setPasswordHash(null);
        when(memberRepository.findByUsername("testuser")).thenReturn(Optional.of(member));

        assertThrows(InvalidCredentialsException.class, () -> authService.login(request));
        verify(passwordEncoder, never()).matches(anyString(), anyString());
    }

    @Test
    void login_accountDisabled() {
        LoginRequest request = buildLoginRequest();
        Member member = buildActiveMember();
        member.setStatus("DISABLED");

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

        when(jwtTokenProvider.validateToken(rawToken)).thenReturn(true);
        when(jwtTokenProvider.getJti(rawToken)).thenReturn(jti);
        when(jwtTokenProvider.getRemainingTtlMs(rawToken)).thenReturn(60_000L);

        authService.logout(authHeader, memberId);

        verify(tokenRedisService, times(1)).addToBlacklist(eq(jti), anyLong());
        verify(tokenRedisService, times(1)).deleteRefreshToken(memberId);
    }
}
