package com.luckystar.member.service;

import com.luckystar.member.entity.Member;
import com.luckystar.member.repository.MemberRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

@Slf4j
@Service
@RequiredArgsConstructor
public class NewGiftService {

    private final MemberRepository memberRepository;
    private final OutboxService outboxService;

    @Transactional
    public void processNewGift(Long playerId) {
        // Step 1: load member
        Optional<Member> opt = memberRepository.findById(playerId);
        if (opt.isEmpty()) {
            log.warn("Member not found for playerId={}, skipping new gift", playerId);
            return;
        }
        Member member = opt.get();

        // Step 2: idempotency guard
        if (Boolean.TRUE.equals(member.getIsNewGiftClaimed())) {
            log.info("New gift already claimed for playerId={}, skipping", playerId);
            return;
        }

        // Step 3: 設旗標
        member.setIsNewGiftClaimed(true);
        memberRepository.save(member);

        // Step 4: 與旗標寫入同一交易寫入 outbox（wallet.credit.request — 入帳「指令」，ADR-002）
        // 旗標與事件要嘛一起 commit、要嘛一起 rollback，徹底解決「已標記領取卻沒發錢」的空窗
        // wallet-service 消費此指令後才真正加餘額，並另發 wallet.credit「事件」給 rank 等下游
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("playerId", playerId);
        payload.put("amount", 100L);
        payload.put("subType", "GM_REWARD");
        payload.put("idempotencyKey", "new-gift-" + playerId);
        payload.put("reason", "new player gift");
        outboxService.save("wallet.credit.request", String.valueOf(playerId), payload);

        log.info("New gift queued to outbox for playerId={}", playerId);
    }
}
