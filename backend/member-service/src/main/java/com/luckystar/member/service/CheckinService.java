package com.luckystar.member.service;

import com.luckystar.member.dto.CheckinResponse;
import com.luckystar.member.entity.DailyCheckin;
import com.luckystar.member.exception.AlreadyCheckedInException;
import com.luckystar.member.repository.DailyCheckinRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

@Slf4j
@Service
@RequiredArgsConstructor
public class CheckinService {

    private static final long DAILY_REWARD_AMOUNT = 100L;

    private final DailyCheckinRepository dailyCheckinRepository;
    private final OutboxService outboxService;

    @Transactional
    public CheckinResponse checkin(Long playerId) {
        // Step 1: today in Asia/Taipei
        LocalDate today = LocalDate.now(ZoneId.of("Asia/Taipei"));

        // Step 2: duplicate check
        if (dailyCheckinRepository.findByPlayerIdAndCheckinDate(playerId, today).isPresent()) {
            throw new AlreadyCheckedInException();
        }

        // Step 3: calculate consecutive days
        int consecutiveDays;
        Optional<DailyCheckin> lastOpt = dailyCheckinRepository
                .findTopByPlayerIdOrderByCheckinDateDesc(playerId);

        if (lastOpt.isPresent() && lastOpt.get().getCheckinDate().equals(today.minusDays(1))) {
            consecutiveDays = lastOpt.get().getConsecutiveDays() + 1;
        } else {
            consecutiveDays = 1;
        }

        // Step 4: persist new checkin record
        DailyCheckin checkin = new DailyCheckin();
        checkin.setPlayerId(playerId);
        checkin.setCheckinDate(today);
        checkin.setConsecutiveDays(consecutiveDays);
        DailyCheckin saved = dailyCheckinRepository.save(checkin);

        long rewardAmount = calculateReward(consecutiveDays);

        // Step 5: 與簽到記錄同一交易寫入 outbox（wallet.credit.request — 入帳「指令」，ADR-002）
        // 不再 best-effort 吞錯：簽到與發獎事件原子綁定，避免「簽到成功卻沒拿到獎勵」
        // wallet-service 消費此指令後才真正加餘額，並另發 wallet.credit「事件」給 rank 等下游
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("playerId", playerId);
        payload.put("amount", rewardAmount);
        payload.put("subType", "CHECKIN");
        payload.put("idempotencyKey", "checkin-" + playerId + "-" + today);
        payload.put("consecutiveDays", consecutiveDays);
        outboxService.save("wallet.credit.request", String.valueOf(playerId), payload);

        // Step 6: return response
        return new CheckinResponse(saved.getId(), today, consecutiveDays, rewardAmount);
    }

    private long calculateReward(int consecutiveDays) {
        return DAILY_REWARD_AMOUNT + switch (consecutiveDays) {
            case 7 -> 1000L;
            case 14 -> 2000L;
            case 21 -> 3000L;
            case 30 -> 5000L;
            default -> 0L;
        };
    }
}
