package com.luckystar.gateway.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;

/** {@link TrustedProxyMatcher} 單元測試（純 JUnit，無 Spring context）。 */
class TrustedProxyMatcherTest {

    @Test
    void emptyList_anyIp_returnsFalse() {
        TrustedProxyMatcher matcher = new TrustedProxyMatcher(List.of());
        assertThat(matcher.isTrusted("10.1.2.3")).isFalse();
        assertThat(matcher.isEmpty()).isTrue();
    }

    @Test
    void cidr8_insideRange_returnsTrue() {
        TrustedProxyMatcher matcher = new TrustedProxyMatcher(List.of("10.0.0.0/8"));
        assertThat(matcher.isTrusted("10.1.2.3")).isTrue();
    }

    @Test
    void cidr8_outsideRange_returnsFalse() {
        TrustedProxyMatcher matcher = new TrustedProxyMatcher(List.of("10.0.0.0/8"));
        assertThat(matcher.isTrusted("11.1.2.3")).isFalse();
    }

    @Test
    void bareAddress_exactMatch_returnsTrue() {
        TrustedProxyMatcher matcher = new TrustedProxyMatcher(List.of("192.168.1.1"));
        assertThat(matcher.isTrusted("192.168.1.1")).isTrue();
    }

    @Test
    void bareAddress_differentAddress_returnsFalse() {
        TrustedProxyMatcher matcher = new TrustedProxyMatcher(List.of("192.168.1.1"));
        assertThat(matcher.isTrusted("192.168.1.2")).isFalse();
    }

    @Test
    void ipv6Loopback_matches() {
        TrustedProxyMatcher matcher = new TrustedProxyMatcher(List.of("::1/128"));
        assertThat(matcher.isTrusted("::1")).isTrue();
    }

    @Test
    void ipv4Cidr_ipv6Input_returnsFalse() {
        TrustedProxyMatcher matcher = new TrustedProxyMatcher(List.of("10.0.0.0/8"));
        assertThat(matcher.isTrusted("::1")).isFalse();
    }

    @Test
    void nullInput_returnsFalse() {
        TrustedProxyMatcher matcher = new TrustedProxyMatcher(List.of("10.0.0.0/8"));
        assertThat(matcher.isTrusted(null)).isFalse();
    }

    @Test
    void blankInput_returnsFalse() {
        TrustedProxyMatcher matcher = new TrustedProxyMatcher(List.of("10.0.0.0/8"));
        assertThat(matcher.isTrusted("")).isFalse();
    }

    @Test
    void invalidEntrySkipped_validEntryStillMatches() {
        TrustedProxyMatcher matcher = new TrustedProxyMatcher(List.of("not-a-cidr", "10.0.0.0/8"));
        assertThat(matcher.isTrusted("10.1.2.3")).isTrue();
        assertThat(matcher.isEmpty()).isFalse();
    }

    @Test
    void onlyInvalidEntry_isEmpty() {
        TrustedProxyMatcher matcher = new TrustedProxyMatcher(List.of("not-a-cidr"));
        assertThat(matcher.isEmpty()).isTrue();
    }
}
