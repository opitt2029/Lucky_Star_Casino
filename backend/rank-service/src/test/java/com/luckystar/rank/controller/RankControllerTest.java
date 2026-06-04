package com.luckystar.rank.controller;

import com.luckystar.rank.dto.RankEntryResponse;
import com.luckystar.rank.service.RankService;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class RankControllerTest {

    @Mock
    RankService rankService;

    @InjectMocks
    RankController controller;

    @Test
    void getFriendTop20_returnsFriendLeaderboard() {
        List<RankEntryResponse> expected = List.of(
                new RankEntryResponse(2L, 1L, 500L),
                new RankEntryResponse(3L, 2L, 100L));
        when(rankService.getTopFriendCoins(1L)).thenReturn(expected);

        assertThat(controller.getFriendTop20(1L)).isEqualTo(expected);
    }
}
