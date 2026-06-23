# 提示詞：獲利攔截風控系統

你是這個 Lucky Star Casino monorepo 的後端開發者。
專案：Java 21 / Spring Boot 3.3.5，套件根 `com.luckystar`。
後端 game-service 位於 `backend/game-service/`。

已有基礎：
- `RtpStatsService.java`：每小時批次統計各遊戲全局 RTP（`game_rtp_stats` 表）。
- `GameRoundRepository.java`：對局紀錄，已有 `aggregateRecent` 可查近 N 局下注/派彩。
- `FishingService.java`：捕魚機結算、射擊處理。
- `SlotService.java`：老虎機下注結算。
- `BaccaratService.java`：百家樂下注結算。

---

## 需求

每個遊戲在派彩前，風控系統需檢查：

1. **單一玩家水位**：該玩家今日在此遊戲的累計淨贏（`totalWin - totalBet`）是否超過上限。
2. **全局遊戲 RTP**：近 N 局的全局 RTP 是否超過設定上限（防止平台短期大幅虧損）。

超過任一上限時，本局**降低中獎機率**（不直接拒絕，避免玩家察覺），具體方式：
- 老虎機：強制本局結果為未中獎（跳過 `guaranteedSpin`，也不觸發 critical）。
- 捕魚機：本批所有子彈強制未命中（`hit = false`）。
- 百家樂：由莊家贏（`outcome = BANKER`），視為正常結算。

閾值透過 Spring `@Value` 注入，可由 `application.yml` / 環境變數動態設定，不寫死在程式碼裡。

---

## 實作指引

### Step 1：新增 `RiskControlService`

**新建**：`backend/game-service/src/main/java/com/luckystar/game/service/RiskControlService.java`

```java
package com.luckystar.game.service;

import com.luckystar.game.repository.GameRoundRepository;
import java.time.LocalDate;
import java.time.LocalDateTime;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * 風控攔截服務。
 *
 * <p>在每局派彩前檢查兩個維度：
 * <ul>
 *   <li>單一玩家今日淨贏是否超過上限（{@code risk.player-win-limit}）。</li>
 *   <li>近 N 局全局 RTP 是否超過上限（{@code risk.global-rtp-limit}）。</li>
 * </ul>
 * 任一超過則回傳 {@code true}（「應攔截」），由呼叫端決定介入方式。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class RiskControlService {

    /** 單一玩家今日淨贏上限（星幣）。預設 50,000。 */
    @Value("${risk.player-win-limit:50000}")
    private long playerWinLimit;

    /** 全局 RTP 上限（0-1 之間的小數）。預設 0.95（95%）。 */
    @Value("${risk.global-rtp-limit:0.95}")
    private double globalRtpLimit;

    /** 計算全局 RTP 時使用的近 N 局樣本數。 */
    @Value("${risk.rtp-sample-size:500}")
    private int rtpSampleSize;

    private final GameRoundRepository roundRepository;

    /**
     * 判斷本局是否應被風控攔截。
     *
     * @param playerId 玩家 ID
     * @param gameType 遊戲類型（SLOT / FISHING / BACCARAT）
     * @return true = 應攔截（本局介入）；false = 正常放行
     */
    public boolean shouldIntercept(long playerId, String gameType) {
        if (isPlayerOverLimit(playerId, gameType)) {
            log.warn("[風控] 玩家今日淨贏超限 playerId={} gameType={}", playerId, gameType);
            return true;
        }
        if (isGlobalRtpOverLimit(gameType)) {
            log.warn("[風控] 全局 RTP 超限 gameType={}", gameType);
            return true;
        }
        return false;
    }

    /** 今日該玩家在此遊戲的淨贏是否超過上限。 */
    private boolean isPlayerOverLimit(long playerId, String gameType) {
        LocalDateTime startOfDay = LocalDate.now().atStartOfDay();
        Object[] agg = firstRow(
            roundRepository.aggregatePlayerToday(playerId, gameType, startOfDay));
        long totalBet = toLong(agg[0]);
        long totalWin = toLong(agg[1]);
        long netWin = totalWin - totalBet;
        return netWin >= playerWinLimit;
    }

    /** 近 rtpSampleSize 局的全局 RTP 是否超過上限。 */
    private boolean isGlobalRtpOverLimit(String gameType) {
        Object[] agg = firstRow(
            roundRepository.aggregateRecent(gameType, rtpSampleSize));
        long totalBet = toLong(agg[0]);
        long totalWin = toLong(agg[1]);
        if (totalBet <= 0) return false;
        double rtp = (double) totalWin / totalBet;
        return rtp >= globalRtpLimit;
    }

    private static Object[] firstRow(java.util.List<Object[]> rows) {
        if (rows == null || rows.isEmpty() || rows.get(0) == null)
            return new Object[]{0L, 0L, 0L};
        return rows.get(0);
    }

    private static long toLong(Object value) {
        return value == null ? 0L : ((Number) value).longValue();
    }
}
```

---

### Step 2：在 `GameRoundRepository` 新增今日玩家查詢

**檔案**：`backend/game-service/src/main/java/com/luckystar/game/repository/GameRoundRepository.java`

新增 JPQL 查詢（參考現有 `aggregateRecent` 的寫法）：

```java
/**
 * 查詢指定玩家在指定遊戲今日的下注/派彩總額。
 * 回傳 Object[][]：[0] = [totalBet, totalWin, roundCount]
 */
@Query("""
    SELECT SUM(r.betAmount), SUM(r.winAmount), COUNT(r)
    FROM GameRound r
    WHERE r.playerId = :playerId
      AND r.gameType = :gameType
      AND r.status = 'SETTLED'
      AND r.settledAt >= :startOfDay
    """)
List<Object[]> aggregatePlayerToday(
    @Param("playerId") long playerId,
    @Param("gameType") String gameType,
    @Param("startOfDay") java.time.LocalDateTime startOfDay);
```

---

### Step 3：整合到 `SlotService`

**檔案**：`backend/game-service/src/main/java/com/luckystar/game/service/SlotService.java`

1. 注入 `RiskControlService`（加在 `@RequiredArgsConstructor` 的 field）：
   ```java
   private final RiskControlService riskControlService;
   ```

2. 在 `settleInternal` 方法中，RNG 計算後、派彩前插入攔截邏輯：

   ```java
   // 2) 以三元組推導確定性結果。
   RandomStream stream = rng.stream(serverSeed, clientSeed, NONCE);
   SlotOutcome outcome = slotMachine.spin(stream, bet);

   // 2.5) 風控攔截：超限時強制未中獎。
   boolean intercepted = riskControlService.shouldIntercept(playerId, GAME_TYPE);
   if (intercepted && outcome.win()) {
       // 強制覆蓋為未中獎結果（保留盤面，只清中線）
       outcome = SlotOutcome.noWin(outcome.grid(), bet);
   }

   // 3) 命中則派彩（冪等）。
   ```

3. `SlotOutcome` 需要新增靜態工廠方法 `noWin`（或在 `SlotMachine` 加輔助方法）：

   **`backend/game-service/src/main/java/com/luckystar/game/slot/SlotOutcome.java`**
   ```java
   /** 強制未中獎結果（保留盤面顯示，派彩 = 0，無中線）。 */
   public static SlotOutcome noWin(String[][] grid, long bet) {
       return new SlotOutcome(grid, false, 0, 0L, new int[0][]);
   }
   ```
   （`SlotOutcome` 為 record 或有 all-args constructor，依現有結構調整）

---

### Step 4：整合到 `FishingService`

**檔案**：`backend/game-service/src/main/java/com/luckystar/game/service/FishingService.java`

1. 注入 `RiskControlService`。

2. 在 `processShots`（批次子彈判定）中，若風控觸發，整批強制未命中：

   ```java
   // 在 processShots 開頭加判斷
   boolean intercepted = riskControlService.shouldIntercept(session.getPlayerId(), GAME_TYPE);

   // 逐發判定時：
   boolean hit = !intercepted && rng.roll(fish.hitRate(), stream);
   // 原本：boolean hit = rng.roll(fish.hitRate(), stream);
   ```

   > 注意：RNG stream 仍需正常消耗（確保 seed 可重放驗證），只是結果強制未命中。
   > 即：先算 `rng.roll()` 取得值，只是不用它來決定 `hit`，改強制 `false`。

---

### Step 5：整合到 `BaccaratService`

**檔案**：`backend/game-service/src/main/java/com/luckystar/game/service/BaccaratService.java`

1. 注入 `RiskControlService`。

2. 在結算前插入攔截：若觸發且玩家下注方為 PLAYER 或 TIE，強制結果改為 BANKER 贏：

   ```java
   boolean intercepted = riskControlService.shouldIntercept(playerId, GAME_TYPE);
   if (intercepted && isFavorableForPlayer(request.getBetType(), outcome)) {
       outcome = BaccaratOutcome.BANKER; // 平台獲利
   }
   ```

---

### Step 6：application.yml 新增設定

**檔案**：`backend/game-service/src/main/resources/application.yml`（或環境變數）

```yaml
risk:
  player-win-limit: 50000    # 單玩家今日淨贏上限（星幣），超過即攔截
  global-rtp-limit: 0.95     # 全局 RTP 上限（95%），超過即攔截
  rtp-sample-size: 500       # 計算全局 RTP 的近 N 局樣本數
```

---

### Step 7：新增測試

**新建**：`backend/game-service/src/test/java/com/luckystar/game/service/RiskControlServiceTest.java`

測試案例：
- `shouldIntercept_playerUnderLimit_returnsFalse`
- `shouldIntercept_playerOverLimit_returnsTrue`
- `shouldIntercept_globalRtpOverLimit_returnsTrue`
- `shouldIntercept_noRounds_returnsFalse`（無對局紀錄時不攔截）

使用 H2 記憶體 DB + `@SpringBootTest`（與其他 service test 一致）。

---

## 注意事項

1. **RNG 不跳過**：即使風控攔截，RNG stream 的 `nextInt` 呼叫次數必須與正常局一樣，確保 seed 可重放驗證（Provably Fair 不被破壞）。
2. **不記錄攔截原因到 DB**：攔截對玩家完全透明，`game_rounds` 不新增欄位，只有後端 log 可見。
3. **冪等安全**：`shouldIntercept` 是純查詢，重試結算時再呼叫一次即可，結果一致。
4. **測試環境**：測試 yml 不設定 `risk.*`，走預設值，確保現有測試不因閾值過低而誤觸攔截。

---

## 驗證指令

```bash
mvn -pl backend/game-service test
```

手動驗證：
- 修改 `application.yml` 把 `player-win-limit` 設很低（如 100），下注中獎超過後，確認後續幾局不再中獎。
- 調回正常值，確認遊戲恢復正常。
