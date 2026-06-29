package com.luckystar.member.service;

import com.luckystar.member.dto.CheckinStatusResponse;
import com.luckystar.member.dto.MonthlyMilestoneStatus;
import com.luckystar.member.dto.MonthlyRewardClaimResponse;
import com.luckystar.member.entity.DailyCheckin;
import com.luckystar.member.entity.MonthlyRewardClaim;
import com.luckystar.member.exception.InvalidMonthlyMilestoneException;
import com.luckystar.member.exception.MonthlyRewardAlreadyClaimedException;
import com.luckystar.member.exception.MonthlyRewardNotEligibleException;
import com.luckystar.member.repository.DailyCheckinRepository;
import com.luckystar.member.repository.MonthlyRewardClaimRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.YearMonth;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 月度「累計」簽到獎勵：玩家當月累計（非連續）簽到天數達里程碑可手動領取大獎。
 *
 * <p>狀態為後端權威來源（{@link #getStatus}），前端月曆／天數／領取旗標皆讀此。
 * 領取（{@link #claimMonthlyReward}）依 ADR-002：寫 claim 紀錄 + 同交易 outbox 發
 * {@code wallet.credit.request}（subType=MONTHLY_REWARD），由 wallet-service 入帳，
 * 不在本服務直連 wallet DB。範本＝{@link NewGiftService}。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class MonthlyRewardService {

    private static final ZoneId TAIPEI = ZoneId.of("Asia/Taipei");
    private static final DateTimeFormatter MONTH_FMT = DateTimeFormatter.ofPattern("yyyy-MM");

    /** 里程碑（當月累計天數 → 星幣），插入序＝顯示序。 */
    static final Map<Integer, Long> MILESTONES = new LinkedHashMap<>();
    static {
        MILESTONES.put(10, 2000L);
        MILESTONES.put(20, 5000L);
        MILESTONES.put(28, 12000L);
    }

    private final DailyCheckinRepository dailyCheckinRepository;
    private final MonthlyRewardClaimRepository monthlyRewardClaimRepository;
    private final OutboxService outboxService;

    /**
     * 簽到狀態（後端權威）。
     *
     * @param monthParam 可選 yyyy-MM；null/空白＝台北當月。非當月只供顯示，不可領取。
     */
    @Transactional(readOnly = true)
    public CheckinStatusResponse getStatus(Long playerId, String monthParam) {
        YearMonth currentMonth = YearMonth.now(TAIPEI);
        YearMonth month = parseMonth(monthParam, currentMonth);
        boolean isCurrentMonth = month.equals(currentMonth);

        LocalDate start = month.atDay(1);
        LocalDate end = month.atEndOfMonth();

        List<LocalDate> signedDates = dailyCheckinRepository
                .findByPlayerIdAndCheckinDateBetween(playerId, start, end).stream()
                .map(DailyCheckin::getCheckinDate)
                .sorted()
                .collect(Collectors.toList());
        int monthCheckinDays = signedDates.size();

        // 連續天數／今日是否已簽：看玩家最新一筆紀錄（streak 可跨月延續）
        LocalDate today = LocalDate.now(TAIPEI);
        int consecutiveDays = 0;
        boolean checkedInToday = false;
        var lastOpt = dailyCheckinRepository.findTopByPlayerIdOrderByCheckinDateDesc(playerId);
        if (lastOpt.isPresent()) {
            DailyCheckin last = lastOpt.get();
            checkedInToday = last.getCheckinDate().equals(today);
            // streak 僅在最新紀錄為今天或昨天時仍有效
            if (last.getCheckinDate().equals(today) || last.getCheckinDate().equals(today.minusDays(1))) {
                consecutiveDays = last.getConsecutiveDays();
            }
        }

        Set<Integer> claimedDays = monthlyRewardClaimRepository
                .findByPlayerIdAndRewardMonth(playerId, month.format(MONTH_FMT)).stream()
                .map(MonthlyRewardClaim::getMilestoneDays)
                .collect(Collectors.toSet());

        List<MonthlyMilestoneStatus> milestones = new ArrayList<>();
        for (Map.Entry<Integer, Long> e : MILESTONES.entrySet()) {
            int days = e.getKey();
            boolean reached = monthCheckinDays >= days;
            boolean claimed = claimedDays.contains(days);
            boolean claimable = reached && !claimed && isCurrentMonth;
            milestones.add(new MonthlyMilestoneStatus(days, e.getValue(), reached, claimed, claimable));
        }
        milestones.sort(Comparator.comparing(MonthlyMilestoneStatus::milestoneDays));

        return new CheckinStatusResponse(
                month.format(MONTH_FMT), signedDates, monthCheckinDays,
                consecutiveDays, checkedInToday, milestones);
    }

    /**
     * 領取當月某里程碑的累計簽到獎勵（僅限當月）。
     *
     * @throws InvalidMonthlyMilestoneException   里程碑不在允許清單（400）
     * @throws MonthlyRewardNotEligibleException  當月累計天數未達標（422）
     * @throws MonthlyRewardAlreadyClaimedException 已領取（409）
     */
    @Transactional
    public MonthlyRewardClaimResponse claimMonthlyReward(Long playerId, Integer milestoneDays) {
        // Step 1: 驗里程碑有效
        Long rewardAmount = MILESTONES.get(milestoneDays);
        if (rewardAmount == null) {
            throw new InvalidMonthlyMilestoneException(milestoneDays);
        }

        // Step 2: 領取僅限台北當月
        YearMonth month = YearMonth.now(TAIPEI);
        String rewardMonth = month.format(MONTH_FMT);
        LocalDate start = month.atDay(1);
        LocalDate end = month.atEndOfMonth();

        // Step 3: 達標檢查（當月累計天數）
        long monthCheckinDays = dailyCheckinRepository
                .countByPlayerIdAndCheckinDateBetween(playerId, start, end);
        if (monthCheckinDays < milestoneDays) {
            throw new MonthlyRewardNotEligibleException(milestoneDays, monthCheckinDays);
        }

        // Step 4: 冪等（應用層先擋，DB UNIQUE 為最終保險）
        if (monthlyRewardClaimRepository
                .existsByPlayerIdAndRewardMonthAndMilestoneDays(playerId, rewardMonth, milestoneDays)) {
            throw new MonthlyRewardAlreadyClaimedException(milestoneDays);
        }

        // Step 5: 寫領取紀錄
        MonthlyRewardClaim claim = new MonthlyRewardClaim();
        claim.setPlayerId(playerId);
        claim.setRewardMonth(rewardMonth);
        claim.setMilestoneDays(milestoneDays);
        claim.setRewardAmount(rewardAmount);
        monthlyRewardClaimRepository.save(claim);

        // Step 6: 同交易寫 outbox（wallet.credit.request 入帳「指令」，ADR-002）
        // 紀錄與發獎事件原子綁定，避免「已標記領取卻沒發錢」。
        // idempotencyKey 與 DB UNIQUE 雙重冪等：wallet 端對同 key 只入帳一次。
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("playerId", playerId);
        payload.put("amount", rewardAmount);
        payload.put("subType", "MONTHLY_REWARD");
        payload.put("idempotencyKey", "monthly-reward-" + playerId + "-" + rewardMonth + "-" + milestoneDays);
        payload.put("milestoneDays", milestoneDays);
        outboxService.save("wallet.credit.request", String.valueOf(playerId), payload);

        log.info("Monthly reward queued to outbox playerId={} month={} milestone={} amount={}",
                playerId, rewardMonth, milestoneDays, rewardAmount);

        return new MonthlyRewardClaimResponse(milestoneDays, rewardAmount, rewardMonth, (int) monthCheckinDays);
    }

    private YearMonth parseMonth(String monthParam, YearMonth fallback) {
        if (monthParam == null || monthParam.isBlank()) {
            return fallback;
        }
        try {
            return YearMonth.parse(monthParam.trim(), MONTH_FMT);
        } catch (DateTimeParseException ex) {
            // 格式錯誤不致命，退回當月（與「狀態查詢盡量可用」一致）
            log.warn("Invalid month param '{}', fallback to {}", monthParam, fallback);
            return fallback;
        }
    }
}
