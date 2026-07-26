package com.luckystar.rank.kafka;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

@JsonIgnoreProperties(ignoreUnknown = true)
public record GameResultEvent(
        @JsonAlias("eventId") String roundId,
        Long playerId,
        String gameType,
        @JsonAlias("betAmount") Long bet,
        @JsonAlias("winAmount") Long payout,
        Boolean win,
        String status,
        String settledAt
) {}
