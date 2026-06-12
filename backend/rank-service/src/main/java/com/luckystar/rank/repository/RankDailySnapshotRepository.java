package com.luckystar.rank.repository;

import com.luckystar.rank.entity.RankDailySnapshot;
import java.time.LocalDate;
import java.util.Set;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface RankDailySnapshotRepository extends JpaRepository<RankDailySnapshot, Long> {

    @Query("select snapshot.playerId from RankDailySnapshot snapshot where snapshot.snapshotDate = :snapshotDate")
    Set<Long> findPlayerIdsBySnapshotDate(@Param("snapshotDate") LocalDate snapshotDate);
}
