package com.luckystar.game.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.web.client.RestClient;

/**
 * 建立呼叫 wallet-service 的 {@link RestClient}：固定 base-url 與 {@code X-Internal-Secret}
 * 預設 header（secret 必須由環境變數提供，見 application.yml）。
 */
@Configuration
public class WalletClientConfig {

    @Bean
    public RestClient walletRestClient(
            @Value("${internal.wallet-service.base-url}") String baseUrl,
            @Value("${internal.wallet-service.secret}") String internalSecret) {
        return RestClient.builder()
                .baseUrl(baseUrl)
                .defaultHeader("X-Internal-Secret", internalSecret)
                .defaultHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                .build();
    }
}
