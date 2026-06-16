package com.luckystar.rank.repository;

import com.luckystar.rank.dto.PlayerCoinBalance;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class WalletBalanceReadRepositoryTest {

    @Mock
    JdbcTemplate jdbcTemplate;

    @Test
    void findAllWalletBalances_readsNonNegativeWalletBalances() {
        WalletBalanceReadRepository repository = new WalletBalanceReadRepository(jdbcTemplate);
        List<PlayerCoinBalance> balances = List.of(
                new PlayerCoinBalance(7L, 9000L),
                new PlayerCoinBalance(42L, 1500L));
        when(jdbcTemplate.query(eq("SELECT player_id, balance FROM wallets WHERE balance >= 0"), any(RowMapper.class)))
                .thenReturn(balances);

        List<PlayerCoinBalance> result = repository.findAllWalletBalances();

        assertThat(result).isEqualTo(balances);
        verify(jdbcTemplate).query(eq("SELECT player_id, balance FROM wallets WHERE balance >= 0"), any(RowMapper.class));
    }
}
