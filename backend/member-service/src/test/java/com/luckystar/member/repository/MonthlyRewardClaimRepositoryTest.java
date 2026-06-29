package com.luckystar.member.repository;

import com.luckystar.member.entity.MonthlyRewardClaim;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;
import org.springframework.dao.DataIntegrityViolationException;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@DataJpaTest
class MonthlyRewardClaimRepositoryTest {

    @Autowired
    private TestEntityManager em;

    @Autowired
    private MonthlyRewardClaimRepository repository;

    private static final Long PLAYER_ID = 7L;

    @Test
    void findByPlayerIdAndRewardMonth_returnsOnlyThatPlayerAndMonth() {
        persist(PLAYER_ID, "2026-06", 10, 2000L);
        persist(PLAYER_ID, "2026-06", 20, 5000L);
        persist(PLAYER_ID, "2026-05", 10, 2000L); // 別月
        persist(99L, "2026-06", 10, 2000L);       // 別人

        List<MonthlyRewardClaim> rows = repository.findByPlayerIdAndRewardMonth(PLAYER_ID, "2026-06");

        assertThat(rows).hasSize(2)
                .extracting(MonthlyRewardClaim::getMilestoneDays)
                .containsExactlyInAnyOrder(10, 20);
    }

    @Test
    void existsByPlayerIdAndRewardMonthAndMilestoneDays_reflectsPresence() {
        persist(PLAYER_ID, "2026-06", 10, 2000L);

        assertThat(repository.existsByPlayerIdAndRewardMonthAndMilestoneDays(PLAYER_ID, "2026-06", 10)).isTrue();
        assertThat(repository.existsByPlayerIdAndRewardMonthAndMilestoneDays(PLAYER_ID, "2026-06", 20)).isFalse();
        assertThat(repository.existsByPlayerIdAndRewardMonthAndMilestoneDays(PLAYER_ID, "2026-07", 10)).isFalse();
    }

    @Test
    void uniqueConstraint_samePlayerMonthMilestone_throwsOnDuplicate() {
        persist(PLAYER_ID, "2026-06", 10, 2000L);

        // 經由 repository 代理觸發 Spring 的持久化例外轉譯（→ DataIntegrityViolationException）
        assertThatThrownBy(() -> repository.saveAndFlush(build(PLAYER_ID, "2026-06", 10, 2000L)))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    private MonthlyRewardClaim build(Long playerId, String rewardMonth, int milestoneDays, long rewardAmount) {
        MonthlyRewardClaim claim = new MonthlyRewardClaim();
        claim.setPlayerId(playerId);
        claim.setRewardMonth(rewardMonth);
        claim.setMilestoneDays(milestoneDays);
        claim.setRewardAmount(rewardAmount);
        return claim;
    }

    private void persist(Long playerId, String rewardMonth, int milestoneDays, long rewardAmount) {
        em.persistAndFlush(build(playerId, rewardMonth, milestoneDays, rewardAmount));
    }
}
