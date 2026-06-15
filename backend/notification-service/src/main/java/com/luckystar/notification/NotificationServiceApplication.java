package com.luckystar.notification;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Notification Service：把後端事件（{@code notification.push}、{@code game.result}）即時
 * 推播給已連線玩家（WebSocket/STOMP）。無資料庫，純事件橋接（Phase 5：T-070~T-072）。
 */
@SpringBootApplication
public class NotificationServiceApplication {

    public static void main(String[] args) {
        SpringApplication.run(NotificationServiceApplication.class, args);
    }
}
