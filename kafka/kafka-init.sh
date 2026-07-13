#!/bin/bash

set -euo pipefail

# =============================================================================
# Kafka Topics for Lucky Star Casino
# =============================================================================
# member.registered      - Fired when a new member completes registration
# wallet.debit           - EVENT: a debit (spend) HAS been applied to a wallet
# wallet.credit.request  - COMMAND: please credit a wallet (published by member checkin / new-gift / etc.)
# wallet.credit          - EVENT: a credit (deposit/win) HAS been applied to a wallet (published by wallet-service)
# friend.relationship.updated - Fired with a player's complete friend list after accepted relationships change
# game.result            - Fired when a game round concludes with an outcome
# rank.update            - Fired when a player's leaderboard ranking changes
# notification.push      - Fired to trigger a push notification to a user
#
# ADR-002: wallet.credit.request 是「指令」(請入帳)，wallet.credit 是「事件」(已入帳)。
#          兩者分離以避免「自己發、自己收」迴圈，並與 wallet.debit(事件) 語意對稱。
#
# Dead Letter Topics (DLT) — receive events that failed processing after retries
# member.registered.DLT       - Failed member registration events
# wallet.debit.DLT           - Failed debit events
# wallet.credit.DLT          - Failed credit events
# wallet.credit.request.DLT  - Failed credit-request commands (e.g. bad payload, wallet not found)
# friend.relationship.updated.DLT - Failed friend relationship update events
# =============================================================================

echo "Creating Kafka topics..."

# 高流量 topic（每筆下注/派彩/遊戲局都會觸發，或多 service 匯聚推播）給較多 partition，
# 讓同 consumer group 未來可以多開 consumer instance 平行消費。
# 注意：wallet.debit/wallet.credit/game.result/notification.push 的 producer 皆以 playerId 當 key
# （notification.push 的 admin 廣播訊息 key 可能為 null），加 partition 不影響同玩家事件的順序保證。
high_throughput_topics=(
  "wallet.debit"
  "wallet.credit.request"
  "wallet.credit"
  "game.result"
  "notification.push"
)

for topic in "${high_throughput_topics[@]}"; do
  kafka-topics --create \
    --if-not-exists \
    --bootstrap-server lucky-star-kafka:29092 \
    --replication-factor 1 \
    --partitions 6 \
    --topic "${topic}"
done

# 低流量 topic：註冊/好友異動不常發生；rank.update 的 producer 用固定 key（GLOBAL_TOP10_TYPE），
# 所有訊息本就落同一 partition，多開 partition 沒有平行消費的效果。
low_throughput_topics=(
  "member.registered"
  "friend.relationship.updated"
  "rank.update"
)

for topic in "${low_throughput_topics[@]}"; do
  kafka-topics --create \
    --if-not-exists \
    --bootstrap-server lucky-star-kafka:29092 \
    --replication-factor 1 \
    --partitions 3 \
    --topic "${topic}"
done

dlt_topics=(
  "member.registered.DLT"
  "wallet.debit.DLT"
  "wallet.credit.DLT"
  "wallet.credit.request.DLT"
  "friend.relationship.updated.DLT"
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
