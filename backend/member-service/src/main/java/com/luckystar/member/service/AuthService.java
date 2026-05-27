package com.luckystar.member.service;

import com.luckystar.member.dto.*;
import com.luckystar.member.entity.Member;
import com.luckystar.member.exception.*;
import com.luckystar.member.repository.MemberRepository;
import com.luckystar.member.security.JwtTokenProvider;
import io.jsonwebtoken.Claims;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import java.time.format.DateTimeFormatter;

@Slf4j
@Service
@RequiredArgsConstructor
public class AuthService {

    private static final DateTimeFormatter FORMATTER = DateTimeFormatter.ISO_LOCAL_DATE_TIME;

    private final MemberRepository memberRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtTokenProvider jwtTokenProvider;
    private final TokenRedisService tokenRedisService;
    private final KafkaTemplate<String, String> kafkaTemplate;

    public RegisterResponse register(RegisterRequest request) {
        if (memberRepository.existsByUsername(request.getUsername())) {
            throw new MemberAlreadyExistsException("Username already exists");
        }
        if (memberRepository.existsByEmail(request.getEmail())) {
            throw new MemberAlreadyExistsException("Email already exists");
        }

        Member member = new Member();
        member.setUsername(request.getUsername());
        member.setEmail(request.getEmail());
        member.setPasswordHash(passwordEncoder.encode(request.getPassword()));
        member.setNickname(request.getNickname());

        Member saved = memberRepository.save(member);

        try {
            kafkaTemplate.send("member.registered", String.valueOf(saved.getId()));
        } catch (Exception e) {
            log.warn("Failed to send Kafka event for member {}: {}", saved.getId(), e.getMessage());
        }

        return new RegisterResponse(
                saved.getId(),
                saved.getUsername(),
                saved.getEmail(),
                saved.getCreatedAt().format(FORMATTER)
        );
    }

    public LoginResponse login(LoginRequest request) {
        Member member = memberRepository.findByUsername(request.getUsername())
                .orElseThrow(() -> new InvalidCredentialsException("Invalid username or password"));

        if (!passwordEncoder.matches(request.getPassword(), member.getPasswordHash())) {
            throw new InvalidCredentialsException("Invalid username or password");
        }

        if ("DISABLED".equals(member.getStatus())) {
            throw new AccountDisabledException("Account is disabled");
        }

        String accessToken = jwtTokenProvider.generateAccessToken(member.getId(), member.getUsername());
        String refreshToken = jwtTokenProvider.generateRefreshToken(member.getId(), member.getUsername());

        long refreshTtl = jwtTokenProvider.getRemainingTtlMs(refreshToken);
        tokenRedisService.saveRefreshToken(member.getId(), refreshToken, refreshTtl);

        return new LoginResponse(accessToken, refreshToken);
    }

    public void logout(String authorizationHeader, Long memberId) {
        if (authorizationHeader != null && authorizationHeader.startsWith("Bearer ")) {
            String token = authorizationHeader.substring(7);
            if (jwtTokenProvider.validateToken(token)) {
                String jti = jwtTokenProvider.getJti(token);
                long ttl = jwtTokenProvider.getRemainingTtlMs(token);
                tokenRedisService.addToBlacklist(jti, ttl);
            }
        }
        tokenRedisService.deleteRefreshToken(memberId);
    }

    public RefreshResponse refreshToken(RefreshRequest request) {
        String token = request.getRefreshToken();

        if (!jwtTokenProvider.validateToken(token)) {
            throw new InvalidTokenException("Invalid refresh token");
        }

        Claims claims = jwtTokenProvider.getClaims(token);
        Long memberId = Long.parseLong(claims.getSubject());
        String username = claims.get("username", String.class);

        String stored = tokenRedisService.getRefreshToken(memberId);
        if (stored == null) {
            throw new InvalidTokenException("Refresh token not found");
        }
        if (!stored.equals(token)) {
            throw new InvalidTokenException("Refresh token mismatch");
        }

        tokenRedisService.deleteRefreshToken(memberId);

        String newAccess = jwtTokenProvider.generateAccessToken(memberId, username);
        String newRefresh = jwtTokenProvider.generateRefreshToken(memberId, username);
        long refreshTtl = jwtTokenProvider.getRemainingTtlMs(newRefresh);
        tokenRedisService.saveRefreshToken(memberId, newRefresh, refreshTtl);

        return new RefreshResponse(newAccess, newRefresh);
    }
}
