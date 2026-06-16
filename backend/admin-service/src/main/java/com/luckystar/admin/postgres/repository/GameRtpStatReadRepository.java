package com.luckystar.admin.postgres.repository;

import com.luckystar.admin.postgres.entity.GameRtpStatRead;
import java.time.LocalDateTime;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * 遊戲 RTP 統計唯讀查詢（PostgreSQL）。供 RTP 監控（T-053）。
 */
public interface GameRtpStatReadRepository extends JpaRepository<GameRtpStatRead, Long> {

    List<GameRtpStatRead> findByCalculatedAtBetween(LocalDateTime from, LocalDateTime to);

    List<GameRtpStatRead> findByGameTypeAndCalculatedAtBetween(
            String gameType, LocalDateTime from, LocalDateTime to);
}
