package com.luckystar.game.repository;

import com.luckystar.game.entity.GameRound;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * {@link GameRound} 的資料存取層。
 */
public interface GameRoundRepository extends JpaRepository<GameRound, Long> {

    /** 依對外 roundId 查詢（供 T-036 公平性驗證等用途）。 */
    Optional<GameRound> findByRoundId(String roundId);

    /**
     * 統計某遊戲「近 {@code limit} 局」已結算對局的下注/派彩總額與局數（T-037 RTP）。
     *
     * <p>以子查詢先取最近 N 局（依 created_at 由新到舊），再彙總；{@code COALESCE} 確保無資料時回 0。
     * 回傳單列 {@code [totalBet, totalWin, roundCount]}，元素皆為 {@link Number}（不同 DB 可能回
     * BigInteger/BigDecimal/Long，呼叫端以 {@code longValue()} 取值）。LIMIT 語法同時相容 PostgreSQL 與
     * 測試用 H2（PostgreSQL 相容模式）。
     */
    @Query(value = "SELECT COALESCE(SUM(t.bet_amount), 0), COALESCE(SUM(t.win_amount), 0), COUNT(*) "
            + "FROM (SELECT bet_amount, win_amount FROM game_rounds "
            + "WHERE game_type = :gameType AND status = 'SETTLED' "
            + "ORDER BY created_at DESC LIMIT :limit) t", nativeQuery = true)
    List<Object[]> aggregateRecent(@Param("gameType") String gameType, @Param("limit") int limit);

    /**
     * 查詢指定玩家在指定遊戲今日的下注/派彩總額（風控水位用）。
     * 回傳單列 {@code [totalBet, totalWin, roundCount]}。
     */
    @Query("""
            SELECT COALESCE(SUM(r.betAmount), 0), COALESCE(SUM(r.winAmount), 0), COUNT(r)
            FROM GameRound r
            WHERE r.playerId = :playerId
              AND r.gameType = :gameType
              AND r.status = 'SETTLED'
              AND r.settledAt >= :startOfDay
            """)
    List<Object[]> aggregatePlayerToday(
            @Param("playerId") long playerId,
            @Param("gameType") String gameType,
            @Param("startOfDay") LocalDateTime startOfDay);

    /**
     * 彙整指定期間內所有玩家的已結算對局，回傳「淨虧損 > 0」的玩家清單。
     * 回傳欄位：[player_id(Long), total_bet(Number), total_win(Number)]。
     * HAVING 直接篩掉不虧損的玩家，減少後端計算量。
     */
    @Query(value = """
            SELECT player_id,
                   COALESCE(SUM(bet_amount), 0) AS total_bet,
                   COALESCE(SUM(win_amount), 0) AS total_win
            FROM game_rounds
            WHERE status = 'SETTLED'
              AND settled_at >= :start
              AND settled_at < :end
            GROUP BY player_id
            HAVING SUM(bet_amount) > SUM(win_amount)
            """, nativeQuery = true)
    List<Object[]> aggregateNetLossPerPlayer(
            @Param("start") LocalDateTime start,
            @Param("end") LocalDateTime end);
}
