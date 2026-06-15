package com.luckystar.admin.postgres.repository;

import com.luckystar.admin.postgres.entity.GameRoundRead;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * 對局紀錄唯讀查詢（PostgreSQL）。供玩家詳情近期對局（T-051）。
 */
public interface GameRoundReadRepository extends JpaRepository<GameRoundRead, Long> {

    List<GameRoundRead> findTop20ByPlayerIdOrderByCreatedAtDesc(Long playerId);
}
