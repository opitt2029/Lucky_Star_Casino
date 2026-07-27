package com.luckystar.member.config;

import com.luckystar.member.service.SocialProvider;
import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.HashMap;
import java.util.Map;

@Getter
@Setter
@Component
@ConfigurationProperties(prefix = "social-oauth")
public class SocialOAuthProperties {

    private String frontendBaseUrl = "http://localhost:5173";
    private Duration bindingTicketTtl = Duration.ofMinutes(5);
    private Duration loginTicketTtl = Duration.ofMinutes(2);
    private Map<String, Provider> providers = new HashMap<>();

    public boolean isEnabled(SocialProvider provider) {
        Provider settings = providers.get(provider.id());
        return settings != null && settings.isEnabled();
    }

    @Getter
    @Setter
    public static class Provider {
        private boolean enabled;
    }
}
