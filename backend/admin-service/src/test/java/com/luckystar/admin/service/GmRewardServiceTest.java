package com.luckystar.admin.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.luckystar.admin.dto.GmGrantRequest;
import com.luckystar.admin.dto.GmGrantResponse;
import com.luckystar.admin.postgres.entity.AdminActionLog;
import com.luckystar.admin.postgres.repository.AdminActionLogRepository;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.kafka.core.KafkaTemplate;

@ExtendWith(MockitoExtension.class)
class GmRewardServiceTest {

    @Mock
    KafkaTemplate<String, String> kafkaTemplate;

    @Mock
    AdminActionLogRepository actionLogRepository;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void grant_sendsWalletCreditRequestAndWritesActionLog() throws Exception {
        when(actionLogRepository.save(org.mockito.ArgumentMatchers.any(AdminActionLog.class)))
                .thenAnswer(inv -> inv.getArgument(0));

        GmRewardService service =
                new GmRewardService(kafkaTemplate, objectMapper, actionLogRepository);

        GmGrantResponse response =
                service.grant("admin-1", new GmGrantRequest(42L, 5000L, "compensation"));

        // 1) wallet.credit.request 指令（key = playerId）+ payload 內容
        ArgumentCaptor<String> topicCaptor = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> keyCaptor = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> valueCaptor = ArgumentCaptor.forClass(String.class);
        verify(kafkaTemplate).send(topicCaptor.capture(), keyCaptor.capture(), valueCaptor.capture());

        assertThat(topicCaptor.getValue()).isEqualTo("wallet.credit.request");
        assertThat(keyCaptor.getValue()).isEqualTo("42");

        @SuppressWarnings("unchecked")
        Map<String, Object> payload = objectMapper.readValue(valueCaptor.getValue(), Map.class);
        assertThat(payload.get("subType")).isEqualTo("GM_REWARD");
        assertThat(payload.get("playerId")).isEqualTo(42);
        assertThat(payload.get("amount")).isEqualTo(5000);
        assertThat(payload.get("idempotencyKey")).asString().startsWith("gm-grant-admin-1-42-");
        assertThat(payload.get("referenceId")).isEqualTo(payload.get("idempotencyKey"));

        // 2) admin_action_logs 稽核紀錄
        ArgumentCaptor<AdminActionLog> logCaptor = ArgumentCaptor.forClass(AdminActionLog.class);
        verify(actionLogRepository).save(logCaptor.capture());
        AdminActionLog saved = logCaptor.getValue();
        assertThat(saved.getActionType()).isEqualTo("GM_GRANT");
        assertThat(saved.getOperator()).isEqualTo("admin-1");
        assertThat(saved.getTargetPlayerId()).isEqualTo(42L);
        assertThat(saved.getAmount()).isEqualTo(5000L);
        assertThat(saved.getIdempotencyKey()).isEqualTo(payload.get("idempotencyKey"));

        // 3) 回應
        assertThat(response.status()).isEqualTo("QUEUED");
        assertThat(response.idempotencyKey()).isEqualTo(payload.get("idempotencyKey"));
    }
}
