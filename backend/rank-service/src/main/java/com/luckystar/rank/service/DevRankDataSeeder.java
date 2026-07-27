package com.luckystar.rank.service;

import com.luckystar.rank.dto.RankCategory;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(prefix = "app.dev-seed", name = "enabled", havingValue = "true")
public class DevRankDataSeeder {

    private static final Logger log = LoggerFactory.getLogger(DevRankDataSeeder.class);
    private static final long FIRST_SEED_PLAYER_ID = 900001L;
    private static final String[] NAME_PREFIXES = {
            "Velvet", "Lucky", "Crimson", "Neon", "Golden", "Jade", "Moonlit", "Royal",
            "Midnight", "Starlit", "Ruby", "Sapphire", "Solar", "Ivory", "Mirage", "Aurora"
    };
    private static final String[] NAME_ALIASES = {
            "Ace", "Nova", "Vesper", "Comet", "Crown", "Orbit", "Roulette", "Joker", "Maven",
            "Cipher", "Echo", "Blitz", "Ember", "Quest", "Dealer", "Rider", "Jackpot", "Muse"
    };
    private static final String[] NAME_TITLES = {
            "", "Prime", "Rush", "Bloom", "Spark", "Pulse", "Charm", "Glide", "Flare", "Drift", "Vault", "Wave"
    };

    private final RankService rankService;
    private final StringRedisTemplate redisTemplate;
    private final int playerCount;
    private final long randomSeed;

    public DevRankDataSeeder(
            RankService rankService,
            StringRedisTemplate redisTemplate,
            @Value("${app.dev-seed.player-count:100}") int playerCount,
            @Value("${app.dev-seed.random-seed:20260727}") long randomSeed) {
        this.rankService = rankService;
        this.redisTemplate = redisTemplate;
        this.playerCount = Math.max(100, playerCount);
        this.randomSeed = randomSeed;
    }


    private static String nicknameFor(int index) {
        String prefix = NAME_PREFIXES[(index * 7 + 3) % NAME_PREFIXES.length];
        String alias = NAME_ALIASES[(index * 11 + 5) % NAME_ALIASES.length];
        String title = NAME_TITLES[(index * 13 + 2) % NAME_TITLES.length];
        return title.isBlank() ? prefix + " " + alias : prefix + " " + alias + " " + title;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void seed() {
        Random random = new Random(randomSeed);
        List<Long> friendIds = new ArrayList<>();
        for (int index = 0; index < playerCount; index++) {
            long playerId = FIRST_SEED_PLAYER_ID + index;
            String nickname = nicknameFor(index);
            String username = "dev-rank-" + (index + 1);
            String avatar = "";
            String joinedAt = LocalDate.of(2026, 1, 1).plusDays(index % 180).toString() + "T10:00:00";
            rankService.updatePlayerPublicProfile(playerId, username, nickname, avatar, joinedAt);

            long coins = 2_000_000L - index * 9_250L + random.nextInt(5_000);
            rankService.updatePlayerCoins(playerId, Math.max(10_000L, coins));
            rankService.addDailyWinnings(playerId, Math.max(0L, 95_000L - index * 730L + random.nextInt(2_000)));

            for (RankCategory category : List.of(RankCategory.SLOT, RankCategory.BACCARAT, RankCategory.FISHING)) {
                long totalBet = 25_000L + random.nextInt(300_000);
                long profit = 80_000L - index * 650L + random.nextInt(20_000) - 10_000L;
                long payout = Math.max(0L, totalBet + profit);
                rankService.updateGameResult(playerId, category.name(), totalBet, payout);
            }
            if (index < 8) {
                friendIds.add(playerId);
            }
        }

        // 讓本機第一位測試玩家有固定好友圈；重跑只會覆寫同一批 Redis member，不會新增重複資料。
        rankService.rebuildFriendRank(1L, friendIds);
        redisTemplate.opsForValue().set("rank:dev-seed:last", String.valueOf(randomSeed));
        log.info("Seeded deterministic development rank data players={} seed={}", playerCount, randomSeed);
    }
}
