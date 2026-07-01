package com.luckystar.gateway.config;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.cloud.gateway.handler.predicate.PredicateDefinition;
import org.springframework.cloud.gateway.route.RouteDefinition;
import org.springframework.cloud.gateway.route.RouteDefinitionLocator;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 驗證 application.yml 裡的 notification-ws 路由與 jwt.whitelist 設定確實生效，
 * 對應修正：Gateway 先前完全沒有轉發 /ws 到 notification-service（docs/architecture.md 舊 TODO）。
 */
@SpringBootTest
class GatewayRoutesConfigTest {

    @Autowired
    private RouteDefinitionLocator routeDefinitionLocator;

    @Autowired
    private JwtProperties jwtProperties;

    @Test
    void notificationWsRoute_hasPathPredicateAndPointsToNotificationService() {
        List<RouteDefinition> routes = routeDefinitionLocator.getRouteDefinitions().collectList().block();

        RouteDefinition wsRoute = routes.stream()
                .filter(r -> "notification-ws".equals(r.getId()))
                .findFirst()
                .orElseThrow(() -> new AssertionError("notification-ws route not found in gateway config"));

        assertThat(wsRoute.getUri().getPort()).isEqualTo(8087);

        PredicateDefinition pathPredicate = wsRoute.getPredicates().stream()
                .filter(p -> "Path".equals(p.getName()))
                .findFirst()
                .orElseThrow(() -> new AssertionError("notification-ws route missing Path predicate"));
        assertThat(pathPredicate.getArgs().values()).contains("/ws", "/ws/**");
    }

    @Test
    void jwtWhitelist_includesWsPath() {
        assertThat(jwtProperties.whitelist()).contains("/ws");
    }
}
