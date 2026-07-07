package com.luckystar.admin.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.web.client.RestClient;

/**
 * 建立呼叫 member-service 的 {@link RestClient}：固定 base-url 與 {@code X-Internal-Secret}
 * 預設 header（比照 game-service 的 WalletClientConfig；secret 由環境變數 INTERNAL_SECRET 提供）。
 */
@Configuration
public class MemberClientConfig {

    @Bean
    public RestClient memberRestClient(
            @Value("${internal.member-service.base-url}") String baseUrl,
            @Value("${internal.member-service.secret}") String internalSecret) {
        return RestClient.builder()
                .baseUrl(baseUrl)
                .defaultHeader("X-Internal-Secret", internalSecret)
                .defaultHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                .build();
    }
}
