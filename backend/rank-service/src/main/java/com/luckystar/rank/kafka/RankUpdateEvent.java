package com.luckystar.rank.kafka;

import com.luckystar.rank.dto.RankEntryResponse;
import java.util.List;

public record RankUpdateEvent(
        String type,
        List<RankEntryResponse> entries,
        long updatedAt) {
}
