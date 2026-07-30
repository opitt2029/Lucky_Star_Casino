package com.luckystar.gateway.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.InetSocketAddress;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.cloud.gateway.filter.ratelimit.KeyResolver;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;

/**
 * {@link RateLimitConfig#ipKeyResolver} 的信任邊界單元測試。
 *
 * <p>重點回歸：無可信代理設定時，偽造的 X-Forwarded-For 必須被忽略（Test 1）——這正是舊版
 * 無條件採信 XFF 導致的暴力破解防護繞過。
 */
@ExtendWith(MockitoExtension.class)
class IpKeyResolverTest {

    private static KeyResolver resolver(String... trustedCidrs) {
        RateLimitProperties props = new RateLimitProperties(
                new RateLimitProperties.Player(10, 20),
                new RateLimitProperties.Game(5, 10),
                List.of(trustedCidrs));
        return new RateLimitConfig().ipKeyResolver(props);
    }

    private static MockServerWebExchange exchange(InetSocketAddress remote, String xff) {
        MockServerHttpRequest.BaseBuilder<?> builder = MockServerHttpRequest.get("/api/v1/auth/login");
        if (remote != null) {
            builder.remoteAddress(remote);
        }
        if (xff != null) {
            builder.header("X-Forwarded-For", xff);
        }
        return MockServerWebExchange.from(builder.build());
    }

    private static InetSocketAddress peer(String ip) {
        return new InetSocketAddress(ip, 40000);
    }

    @Test
    void noTrustedProxies_ignoresForgedXff() {
        String key = resolver().resolve(exchange(peer("203.0.113.9"), "1.2.3.4")).block();
        assertThat(key).isEqualTo("203.0.113.9");
    }

    @Test
    void noTrustedProxies_noXff_usesPeer() {
        String key = resolver().resolve(exchange(peer("203.0.113.9"), null)).block();
        assertThat(key).isEqualTo("203.0.113.9");
    }

    @Test
    void trustedPeer_singleXffHop_resolvesClient() {
        String key = resolver("10.0.0.0/8").resolve(exchange(peer("10.0.0.5"), "1.2.3.4")).block();
        assertThat(key).isEqualTo("1.2.3.4");
    }

    @Test
    void trustedPeer_skipsTrustedInnerHop_rightToLeft() {
        String key = resolver("10.0.0.0/8")
                .resolve(exchange(peer("10.0.0.5"), "9.9.9.9, 10.0.0.7")).block();
        assertThat(key).isEqualTo("9.9.9.9");
    }

    @Test
    void trustedPeer_clientForgedFirstHop_returnsForgedHop() {
        // 客戶端偽造了第一段 1.2.3.4；可信代理只「附加」自己的 hop（10.0.0.6）而非覆寫，
        // 右到左會停在偽造的 1.2.3.4。正確部署要求可信代理「覆寫」而非附加自身 hop。
        String key = resolver("10.0.0.0/8")
                .resolve(exchange(peer("10.0.0.5"), "1.2.3.4, 10.0.0.6")).block();
        assertThat(key).isEqualTo("1.2.3.4");
    }

    @Test
    void trustedPeer_allHopsTrusted_fallsBackToPeer() {
        String key = resolver("10.0.0.0/8")
                .resolve(exchange(peer("10.0.0.5"), "10.0.0.6, 10.0.0.7")).block();
        assertThat(key).isEqualTo("10.0.0.5");
    }

    @Test
    void trustedPeer_blankXff_fallsBackToPeer() {
        String key = resolver("10.0.0.0/8").resolve(exchange(peer("10.0.0.5"), "   ")).block();
        assertThat(key).isEqualTo("10.0.0.5");
    }

    @Test
    void nullRemoteAddress_noXff_resolvesUnknown() {
        String key = resolver().resolve(exchange(null, null)).block();
        assertThat(key).isEqualTo("unknown");
    }
}
