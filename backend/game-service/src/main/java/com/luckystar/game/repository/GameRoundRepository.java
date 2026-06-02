package com.luckystar.game.repository;

import com.luckystar.game.entity.GameRound;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * {@link GameRound} 的資料存取層。
 */
public interface GameRoundRepository extends JpaRepository<GameRound, Long> {

    /** 依對外 roundId 查詢（供 T-036 公平性驗證等用途）。 */
    Optional<GameRound> findByRoundId(String roundId);
}
