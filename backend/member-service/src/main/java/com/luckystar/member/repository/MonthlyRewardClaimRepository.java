package com.luckystar.member.repository;

import com.luckystar.member.entity.MonthlyRewardClaim;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface MonthlyRewardClaimRepository extends JpaRepository<MonthlyRewardClaim, Long> {

    /** 取某玩家某年月已領取的所有里程碑（供 status 標記 claimed）。 */
    List<MonthlyRewardClaim> findByPlayerIdAndRewardMonth(Long playerId, String rewardMonth);

    /** 是否已領過某年月的某里程碑（領取前的應用層冪等檢查，DB UNIQUE 為最終保險）。 */
    boolean existsByPlayerIdAndRewardMonthAndMilestoneDays(Long playerId, String rewardMonth, Integer milestoneDays);
}
