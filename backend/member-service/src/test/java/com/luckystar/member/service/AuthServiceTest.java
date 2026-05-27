package com.luckystar.member.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.luckystar.member.dto.RegisterRequest;
import com.luckystar.member.dto.RegisterResponse;
import com.luckystar.member.entity.Member;
import com.luckystar.member.exception.MemberAlreadyExistsException;
import com.luckystar.member.repository.MemberRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.time.LocalDateTime;

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
    @SuppressWarnings("rawtypes")
    private KafkaTemplate kafkaTemplate;

    @Mock
    private ObjectMapper objectMapper;

    @InjectMocks
    private AuthService authService;

    private RegisterRequest buildRequest() {
        RegisterRequest req = new RegisterRequest();
        req.setUsername("testuser");
        req.setEmail("test@example.com");
        req.setPassword("Password1");
        return req;
    }

    @Test
    void register_success() throws Exception {
        RegisterRequest request = buildRequest();

        when(memberRepository.existsByUsername("testuser")).thenReturn(false);
        when(memberRepository.existsByEmail("test@example.com")).thenReturn(false);
        when(passwordEncoder.encode("Password1")).thenReturn("$2a$hashed");
        when(memberRepository.save(any(Member.class))).thenAnswer(inv -> {
            Member m = inv.getArgument(0);
            m.setId(1L);
            m.setCreatedAt(LocalDateTime.now());
            m.setUpdatedAt(LocalDateTime.now());
            return m;
        });
        when(objectMapper.writeValueAsString(any())).thenReturn("{\"memberId\":1,\"username\":\"testuser\",\"email\":\"test@example.com\"}");

        RegisterResponse response = authService.register(request);

        verify(memberRepository, times(1)).save(any(Member.class));
        verify(kafkaTemplate, times(1)).send(anyString(), anyString(), anyString());
        assertEquals("testuser", response.getUsername());
    }

    @Test
    void register_duplicateUsername() {
        RegisterRequest request = buildRequest();

        when(memberRepository.existsByUsername("testuser")).thenReturn(true);

        assertThrows(MemberAlreadyExistsException.class, () -> authService.register(request));
        verify(memberRepository, never()).save(any());
    }

    @Test
    void register_duplicateEmail() {
        RegisterRequest request = buildRequest();

        when(memberRepository.existsByUsername("testuser")).thenReturn(false);
        when(memberRepository.existsByEmail("test@example.com")).thenReturn(true);

        assertThrows(MemberAlreadyExistsException.class, () -> authService.register(request));
    }

    @Test
    @SuppressWarnings("unchecked")
    void register_kafkaFailure_doesNotRollback() throws Exception {
        RegisterRequest request = buildRequest();

        when(memberRepository.existsByUsername("testuser")).thenReturn(false);
        when(memberRepository.existsByEmail("test@example.com")).thenReturn(false);
        when(passwordEncoder.encode("Password1")).thenReturn("$2a$hashed");
        when(memberRepository.save(any(Member.class))).thenAnswer(inv -> {
            Member m = inv.getArgument(0);
            m.setId(1L);
            m.setCreatedAt(LocalDateTime.now());
            m.setUpdatedAt(LocalDateTime.now());
            return m;
        });
        when(objectMapper.writeValueAsString(any())).thenReturn("{\"memberId\":1}");
        when(kafkaTemplate.send(anyString(), anyString(), anyString()))
                .thenThrow(new RuntimeException("Kafka unavailable"));

        assertDoesNotThrow(() -> authService.register(request));
        verify(memberRepository, times(1)).save(any(Member.class));
    }
}
