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
 *
 * <p><b>觀測性（T-090 §5.2）</b>：注入 Spring Boot 自動組態的 {@link RestClient.Builder} bean，
 * 而非用靜態 {@code RestClient.builder()}。前者已被 actuator 的 customizer 接上
 * {@code ObservationRegistry}，故 game→wallet 的每次呼叫都會產生 {@code http.client.requests}
 * 指標（含 {@code uri}/{@code status}/{@code outcome} 標籤）。改用靜態 builder 時這條指標恆為 0，
 * 導致膝點分層只能靠「game P99 減 wallet P99」相減推論。搭配 application.yml 對
 * {@code [http.client.requests]} 開 percentile histogram，Prometheus 才算得出這一層的 P99。
 */
@Configuration
public class WalletClientConfig {

    @Bean
    public RestClient walletRestClient(
            RestClient.Builder restClientBuilder,
            @Value("${internal.wallet-service.base-url}") String baseUrl,
            @Value("${internal.wallet-service.secret}") String internalSecret) {
        return restClientBuilder
                .baseUrl(baseUrl)
                .defaultHeader("X-Internal-Secret", internalSecret)
                .defaultHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                .build();
    }
}
