-- T-091 accounting reconciliation checks.
-- Run this against the PostgreSQL write database after the slot load test.
-- The script returns one CSV-friendly result set:
-- check_name, violation_count, description.

WITH ordered_transactions AS (
    SELECT
        id,
        player_id,
        type,
        amount,
        balance_before,
        balance_after,
        idempotency_key,
        created_at,
        LAG(balance_after) OVER (
            PARTITION BY player_id
            ORDER BY created_at, id
        ) AS previous_balance_after
    FROM wallet_transactions
),
transaction_rollup AS (
    SELECT
        player_id,
        (ARRAY_AGG(balance_before ORDER BY created_at, id))[1] AS opening_balance,
        SUM(
            CASE
                WHEN type = 'DEBIT' THEN -amount
                WHEN type IN ('CREDIT', 'BONUS') THEN amount
                ELSE 0
            END
        ) AS signed_amount,
        (ARRAY_AGG(balance_after ORDER BY created_at DESC, id DESC))[1] AS latest_balance_after,
        COUNT(*) AS transaction_count
    FROM wallet_transactions
    GROUP BY player_id
),
wallet_reconciliation AS (
    SELECT
        COALESCE(w.player_id, r.player_id) AS player_id,
        w.player_id IS NULL AS missing_wallet,
        r.player_id IS NULL AS missing_transactions,
        w.balance AS wallet_balance,
        w.frozen_amount,
        COALESCE(r.opening_balance, 0) AS opening_balance,
        COALESCE(r.signed_amount, 0) AS signed_amount,
        COALESCE(r.opening_balance, 0) + COALESCE(r.signed_amount, 0) AS expected_balance,
        r.latest_balance_after,
        COALESCE(r.transaction_count, 0) AS transaction_count
    FROM wallets w
    FULL OUTER JOIN transaction_rollup r ON r.player_id = w.player_id
),
duplicate_idempotency_keys AS (
    SELECT idempotency_key
    FROM wallet_transactions
    WHERE idempotency_key IS NOT NULL
    GROUP BY idempotency_key
    HAVING COUNT(*) > 1
),
check_results AS (
    SELECT
        'wallet_balance_matches_transaction_sum' AS check_name,
        COUNT(*)::BIGINT AS violation_count,
        'wallets.balance must equal first balance_before plus signed wallet_transactions amounts' AS description
    FROM wallet_reconciliation
    WHERE NOT missing_wallet
      AND wallet_balance <> expected_balance

    UNION ALL

    SELECT
        'wallet_balance_matches_latest_transaction' AS check_name,
        COUNT(*)::BIGINT AS violation_count,
        'wallets.balance must equal latest wallet_transactions.balance_after when transactions exist' AS description
    FROM wallet_reconciliation
    WHERE NOT missing_wallet
      AND NOT missing_transactions
      AND wallet_balance <> latest_balance_after

    UNION ALL

    SELECT
        'transactions_without_wallet' AS check_name,
        COUNT(*)::BIGINT AS violation_count,
        'every transaction player_id must have a wallets row' AS description
    FROM wallet_reconciliation
    WHERE missing_wallet

    UNION ALL

    SELECT
        'negative_wallet_balances' AS check_name,
        COUNT(*)::BIGINT AS violation_count,
        'wallets.balance must never be negative' AS description
    FROM wallets
    WHERE balance < 0

    UNION ALL

    SELECT
        'nonzero_frozen_amounts' AS check_name,
        COUNT(*)::BIGINT AS violation_count,
        'all wallets.frozen_amount values must be zero after the pressure test' AS description
    FROM wallets
    WHERE frozen_amount <> 0

    UNION ALL

    SELECT
        'frozen_amount_exceeds_balance' AS check_name,
        COUNT(*)::BIGINT AS violation_count,
        'wallets.frozen_amount must never exceed wallets.balance' AS description
    FROM wallets
    WHERE frozen_amount > balance

    UNION ALL

    SELECT
        'transaction_delta_mismatches' AS check_name,
        COUNT(*)::BIGINT AS violation_count,
        'each transaction balance_after must equal balance_before +/- amount according to type' AS description
    FROM ordered_transactions
    WHERE balance_before IS NULL
       OR balance_after IS NULL
       OR (type = 'DEBIT' AND balance_after <> balance_before - amount)
       OR (type IN ('CREDIT', 'BONUS') AND balance_after <> balance_before + amount)

    UNION ALL

    SELECT
        'transaction_chain_breaks' AS check_name,
        COUNT(*)::BIGINT AS violation_count,
        'each player transaction balance_before must continue from the previous balance_after' AS description
    FROM ordered_transactions
    WHERE previous_balance_after IS NOT NULL
      AND balance_before <> previous_balance_after

    UNION ALL

    SELECT
        'duplicate_idempotency_keys' AS check_name,
        COUNT(*)::BIGINT AS violation_count,
        'nonnull wallet_transactions.idempotency_key values must be unique' AS description
    FROM duplicate_idempotency_keys
)
SELECT check_name, violation_count, description
FROM check_results
ORDER BY check_name;
