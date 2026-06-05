package com.luckystar.game.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.luckystar.game.baccarat.BaccaratGameService;
import com.luckystar.game.baccarat.BaccaratOutcome;
import com.luckystar.game.baccarat.Card;
import com.luckystar.game.dto.VerificationResponse;
import com.luckystar.game.entity.GameRound;
import com.luckystar.game.exception.RoundNotFoundException;
import com.luckystar.game.repository.GameRoundRepository;
import com.luckystar.game.rng.ProvablyFairRng;
import com.luckystar.game.rng.RandomStream;
import com.luckystar.game.slot.SlotMachine;
import com.luckystar.game.slot.SlotOutcome;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

/**
 * RNG 公平性驗證（T-036）。玩家可獨立驗證某局結果是否被竄改：系統以 serverSeed
 * （玩家提供或對局已揭露者）重算結果，並與 {@code game_rounds} 既有紀錄比對。
 *
 * <p>判定兩件事：
 * <ol>
 *   <li><b>承諾相符</b>：{@code SHA-256(serverSeed) == serverSeedHash}——確認 serverSeed 未在
 *       事後被替換（下注前已鎖定）。</li>
 *   <li><b>結果一致</b>：以 {@code (serverSeed, clientSeed, nonce)} 重跑遊戲引擎，盤面/牌局與
 *       派彩須與紀錄相同——確認結果由 seed 確定性產生、未遭竄改。</li>
 * </ol>
 *
 * <p>本服務唯讀、不改帳務，純供透明驗證。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class VerificationService {

    private final ProvablyFairRng rng;
    private final SlotMachine slotMachine;
    private final BaccaratGameService baccaratGame;
    private final GameRoundRepository roundRepository;
    private final ObjectMapper objectMapper;

    /**
     * 驗證指定對局。
     *
     * @param roundId           對局識別碼
     * @param providedServerSeed 玩家提供的 serverSeed（可為 null/空白，則採用對局已揭露值）
     * @throws RoundNotFoundException 對局不存在
     */
    public VerificationResponse verify(String roundId, String providedServerSeed) {
        GameRound round = roundRepository.findByRoundId(roundId)
                .orElseThrow(() -> new RoundNotFoundException("對局不存在（roundId=" + roundId + "）"));

        boolean usedProvided = StringUtils.hasText(providedServerSeed);
        String serverSeed = usedProvided ? providedServerSeed.trim() : round.getServerSeed();
        long nonce = round.getNonce() == null ? 0L : round.getNonce();

        VerificationResponse.VerificationResponseBuilder builder = VerificationResponse.builder()
                .roundId(roundId)
                .gameType(round.getGameType())
                .serverSeed(serverSeed)
                .serverSeedHash(round.getServerSeedHash())
                .clientSeed(round.getClientSeed())
                .nonce(nonce)
                .usedProvidedSeed(usedProvided);

        // serverSeed 缺失（理論上已結算對局必有）→ 無法驗證
        if (!StringUtils.hasText(serverSeed)) {
            return builder.commitmentValid(false).resultMatches(false).valid(false)
                    .message("缺少 serverSeed，無法驗證（對局可能尚未揭露）").build();
        }

        boolean commitmentValid = rng.verifyCommitment(serverSeed, round.getServerSeedHash());

        JsonNode stored = parseStored(round.getResultData());
        Recompute rc = recompute(round, serverSeed, round.getClientSeed(), nonce, stored);
        boolean valid = commitmentValid && rc.matches;

        String message;
        if (!commitmentValid) {
            message = usedProvided
                    ? "承諾雜湊不符：提供的 serverSeed 與本局公布的 serverSeedHash 不相符"
                    : "承諾雜湊不符：對局紀錄的 serverSeed 與 serverSeedHash 不一致（異常）";
        } else if (!rc.matches) {
            message = "重算結果與紀錄不一致（疑似遭竄改）";
        } else {
            message = "驗證通過：承諾相符且結果可由 seed 重算重現，本局公平未遭竄改";
        }

        return builder
                .commitmentValid(commitmentValid)
                .resultMatches(rc.matches)
                .valid(valid)
                .recomputed(rc.recomputed)
                .stored(stored)
                .message(message)
                .build();
    }

    /** 重算結果與比對。 */
    private Recompute recompute(GameRound round, String serverSeed, String clientSeed,
                                long nonce, JsonNode stored) {
        String gameType = round.getGameType();
        RandomStream stream = rng.stream(serverSeed, clientSeed, nonce);
        if ("SLOT".equals(gameType)) {
            return recomputeSlot(round, stream, stored);
        }
        if ("BACCARAT".equals(gameType)) {
            return recomputeBaccarat(stream, stored);
        }
        return new Recompute(false, Map.of("error", "不支援的遊戲類型: " + gameType));
    }

    private Recompute recomputeSlot(GameRound round, RandomStream stream, JsonNode stored) {
        long bet = round.getBetAmount() == null ? 0L : round.getBetAmount();
        SlotOutcome o = slotMachine.spin(stream, bet);

        Map<String, Object> recomputed = new LinkedHashMap<>();
        recomputed.put("grid", o.grid());
        recomputed.put("multiplier", o.multiplier());
        recomputed.put("payout", o.payout());
        recomputed.put("winningCells", o.winningCells());

        boolean matches = stored != null
                && deepEqualsGrid(o.grid(), stored.get("grid"))
                && o.payout() == asLong(stored.get("payout"))
                && o.multiplier() == asInt(stored.get("multiplier"))
                && o.payout() == (round.getWinAmount() == null ? 0L : round.getWinAmount());
        return new Recompute(matches, recomputed);
    }

    private Recompute recomputeBaccarat(RandomStream stream, JsonNode stored) {
        BaccaratOutcome o = baccaratGame.deal(stream);

        Map<String, Object> recomputed = new LinkedHashMap<>();
        recomputed.put("result", o.result().name());
        recomputed.put("playerScore", o.playerScore());
        recomputed.put("bankerScore", o.bankerScore());
        recomputed.put("playerCards", display(o.playerCards()));
        recomputed.put("bankerCards", display(o.bankerCards()));

        boolean matches = stored != null
                && o.result().name().equals(asText(stored.get("result")))
                && o.playerScore() == asInt(stored.get("playerScore"))
                && o.bankerScore() == asInt(stored.get("bankerScore"))
                && display(o.playerCards()).equals(asStringList(stored.get("playerCards")))
                && display(o.bankerCards()).equals(asStringList(stored.get("bankerCards")));
        return new Recompute(matches, recomputed);
    }

    private JsonNode parseStored(String resultData) {
        if (!StringUtils.hasText(resultData)) {
            return null;
        }
        try {
            return objectMapper.readTree(resultData);
        } catch (Exception ex) {
            log.warn("解析 result_data 失敗: {}", ex.toString());
            return null;
        }
    }

    private boolean deepEqualsGrid(String[][] recomputed, JsonNode storedGrid) {
        if (storedGrid == null || !storedGrid.isArray()) {
            return false;
        }
        try {
            String[][] s = objectMapper.convertValue(storedGrid, String[][].class);
            return java.util.Arrays.deepEquals(recomputed, s);
        } catch (Exception ex) {
            return false;
        }
    }

    private static List<String> display(List<Card> cards) {
        List<String> out = new ArrayList<>(cards.size());
        for (Card c : cards) {
            out.add(c.display());
        }
        return out;
    }

    private static long asLong(JsonNode n) {
        return n == null || n.isNull() ? Long.MIN_VALUE : n.asLong();
    }

    private static int asInt(JsonNode n) {
        return n == null || n.isNull() ? Integer.MIN_VALUE : n.asInt();
    }

    private static String asText(JsonNode n) {
        return n == null || n.isNull() ? null : n.asText();
    }

    private static List<String> asStringList(JsonNode n) {
        List<String> out = new ArrayList<>();
        if (n != null && n.isArray()) {
            n.forEach(e -> out.add(e.asText()));
        }
        return out;
    }

    /** 重算結果與是否相符（內部用）。 */
    private record Recompute(boolean matches, Object recomputed) {
    }
}
