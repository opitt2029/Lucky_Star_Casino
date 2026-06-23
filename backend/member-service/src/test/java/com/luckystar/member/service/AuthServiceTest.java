package com.luckystar.member.service;

import com.luckystar.member.dto.LoginRequest;
import com.luckystar.member.dto.RegisterRequest;
import com.luckystar.member.dto.RegisterResponse;
import com.luckystar.member.entity.Member;
import com.luckystar.member.exception.AccountDisabledException;
import com.luckystar.member.exception.MemberAlreadyExistsException;
import com.luckystar.member.repository.MemberRepository;
import com.luckystar.member.security.JwtTokenProvider;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.time.LocalDateTime;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class AuthServiceTest {

    @Mock
    private MemberRepository memberRepository;

    @Mock
    private PasswordEncoder passwordEncoder;

    @Mock
    private JwtTokenProvider jwtTokenProvider;

    @Mock
    private TokenRedisService tokenRedisService;

    @Mock
    private OutboxService outboxService;

    @InjectMocks
    private AuthService authService;

    private RegisterRequest buildRequest() {
        RegisterRequest req = new RegisterRequest();
        req.setUsername("testuser");
        req.setEmail("test@example.com");
        req.setPassword("Password1");
        return req;
    }

    private void stubSuccessfulSave() {
        when(memberRepository.save(any(Member.class))).thenAnswer(inv -> {
            Member m = inv.getArgument(0);
            m.setId(1L);
            m.setCreatedAt(LocalDateTime.now());
            m.setUpdatedAt(LocalDateTime.now());
            return m;
        });
    }

    @Test
    void register_success() {
        RegisterRequest request = buildRequest();

        when(memberRepository.existsByUsername("testuser")).thenReturn(false);
        when(memberRepository.existsByEmail("test@example.com")).thenReturn(false);
        when(passwordEncoder.encode("Password1")).thenReturn("$2a$hashed");
        stubSuccessfulSave();

        RegisterResponse response = authService.register(request);

        verify(memberRepository, times(1)).save(any(Member.class));
        // 事件寫入 outbox（不再直接送 Kafka）：與會員寫入同一交易
        verify(outboxService, times(1)).save(eq("member.registered"), eq("1"), any());
        assertEquals("testuser", response.getUsername());
    }

    @Test
    void register_duplicateUsername() {
        RegisterRequest request = buildRequest();

        when(memberRepository.existsByUsername("testuser")).thenReturn(true);

        assertThrows(MemberAlreadyExistsException.class, () -> authService.register(request));
        verify(memberRepository, never()).save(any());
        verify(outboxService, never()).save(anyString(), anyString(), any());
    }

    @Test
    void register_duplicateEmail() {
        RegisterRequest request = buildRequest();

        when(memberRepository.existsByUsername("testuser")).thenReturn(false);
        when(memberRepository.existsByEmail("test@example.com")).thenReturn(true);

        assertThrows(MemberAlreadyExistsException.class, () -> authService.register(request));
    }

    private Member buildActiveMember() {
        Member m = new Member();
        m.setId(1L);
        m.setUsername("testuser");
        m.setPasswordHash("$2a$hashed");
        m.setStatus("ACTIVE");
        m.setRole("PLAYER");
        return m;
    }

    private LoginRequest buildLoginRequest() {
        LoginRequest req = new LoginRequest();
        req.setUsername("testuser");
        req.setPassword("Password1");
        return req;
    }

    @Test
    void login_disabledByRedis_throws() {
        Member member = buildActiveMember();
        when(memberRepository.findByUsername("testuser")).thenReturn(Optional.of(member));
        when(passwordEncoder.matches("Password1", "$2a$hashed")).thenReturn(true);
        when(tokenRedisService.isPlayerDisabled(1L)).thenReturn(true);

        assertThrows(AccountDisabledException.class, () -> authService.login(buildLoginRequest()));
        verifyNoInteractions(jwtTokenProvider);
    }

    @Test
    void login_redisWriteFails_throws() {
        Member member = buildActiveMember();
        when(memberRepository.findByUsername("testuser")).thenReturn(Optional.of(member));
        when(passwordEncoder.matches("Password1", "$2a$hashed")).thenReturn(true);
        when(tokenRedisService.isPlayerDisabled(1L)).thenReturn(false);
        when(jwtTokenProvider.generateAccessToken(1L, "testuser", "PLAYER")).thenReturn("access-token");
        when(jwtTokenProvider.generateRefreshToken(1L, "testuser", "PLAYER")).thenReturn("refresh-token");
        when(jwtTokenProvider.getRemainingTtlMs("refresh-token")).thenReturn(86400000L);
        doThrow(new RedisConnectionFailureException("Redis down"))
                .when(tokenRedisService).saveRefreshToken(anyLong(), anyString(), anyLong());

        RuntimeException ex = assertThrows(RuntimeException.class, () -> authService.login(buildLoginRequest()));
        assertTrue(ex.getMessage().contains("temporarily unavailable"));
    }

    @Test
    void register_outboxFailure_propagates() {
        // 行為已改：outbox 寫入與會員寫入同一交易，失敗時應往上拋觸發 rollback，
        // 不再像舊版那樣 best-effort 吞掉錯誤
        RegisterRequest request = buildRequest();

        when(memberRepository.existsByUsername("testuser")).thenReturn(false);
        when(memberRepository.existsByEmail("test@example.com")).thenReturn(false);
        when(passwordEncoder.encode("Password1")).thenReturn("$2a$hashed");
        stubSuccessfulSave();
        doThrow(new IllegalStateException("outbox unavailable"))
                .when(outboxService).save(anyString(), anyString(), any());

        assertThrows(IllegalStateException.class, () -> authService.register(request));
        verify(memberRepository, times(1)).save(any(Member.class));
    }
}
