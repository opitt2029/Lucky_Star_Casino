package com.luckystar.game.repository;

import com.luckystar.game.entity.GameRtpStat;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * {@link GameRtpStat} 資料存取層（T-037）。
 */
public interface GameRtpStatRepository extends JpaRepository<GameRtpStat, Long> {

    /** 取某遊戲最新一筆 RTP 統計（供 API 查詢）。 */
    Optional<GameRtpStat> findTopByGameTypeOrderByCalculatedAtDesc(String gameType);
}
