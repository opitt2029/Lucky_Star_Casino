package com.luckystar.gateway;

import com.luckystar.gateway.config.ConcurrencyLimitProperties;
import com.luckystar.gateway.config.JwtProperties;
import com.luckystar.gateway.config.RateLimitProperties;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
@EnableConfigurationProperties({JwtProperties.class, RateLimitProperties.class, ConcurrencyLimitProperties.class})
public class GatewayServiceApplication {

    public static void main(String[] args) {
        SpringApplication.run(GatewayServiceApplication.class, args);
    }
}
