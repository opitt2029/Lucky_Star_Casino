#!/bin/bash

set -euo pipefail

# =============================================================================
# Kafka Topics for Lucky Star Casino
# =============================================================================
# member.registered      - Fired when a new member completes registration
# wallet.debit           - EVENT: a debit (spend) HAS been applied to a wallet
# wallet.credit.request  - COMMAND: please credit a wallet (published by member checkin / new-gift / etc.)
# wallet.credit          - EVENT: a credit (deposit/win) HAS been applied to a wallet (published by wallet-service)
# game.result            - Fired when a game round concludes with an outcome
# rank.update            - Fired when a player's leaderboard ranking changes
# notification.push      - Fired to trigger a push notification to a user
#
# ADR-002: wallet.credit.request 是「指令」(請入帳)，wallet.credit 是「事件」(已入帳)。
#          兩者分離以避免「自己發、自己收」迴圈，並與 wallet.debit(事件) 語意對稱。
#
# Dead Letter Topics (DLT) — receive events that failed processing after retries
# wallet.debit.DLT           - Failed debit events
# wallet.credit.DLT          - Failed credit events
# wallet.credit.request.DLT  - Failed credit-request commands (e.g. bad payload, wallet not found)
# =============================================================================

echo "Creating Kafka topics..."

topics=(
  "member.registered"
  "wallet.debit"
  "wallet.credit.request"
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
  "wallet.credit.request.DLT"
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
