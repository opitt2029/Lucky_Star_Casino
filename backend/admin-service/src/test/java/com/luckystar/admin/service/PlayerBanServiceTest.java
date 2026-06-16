package com.luckystar.admin.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Duration;
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
    void ban_writesDisabledKey_andMinIat_andDeletesRefresh() {
        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        PlayerBanService service = new PlayerBanService(redisTemplate);

        service.ban(7L);

        // 即時封鎖標記
        verify(valueOperations).set("disabled:player:7", "1");
        // 簽發時間下限（帶 TTL）：讓停用前的舊 token 啟用後也不復活
        verify(valueOperations).set(eq("token:min-iat:7"), anyString(), any(Duration.class));
        // 作廢既有 refresh token，避免停用前的 refresh token 啟用後換發新 access token
        verify(redisTemplate).delete("refresh:7");
    }

    @Test
    void unban_deletesDisabledKey_butKeepsMinIat() {
        PlayerBanService service = new PlayerBanService(redisTemplate);

        service.unban(7L);

        verify(redisTemplate).delete("disabled:player:7");
        // 不可刪 token:min-iat，否則停用前簽發的舊 token 會在啟用後復活
        verify(redisTemplate, never()).delete("token:min-iat:7");
    }

    @Test
    void isBanned_reflectsKeyPresence() {
        when(redisTemplate.hasKey("disabled:player:7")).thenReturn(true);
        PlayerBanService service = new PlayerBanService(redisTemplate);

        assertThat(service.isBanned(7L)).isTrue();
    }
}
