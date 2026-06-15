package com.luckystar.notification.security;

import java.security.Principal;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.stereotype.Component;

/**
 * STOMP CONNECT 連線鑑權攔截器（T-070）。
 *
 * <p>client 連線時須帶 STOMP header {@code Authorization: Bearer <playerAccessToken>}。
 * 驗章成功 → 以 playerId（JWT subject）作為連線的 {@link Principal} 名稱，後續
 * {@code convertAndSendToUser(playerId, "/queue/...")} 才能正確路由到該玩家私人頻道；
 * 驗章失敗 → 拋例外，broker 會回 STOMP ERROR 並斷線。
 */
@Component
public class StompAuthChannelInterceptor implements ChannelInterceptor {

    private static final Logger log = LoggerFactory.getLogger(StompAuthChannelInterceptor.class);
    private static final String AUTH_HEADER = "Authorization";
    private static final String BEARER_PREFIX = "Bearer ";

    private final PlayerJwtVerifier jwtVerifier;

    public StompAuthChannelInterceptor(PlayerJwtVerifier jwtVerifier) {
        this.jwtVerifier = jwtVerifier;
    }

    @Override
    public Message<?> preSend(Message<?> message, MessageChannel channel) {
        StompHeaderAccessor accessor =
                MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);

        if (accessor == null || !StompCommand.CONNECT.equals(accessor.getCommand())) {
            return message;
        }

        String token = extractBearerToken(accessor);
        String playerId = jwtVerifier.verifyAndGetPlayerId(token);
        if (playerId == null) {
            throw new IllegalArgumentException("STOMP CONNECT 缺少或無效的 JWT");
        }

        Principal principal = new StompPrincipal(playerId);
        accessor.setUser(principal);
        log.debug("STOMP 連線鑑權成功 playerId={}", playerId);
        return message;
    }

    private String extractBearerToken(StompHeaderAccessor accessor) {
        List<String> values = accessor.getNativeHeader(AUTH_HEADER);
        if (values == null || values.isEmpty()) {
            return null;
        }
        String raw = values.get(0);
        if (raw != null && raw.startsWith(BEARER_PREFIX)) {
            return raw.substring(BEARER_PREFIX.length());
        }
        return raw;
    }

    /** 以 playerId 為名稱的連線 Principal，供 {@code /user/} 路由比對。 */
    record StompPrincipal(String name) implements Principal {
        @Override
        public String getName() {
            return name;
        }
    }
}
