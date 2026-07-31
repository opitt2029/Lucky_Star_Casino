package com.luckystar.gateway.config;

import org.springframework.cloud.gateway.filter.ratelimit.KeyResolver;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import reactor.core.publisher.Mono;

import java.net.InetSocketAddress;

/**
 * 速率限制金鑰解析器。
 *
 * <p>auth 端點（login / register）尚未通過身份驗證，故以「來源 IP」作為計數金鑰；
 * 配合 application.yml 中 `RequestRateLimiter` filter 套用於 `/api/v1/auth/**` 路由，
 * 在 Gateway 層就攔截暴力破解嘗試，避免請求穿透到 member-service。</p>
 *
 * <p><b>信任邊界（安全修正）</b>：{@code X-Forwarded-For} 完全由用戶端控制，若無條件採信，
 * 攻擊者只要每次帶不同 XFF 就能拿到全新限流桶，`/api/v1/auth/**` 的暴力破解防護等同失效。
 * 因此 XFF 只有在「直接 socket 對端」本身是設定的可信反向代理（{@code rate-limit.trusted-proxies}）
 * 時才採信；預設空清單＝完全不信任 XFF、一律以 socket 對端為金鑰（gateway 直接暴露 8080 的安全預設）。
 * 採信 XFF 時，改由「右到左」尋找第一個非可信 hop 作為真實客戶端——由左到右會讓客戶端在最前面
 * 塞一個偽造 hop 就換到新桶。</p>
 */
@Configuration
public class RateLimitConfig {

    private static final String XFF_HEADER = "X-Forwarded-For";
    private static final String UNKNOWN = "unknown";

    @Bean
    public KeyResolver ipKeyResolver(RateLimitProperties props) {
        TrustedProxyMatcher matcher = new TrustedProxyMatcher(props.trustedProxies());
        return exchange -> Mono.just(resolveClientIp(exchange.getRequest().getRemoteAddress(),
                exchange.getRequest().getHeaders().getFirst(XFF_HEADER), matcher));
    }

    /**
     * 決定限流金鑰用的客戶端 IP。抽成可單元測試的靜態方法。
     *
     * @param remote  直接 socket 對端位址（可能為 null）
     * @param xff     原始 X-Forwarded-For header（可能為 null / 空）
     * @param matcher 可信代理比對器
     */
    static String resolveClientIp(InetSocketAddress remote, String xff, TrustedProxyMatcher matcher) {
        // 1. socket 對端；取不到就退回固定字串（限流仍生效，不至於全放行）。
        if (remote == null || remote.getAddress() == null) {
            return UNKNOWN;
        }
        String peer = remote.getAddress().getHostAddress();

        // 2. 沒有可信代理設定、或對端不是可信代理 → XFF 一律不採信，直接用對端。
        if (matcher.isEmpty() || !matcher.isTrusted(peer)) {
            return peer;
        }

        // 3. 對端是可信代理 → 讀 XFF，由右到左找第一個「非可信」hop＝真實客戶端。
        if (xff == null || xff.isBlank()) {
            return peer;
        }
        String[] hops = xff.split(",");
        for (int i = hops.length - 1; i >= 0; i--) {
            String hop = hops[i].trim();
            if (!hop.isEmpty() && !matcher.isTrusted(hop)) {
                return hop;
            }
        }
        // 4. 所有 hop 皆為可信代理（或標頭實質為空）→ 退回對端。
        return peer;
    }
}
