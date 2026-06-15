package com.luckystar.notification.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import java.lang.reflect.Type;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import javax.crypto.SecretKey;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.messaging.converter.MappingJackson2MessageConverter;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.messaging.simp.stomp.StompFrameHandler;
import org.springframework.messaging.simp.stomp.StompHeaders;
import org.springframework.messaging.simp.stomp.StompSession;
import org.springframework.messaging.simp.stomp.StompSessionHandlerAdapter;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.messaging.WebSocketStompClient;

/**
 * T-070 驗收：client 能以有效玩家 JWT 連上 {@code /ws}、訂閱私人頻道、收到伺服器推播；
 * 無效 JWT 連線會被攔截器拒絕。同時驗證 {@code /user/} principal 路由（鑑權綁定的 playerId）。
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class WebSocketStompIntegrationTest {

    @LocalServerPort
    private int port;

    @Value("${jwt.secret}")
    private String secret;

    @Autowired
    private SimpMessagingTemplate messagingTemplate;

    private WebSocketStompClient stompClient;

    @AfterEach
    void tearDown() {
        if (stompClient != null) {
            stompClient.stop();
        }
    }

    private WebSocketStompClient newClient() {
        WebSocketStompClient client = new WebSocketStompClient(new StandardWebSocketClient());
        client.setMessageConverter(new MappingJackson2MessageConverter());
        return client;
    }

    private String jwtForPlayer(String playerId, long ttlMs) {
        SecretKey key = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
        return Jwts.builder()
                .subject(playerId)
                .claim("role", "PLAYER")
                .issuedAt(new Date())
                .expiration(new Date(System.currentTimeMillis() + ttlMs))
                .signWith(key)
                .compact();
    }

    private StompSession connect(String token) throws Exception {
        stompClient = newClient();
        StompHeaders connectHeaders = new StompHeaders();
        if (token != null) {
            connectHeaders.add("Authorization", "Bearer " + token);
        }
        return stompClient.connectAsync(
                        "ws://localhost:" + port + "/ws",
                        new org.springframework.web.socket.WebSocketHttpHeaders(),
                        connectHeaders,
                        new StompSessionHandlerAdapter() {})
                .get(5, TimeUnit.SECONDS);
    }

    @Test
    void validJwt_connectsSubscribesAndReceivesPrivateMessage() throws Exception {
        StompSession session = connect(jwtForPlayer("42", 60_000));
        assertThat(session.isConnected()).isTrue();

        BlockingQueue<Map<String, Object>> received = new ArrayBlockingQueue<>(1);
        session.subscribe("/user/queue/notifications", new StompFrameHandler() {
            @Override
            public Type getPayloadType(StompHeaders headers) {
                return Map.class;
            }

            @Override
            @SuppressWarnings("unchecked")
            public void handleFrame(StompHeaders headers, Object payload) {
                received.add((Map<String, Object>) payload);
            }
        });

        // 等訂閱建立後，由伺服器端推播給 playerId=42
        Thread.sleep(300);
        messagingTemplate.convertAndSendToUser("42", "/queue/notifications", Map.of("hello", "world"));

        Map<String, Object> msg = received.poll(5, TimeUnit.SECONDS);
        assertThat(msg).isNotNull();
        assertThat(msg).containsEntry("hello", "world");
    }

    @Test
    void missingJwt_connectionIsRejected() {
        assertThatThrownBy(() -> connect(null))
                .isInstanceOfAny(ExecutionException.class, IllegalStateException.class);
    }

    @Test
    void invalidJwt_connectionIsRejected() {
        assertThatThrownBy(() -> connect("garbage.token.value"))
                .isInstanceOfAny(ExecutionException.class, IllegalStateException.class);
    }
}
