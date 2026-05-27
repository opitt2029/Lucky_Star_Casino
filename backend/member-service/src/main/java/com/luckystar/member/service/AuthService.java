package com.luckystar.member.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.luckystar.member.dto.LoginRequest;
import com.luckystar.member.dto.LoginResponse;
import com.luckystar.member.dto.RefreshRequest;
import com.luckystar.member.dto.RefreshResponse;
import com.luckystar.member.dto.RegisterRequest;
import com.luckystar.member.dto.RegisterResponse;
import com.luckystar.member.entity.Member;
import com.luckystar.member.exception.AccountDisabledException;
import com.luckystar.member.exception.InvalidCredentialsException;
import com.luckystar.member.exception.InvalidTokenException;
import com.luckystar.member.exception.MemberAlreadyExistsException;
import com.luckystar.member.repository.MemberRepository;
import com.luckystar.member.security.JwtTokenProvider;
import io.jsonwebtoken.Claims;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import java.util.Map;

@Service
public class AuthService {

    private static final Logger log = LoggerFactory.getLogger(AuthService.class);
    private static final String TOPIC_MEMBER_REGISTERED = "member.registered";

    private final MemberRepository memberRepository;
    private final PasswordEncoder passwordEncoder;
    private final KafkaTemplate<String, String> kafkaTemplate;
    private final ObjectMapper objectMapper;
    private final JwtTokenProvider jwtTokenProvider;
    private final TokenRedisService tokenRedisService;

    public AuthService(MemberRepository memberRepository,
                       PasswordEncoder passwordEncoder,
                       KafkaTemplate<String, String> kafkaTemplate,
                       ObjectMapper objectMapper,
                       JwtTokenProvider jwtTokenProvider,
                       TokenRedisService tokenRedisService) {
        this.memberRepository = memberRepository;
        this.passwordEncoder = passwordEncoder;
        this.kafkaTemplate = kafkaTemplate;
        this.objectMapper = objectMapper;
        this.jwtTokenProvider = jwtTokenProvider;
        this.tokenRedisService = tokenRedisService;
    }

    // ── T-010: 會員註冊 ────────────────────────────────────────────────────────

    public RegisterResponse register(RegisterRequest request) {
        if (memberRepository.existsByUsername(request.getUsername())) {
            throw new MemberAlreadyExistsException("Username already taken");
        }
        if (memberRepository.existsByEmail(request.getEmail())) {
            throw new MemberAlreadyExistsException("Email already registered");
        }

        String passwordHash = passwordEncoder.encode(request.getPassword());

        Member member = new Member();
        member.setUsername(request.getUsername());
        member.setEmail(request.getEmail());
        member.setPasswordHash(passwordHash);
        member.setActive(true);
        member.setNewGiftClaimed(false);

        Member saved = memberRepository.save(member);

        try {
            String eventJson = objectMapper.writeValueAsString(
                Map.of(
                    "memberId", saved.getId(),
                    "username", saved.getUsername(),
                    "email", saved.getEmail()
                )
            );
            kafkaTemplate.send(TOPIC_MEMBER_REGISTERED, saved.getId().toString(), eventJson);
        } catch (Exception e) {
            log.warn("Failed to send Kafka event for member {}: {}", saved.getId(), e.getMessage());
        }

        return new RegisterResponse(
            saved.getId(),
            saved.getUsername(),
            saved.getEmail(),
            saved.getCreatedAt()
        );
    }

    // ── T-011: 登入 ───────────────────────────────────────────────────────────

    public LoginResponse login(LoginRequest request) {
        // Step 1: 查詢帳號 — 找不到與密碼錯誤回傳相同訊息，防止帳號枚舉攻擊
        Member member = memberRepository.findByUsername(request.getUsername())
                .orElseThrow(() -> new InvalidCredentialsException("Invalid username or password"));

        // Step 2: 驗證密碼；絕不記錄明文密碼
        if (!passwordEncoder.matches(request.getPassword(), member.getPasswordHash())) {
            throw new InvalidCredentialsException("Invalid username or password");
        }

        // Step 3: 帳號狀態檢查
        if (!member.isActive()) {
            throw new AccountDisabledException("Account is disabled");
        }

        // Step 4 & 5: 產生 Access / Refresh Token
        String accessToken = jwtTokenProvider.generateAccessToken(member.getId(), member.getUsername());
        String refreshToken = jwtTokenProvider.generateRefreshToken(member.getId());

        // Step 6: 將 Refresh Token 存入 Redis
        tokenRedisService.saveRefreshToken(
            member.getId(), refreshToken, jwtTokenProvider.getRefreshTokenExpiryMs()
        );

        // Step 7: 回傳（expiresIn = 900 秒 = 15 分鐘）
        return new LoginResponse(accessToken, refreshToken, "Bearer", 900);
    }

    // ── T-011: 登出 ───────────────────────────────────────────────────────────

    public void logout(String authorizationHeader, Long memberId) {
        // Step 1: 從 Bearer header 取出原始 token
        String rawToken = authorizationHeader.substring(7);

        // Step 2: 取得此 token 的 jti
        String jti = jwtTokenProvider.getJtiFromToken(rawToken);

        // Step 3: 計算 Access Token 剩餘存活時間，TTL 最小為 0
        Claims claims = jwtTokenProvider.getClaimsFromToken(rawToken);
        long remainingTtl = Math.max(0L,
            claims.getExpiration().getTime() - System.currentTimeMillis()
        );

        // Step 4: 將 jti 加入黑名單（TTL = 剩餘存活時間）
        tokenRedisService.addToBlacklist(jti, remainingTtl);

        // Step 5: 清除 Redis 中的 Refresh Token
        tokenRedisService.deleteRefreshToken(memberId);
    }

    // ── T-012: Refresh Token 輪換 ─────────────────────────────────────────────

    public RefreshResponse refreshToken(RefreshRequest request) {
        // Step 1: 驗證 JWT 簽章與有效期
        if (!jwtTokenProvider.validateToken(request.getRefreshToken())) {
            throw new InvalidTokenException("Refresh token is invalid or expired");
        }

        // Step 2: 從 token 取得 memberId
        Long memberId = jwtTokenProvider.getMemberIdFromToken(request.getRefreshToken());

        // Step 3: 從 Redis 取得存儲的 Refresh Token；若不存在表示已被撤銷
        String storedToken = tokenRedisService.getRefreshToken(memberId)
                .orElseThrow(() -> new InvalidTokenException("Refresh token has been revoked"));

        // Step 4: 比對 token（使用 equals，絕不用 == 比較字串）；相同訊息防止資訊洩漏
        if (!storedToken.equals(request.getRefreshToken())) {
            throw new InvalidTokenException("Refresh token is invalid or expired");
        }

        // Step 5: 先刪除舊 token — 確保任何時刻只有一個有效 Refresh Token
        tokenRedisService.deleteRefreshToken(memberId);

        // Step 6: 查詢 username，用於產生新 Access Token
        Member member = memberRepository.findById(memberId)
                .orElseThrow(() -> new InvalidTokenException("Refresh token is invalid or expired"));
        String newAccessToken = jwtTokenProvider.generateAccessToken(memberId, member.getUsername());

        // Step 7: 產生新 Refresh Token（舊 token 已刪除後才建立）
        String newRefreshToken = jwtTokenProvider.generateRefreshToken(memberId);

        // Step 8: 儲存新 Refresh Token
        tokenRedisService.saveRefreshToken(
            memberId, newRefreshToken, jwtTokenProvider.getRefreshTokenExpiryMs()
        );

        // Step 9: 回傳新憑證
        return new RefreshResponse(newAccessToken, newRefreshToken, "Bearer", 900);
    }
}
