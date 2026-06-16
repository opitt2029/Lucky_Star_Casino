package com.luckystar.notification.config;

import com.luckystar.notification.security.StompAuthChannelInterceptor;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;

/**
 * WebSocket / STOMP 設定（T-070）。
 *
 * <ul>
 *   <li>STOMP 端點：{@code /ws}（含 SockJS fallback）。</li>
 *   <li>simple broker：{@code /topic}（公共廣播，如排行更新）、{@code /queue}（私人，配 {@code /user}）。</li>
 *   <li>應用前綴：{@code /app}（client → server 的 @MessageMapping，本服務目前以推播為主）。</li>
 *   <li>使用者目的地前綴：{@code /user}，搭配 {@link StompAuthChannelInterceptor} 綁定的 playerId principal，
 *       讓 {@code convertAndSendToUser(playerId, "/queue/notifications", ...)} 精準送達。</li>
 *   <li>CONNECT 鑑權：{@link StompAuthChannelInterceptor} 掛在 inbound channel。</li>
 * </ul>
 */
@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    private final StompAuthChannelInterceptor authChannelInterceptor;

    public WebSocketConfig(StompAuthChannelInterceptor authChannelInterceptor) {
        this.authChannelInterceptor = authChannelInterceptor;
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        registry.addEndpoint("/ws")
                .setAllowedOriginPatterns("*")
                .withSockJS();
        // 原生 WebSocket（無 SockJS）端點，供測試用 WebSocketStompClient 直連
        registry.addEndpoint("/ws")
                .setAllowedOriginPatterns("*");
    }

    @Override
    public void configureMessageBroker(MessageBrokerRegistry registry) {
        registry.enableSimpleBroker("/topic", "/queue");
        registry.setApplicationDestinationPrefixes("/app");
        registry.setUserDestinationPrefix("/user");
    }

    @Override
    public void configureClientInboundChannel(ChannelRegistration registration) {
        registration.interceptors(authChannelInterceptor);
    }
}
