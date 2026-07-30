package com.luckystar.gateway.config;

import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.ArrayList;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 可信反向代理（trusted proxy）CIDR 比對器。
 *
 * <p>只有當「直接 socket 對端」落在設定的可信 CIDR 內時，Gateway 才會採信
 * {@code X-Forwarded-For}。空清單（預設）＝完全不信任 XFF，永遠以 socket 對端為準——
 * 這是 gateway 直接暴露在 8080（無反代）時的安全預設：任何人都無法藉偽造 XFF 換取新的限流桶。
 *
 * <p>設計刻意不引入 Spring Security 的 {@code IpAddressMatcher}：gateway-service classpath
 * 上沒有 Spring Security，也不應為此新增依賴。故在此自行實作位元級 CIDR 比對。
 */
public class TrustedProxyMatcher {

    private static final Logger log = LoggerFactory.getLogger(TrustedProxyMatcher.class);

    /** 單一 CIDR：網段位址原始位元組 ＋ 前綴位元數。 */
    private record Cidr(byte[] network, int prefixLen) {}

    private final List<Cidr> cidrs = new ArrayList<>();

    /**
     * @param entries CIDR 字串清單，如 {@code ["10.0.0.0/8", "::1/128"]}；
     *                無 {@code /len} 的裸位址視為 /32（IPv4）或 /128（IPv6）。
     *                空白或無法解析的項目只記 WARN 並跳過，絕不拋例外
     *                （env 打錯字不可讓 gateway 起不來）。
     */
    public TrustedProxyMatcher(List<String> entries) {
        if (entries == null) {
            return;
        }
        for (String entry : entries) {
            if (entry == null || entry.isBlank()) {
                continue;
            }
            try {
                cidrs.add(parse(entry.trim()));
            } catch (Exception e) {
                log.warn("[限流] 略過無法解析的 trusted-proxy CIDR: '{}' ({})", entry, e.toString());
            }
        }
    }

    private static Cidr parse(String entry) throws UnknownHostException {
        int slash = entry.indexOf('/');
        String addrPart = slash < 0 ? entry : entry.substring(0, slash);
        byte[] network = InetAddress.getByName(addrPart).getAddress();
        int maxBits = network.length * 8;
        int prefixLen = maxBits;
        if (slash >= 0) {
            prefixLen = Integer.parseInt(entry.substring(slash + 1));
            if (prefixLen < 0 || prefixLen > maxBits) {
                throw new IllegalArgumentException("prefix out of range: " + prefixLen);
            }
        }
        return new Cidr(network, prefixLen);
    }

    /**
     * @return 給定 IP 是否落在任一設定的可信 CIDR 內；清單為空、IP 為 null/空字串、
     *         或位址族（IPv4/IPv6）與所有 CIDR 皆不符時回傳 {@code false}。
     */
    public boolean isTrusted(String ip) {
        if (ip == null || ip.isBlank()) {
            return false;
        }
        byte[] addr;
        try {
            addr = InetAddress.getByName(ip.trim()).getAddress();
        } catch (UnknownHostException e) {
            return false;
        }
        for (Cidr cidr : cidrs) {
            // 位址族必須相符：IPv4（4 bytes）永不匹配 IPv6（16 bytes）CIDR，反之亦然。
            if (cidr.network().length != addr.length) {
                continue;
            }
            if (matches(addr, cidr.network(), cidr.prefixLen())) {
                return true;
            }
        }
        return false;
    }

    /** 前 {@code prefixLen} 位元逐位比對：整段位元組先比，尾端不足一位元組者以遮罩比。 */
    private static boolean matches(byte[] addr, byte[] network, int prefixLen) {
        int fullBytes = prefixLen / 8;
        int remainingBits = prefixLen % 8;
        for (int i = 0; i < fullBytes; i++) {
            if (addr[i] != network[i]) {
                return false;
            }
        }
        if (remainingBits > 0) {
            int mask = 0xFF << (8 - remainingBits);
            return (addr[fullBytes] & mask) == (network[fullBytes] & mask);
        }
        return true;
    }

    /** @return 是否沒有任何 CIDR 成功解析（＝完全不信任 XFF）。 */
    public boolean isEmpty() {
        return cidrs.isEmpty();
    }
}
