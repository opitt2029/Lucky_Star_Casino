package com.luckystar.rank.repository;

import com.luckystar.rank.dto.PlayerCoinBalance;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class WalletBalanceReadRepository {

    private final JdbcTemplate jdbcTemplate;

    public WalletBalanceReadRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public List<PlayerCoinBalance> findAllWalletBalances() {
        return jdbcTemplate.query(
                "SELECT player_id, balance FROM wallets WHERE balance >= 0",
                (rs, rowNum) -> new PlayerCoinBalance(
                        rs.getLong("player_id"),
                        rs.getLong("balance")));
    }
}
