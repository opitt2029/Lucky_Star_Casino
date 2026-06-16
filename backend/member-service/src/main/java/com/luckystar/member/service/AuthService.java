package com.luckystar.member.service;

import com.luckystar.member.dto.*;
import com.luckystar.member.entity.Member;
import com.luckystar.member.exception.*;
import com.luckystar.member.repository.MemberRepository;
import com.luckystar.member.security.JwtTokenProvider;
import io.jsonwebtoken.Claims;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

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
    private final OutboxService outboxService;

    @Transactional
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

        // 與會員寫入同一交易寫入 outbox（key=playerId 確保同一玩家事件落在同一 partition）；
        // 交易 commit 後由 OutboxPoller 非同步投遞至 member.registered，保證 DB↔Kafka 一致
        MemberRegisteredEvent event = new MemberRegisteredEvent(
                saved.getId(), saved.getUsername(), saved.getEmail());
        outboxService.save("member.registered", String.valueOf(saved.getId()), event);

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

        // DB status 或後台即時封鎖（Redis disabled:player:{id}）任一成立都視為停用，不得登入。
        // 後台 T-051 停用只寫 Redis 封鎖、不改 member DB，故必須同時查 Redis 才能擋住停用玩家登入。
        if ("DISABLED".equals(member.getStatus()) || tokenRedisService.isPlayerDisabled(member.getId())) {
            throw new AccountDisabledException("Account is disabled");
        }

        String accessToken = jwtTokenProvider.generateAccessToken(member.getId(), member.getUsername(), member.getRole());
        String refreshToken = jwtTokenProvider.generateRefreshToken(member.getId(), member.getUsername(), member.getRole());

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
        Long memberId;
        try {
            memberId = Long.parseLong(claims.getSubject());
        } catch (NumberFormatException e) {
            throw new InvalidTokenException("Invalid refresh token subject");
        }
        String username = claims.get("username", String.class);

        String stored = tokenRedisService.getRefreshToken(memberId);
        if (stored == null) {
            throw new InvalidTokenException("Refresh token not found");
        }
        if (!stored.equals(token)) {
            throw new InvalidTokenException("Refresh token mismatch");
        }

        // 重新查 DB 取最新 role（避免 token 內 role 過時，例如使用者被降權）
        Member member = memberRepository.findById(memberId)
                .orElseThrow(() -> new InvalidTokenException("Member not found"));

        tokenRedisService.deleteRefreshToken(memberId);

        String newAccess = jwtTokenProvider.generateAccessToken(memberId, username, member.getRole());
        String newRefresh = jwtTokenProvider.generateRefreshToken(memberId, username, member.getRole());
        long refreshTtl = jwtTokenProvider.getRemainingTtlMs(newRefresh);
        tokenRedisService.saveRefreshToken(memberId, newRefresh, refreshTtl);

        return new RefreshResponse(newAccess, newRefresh);
    }
}
