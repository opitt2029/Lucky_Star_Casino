package com.luckystar.member.security;

import io.jsonwebtoken.Claims;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@link JwtTokenProvider} 的 claim 契約測試，重點在 {@code tier}（會員等級）。
 *
 * <p>tier 是 VIP 分級限流的唯一傳遞管道：gateway 只認 token 裡的這個 claim 來決定
 * 令牌桶參數。claim 漏簽的話整條功能會「無聲失效」——後台顯示已是 VIP、玩家照樣被 429，
 * 而且沒有任何錯誤訊息。故此處直接對簽出來的 token 斷言。</p>
 */
class JwtTokenProviderTest {

    private static final String SECRET = "0123456789-0123456789-0123456789-0123456789-secret";

    private JwtTokenProvider provider;

    @BeforeEach
    void setUp() {
        provider = new JwtTokenProvider(SECRET, 900_000L, 604_800_000L);
    }

    @Test
    void accessToken_carriesTierClaim() {
        Claims claims = provider.getClaims(
                provider.generateAccessToken(42L, "alice", "PLAYER", "VIP"));

        assertThat(claims.getSubject()).isEqualTo("42");
        assertThat(claims.get("role")).isEqualTo("PLAYER");
        assertThat(claims.get("tier")).isEqualTo("VIP");
        assertThat(claims.get("type")).isEqualTo("access");
    }

    @Test
    void refreshToken_carriesTierClaim() {
        Claims claims = provider.getClaims(
                provider.generateRefreshToken(42L, "alice", "PLAYER", "NORMAL"));

        assertThat(claims.get("tier")).isEqualTo("NORMAL");
        assertThat(claims.get("type")).isEqualTo("refresh");
    }

    /** tier 為 null（理論上不會發生，DB 欄位 NOT NULL）時不可炸掉簽發流程。 */
    @Test
    void nullTier_stillIssuesValidToken() {
        String token = provider.generateAccessToken(42L, "alice", "PLAYER", null);

        assertThat(provider.validateToken(token)).isTrue();
        assertThat(provider.getClaims(token).get("tier")).isNull();
    }
}
