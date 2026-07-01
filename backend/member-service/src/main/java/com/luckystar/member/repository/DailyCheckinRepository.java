package com.luckystar.member.repository;

import com.luckystar.member.entity.DailyCheckin;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

public interface DailyCheckinRepository extends JpaRepository<DailyCheckin, Long> {

    Optional<DailyCheckin> findByPlayerIdAndCheckinDate(Long playerId, LocalDate date);

    Optional<DailyCheckin> findTopByPlayerIdOrderByCheckinDateDesc(Long playerId);

    /** 某玩家在 [start, end] 期間（含端點）的簽到天數，供月度累計里程碑判定。 */
    long countByPlayerIdAndCheckinDateBetween(Long playerId, LocalDate start, LocalDate end);

    /** 某玩家在 [start, end] 期間（含端點）的所有簽到紀錄，供前端月曆顯示已簽日期。 */
    List<DailyCheckin> findByPlayerIdAndCheckinDateBetween(Long playerId, LocalDate start, LocalDate end);
}
