package com.luckystar.admin.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

@ExtendWith(MockitoExtension.class)
class PlayerBanServiceTest {

    @Mock
    StringRedisTemplate redisTemplate;

    @Mock
    ValueOperations<String, String> valueOperations;

    @Test
    void ban_writesDisabledKey() {
        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        PlayerBanService service = new PlayerBanService(redisTemplate);

        service.ban(7L);

        verify(valueOperations).set("disabled:player:7", "1");
    }

    @Test
    void unban_deletesDisabledKey() {
        PlayerBanService service = new PlayerBanService(redisTemplate);

        service.unban(7L);

        verify(redisTemplate).delete("disabled:player:7");
    }

    @Test
    void isBanned_reflectsKeyPresence() {
        when(redisTemplate.hasKey("disabled:player:7")).thenReturn(true);
        PlayerBanService service = new PlayerBanService(redisTemplate);

        assertThat(service.isBanned(7L)).isTrue();
    }
}
