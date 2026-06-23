package com.luckystar.game.repository;

import com.luckystar.game.entity.CashbackRecord;
import java.time.LocalDate;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CashbackRecordRepository extends JpaRepository<CashbackRecord, Long> {

    boolean existsByPlayerIdAndPeriodTypeAndPeriodStart(Long playerId, String periodType, LocalDate periodStart);
}
