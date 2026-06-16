package com.luckystar.rank.repository;

import com.luckystar.rank.entity.RankHistory;
import java.time.LocalDate;
import org.springframework.data.jpa.repository.JpaRepository;

public interface RankHistoryRepository extends JpaRepository<RankHistory, Long> {

    boolean existsByWeekStartAndRank(LocalDate weekStart, Integer rank);
}
