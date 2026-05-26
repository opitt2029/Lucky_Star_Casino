#!/bin/bash

set -euo pipefail

# =============================================================================
# Kafka Topics for Lucky Star Casino
# =============================================================================
# member.registered  - Fired when a new member completes registration
# wallet.debit       - Fired when a debit (spend/withdraw) is applied to a wallet
# wallet.credit      - Fired when a credit (deposit/win) is applied to a wallet
# game.result        - Fired when a game round concludes with an outcome
# rank.update        - Fired when a player's leaderboard ranking changes
# notification.push  - Fired to trigger a push notification to a user
#
# Dead Letter Topics (DLT) — receive events that failed processing after retries
# wallet.debit.DLT   - Failed debit events for manual inspection and reprocessing
# wallet.credit.DLT  - Failed credit events for manual inspection and reprocessing
# =============================================================================

echo "Creating Kafka topics..."

topics=(
  "member.registered"
  "wallet.debit"
  "wallet.credit"
  "game.result"
  "rank.update"
  "notification.push"
)

for topic in "${topics[@]}"; do
  kafka-topics --create \
    --if-not-exists \
    --bootstrap-server lucky-star-kafka:29092 \
    --replication-factor 1 \
    --partitions 3 \
    --topic "${topic}"
done

dlt_topics=(
  "wallet.debit.DLT"
  "wallet.credit.DLT"
)

for topic in "${dlt_topics[@]}"; do
  kafka-topics --create \
    --if-not-exists \
    --bootstrap-server lucky-star-kafka:29092 \
    --replication-factor 1 \
    --partitions 1 \
    --topic "${topic}"
done

echo "Kafka topics created."
