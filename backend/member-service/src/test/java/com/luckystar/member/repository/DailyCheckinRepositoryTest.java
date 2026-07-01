package com.luckystar.member.repository;

import com.luckystar.member.entity.DailyCheckin;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;

import java.time.LocalDate;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 驗證月度累計用的兩個區間查詢，重點在「跨月界只算當月」。
 */
@DataJpaTest
class DailyCheckinRepositoryTest {

    @Autowired
    private TestEntityManager em;

    @Autowired
    private DailyCheckinRepository dailyCheckinRepository;

    private static final Long PLAYER_ID = 7L;

    @BeforeEach
    void setUp() {
        // 上月底 1 天 + 本月 3 天（含月初/月底邊界）+ 下月初 1 天
        persist(PLAYER_ID, LocalDate.of(2026, 5, 31), 1);
        persist(PLAYER_ID, LocalDate.of(2026, 6, 1), 1);
        persist(PLAYER_ID, LocalDate.of(2026, 6, 15), 2);
        persist(PLAYER_ID, LocalDate.of(2026, 6, 30), 3);
        persist(PLAYER_ID, LocalDate.of(2026, 7, 1), 1);
        // 別的玩家當月也簽到，不應被算進 PLAYER_ID
        persist(99L, LocalDate.of(2026, 6, 10), 1);
    }

    @Test
    void countByPlayerIdAndCheckinDateBetween_onlyCountsTargetMonthAndPlayer() {
        long count = dailyCheckinRepository.countByPlayerIdAndCheckinDateBetween(
                PLAYER_ID, LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 30));

        assertThat(count).isEqualTo(3);
    }

    @Test
    void findByPlayerIdAndCheckinDateBetween_returnsOnlyMonthDatesInclusiveBoundaries() {
        List<DailyCheckin> rows = dailyCheckinRepository.findByPlayerIdAndCheckinDateBetween(
                PLAYER_ID, LocalDate.of(2026, 6, 1), LocalDate.of(2026, 6, 30));

        assertThat(rows).extracting(DailyCheckin::getCheckinDate)
                .containsExactlyInAnyOrder(
                        LocalDate.of(2026, 6, 1),
                        LocalDate.of(2026, 6, 15),
                        LocalDate.of(2026, 6, 30));
    }

    private void persist(Long playerId, LocalDate date, int consecutiveDays) {
        DailyCheckin c = new DailyCheckin();
        c.setPlayerId(playerId);
        c.setCheckinDate(date);
        c.setConsecutiveDays(consecutiveDays);
        em.persistAndFlush(c);
    }
}
