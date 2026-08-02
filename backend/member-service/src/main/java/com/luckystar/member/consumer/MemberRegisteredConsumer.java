package com.luckystar.member.consumer;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.luckystar.member.dto.MemberRegisteredEvent;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.support.Acknowledgment;
import org.springframework.stereotype.Component;

@Slf4j
@Component
@RequiredArgsConstructor
public class MemberRegisteredConsumer {

    private final ObjectMapper objectMapper;

    @KafkaListener(topics = "member.registered", groupId = "member-service-group")
    public void onMemberRegistered(String message, Acknowledgment ack) throws JsonProcessingException {
        // 不再自行 try-catch 吞例外：
        // - 解析/處理失敗時直接拋例外，交給 KafkaConfig 的 DefaultErrorHandler 統一處理
        //   （重試 + backoff，仍失敗則送進 member.registered.DLT，避免毒丸訊息卡死 partition）
        // - 成功才 ack，offset 才會前進；NewGiftService 內的冪等防線確保重投不會重複發放
        MemberRegisteredEvent event = objectMapper.readValue(message, MemberRegisteredEvent.class);
        log.info("Member registered event consumed for manual new gift claim playerId={}", event.playerId());
        ack.acknowledge();
    }
}
