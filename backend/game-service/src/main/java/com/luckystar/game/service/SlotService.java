package com.luckystar.game.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.luckystar.game.client.WalletClient;
import com.luckystar.game.client.dto.WalletCreditResponse;
import com.luckystar.game.client.dto.WalletDebitResponse;
import com.luckystar.game.dto.SpinResponse;
import com.luckystar.game.dto.WalletView;
import com.luckystar.game.entity.GameRound;
import com.luckystar.game.kafka.GameResultEventPublisher;
import com.luckystar.game.repository.GameRoundRepository;
import com.luckystar.game.rng.ProvablyFairRng;
import com.luckystar.game.rng.RandomStream;
import com.luckystar.game.slot.SlotMachine;
import com.luckystar.game.slot.SlotOutcome;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

/**
 * 老虎機下注編排（T-032）。串接 RNG（T-030）、老虎機邏輯（T-031）、wallet 帳務與 game.result 事件，
 * 對應 architecture.md §8.2 的下注完整流程：
 *
 * <pre>
 *   扣下注(debit) → RNG 計算結果 → 命中則派彩(credit) → 寫對局紀錄 → 發布 game.result
 * </pre>
 *
 * <p><b>Provably Fair（本任務範圍）</b>：每一局即時產生新的 serverSeed，計算後於回應中一併揭露
 * serverSeed / serverSeedHash / clientSeed / nonce，玩家可獨立重算驗證。注意「開局前先公布
 * serverSeedHash、玩家下注後才揭露 serverSeed」的完整 commit-ahead 流程需要 Redis Session
 * 暫存（T-033），不在本任務範圍。
 *
 * <p><b>一致性界線</b>：debit 與 credit 為兩次獨立的 wallet HTTP 呼叫，皆以確定性冪等鍵
 * （{@code slot-bet-<roundId>} / {@code slot-win-<roundId>}）保護，重試安全。debit 成功後若
 * 後續步驟異常，可依冪等鍵對帳補償；完整 saga/outbox 為後續強化項，不在本任務範圍。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class SlotService {

    private static final String GAME_TYPE = "SLOT";
    private static final String STATUS_SETTLED = "SETTLED";
    private static final long NONCE = 0L;

    private final ProvablyFairRng rng;
    private final SlotMachine slotMachine;
    private final WalletClient walletClient;
    private final GameRoundRepository roundRepository;
    private final GameResultEventPublisher eventPublisher;
    private final ObjectMapper objectMapper;

    /**
     * 執行一次老虎機下注。
     *
     * @param playerId           玩家 ID（由 gateway 注入的 X-User-Id）
     * @param bet                下注金額（已由 controller 驗證 [100, 5000]）
     * @param requestedClientSeed 玩家自訂 client seed（可為 null/空白，則由伺服器產生）
     * @return 本局結果（含盤面、派彩、結算後餘額與 Provably Fair 揭露欄位）
     */
    public SpinResponse spin(long playerId, long bet, String requestedClientSeed) {
        String roundId = UUID.randomUUID().toString();

        // 1) 種子：每局即時產生 serverSeed 並計算承諾雜湊；clientSeed 可由玩家提供。
        String serverSeed = rng.generateServerSeed();
        String serverSeedHash = rng.commit(serverSeed);
        String clientSeed = StringUtils.hasText(requestedClientSeed)
                ? requestedClientSeed
                : rng.generateClientSeed();

        // 2) 扣下注（冪等）。餘額不足會丟 InsufficientBalanceException，於此中止、不產生對局。
        WalletDebitResponse debit = walletClient.debit(
                playerId, bet, "slot-bet-" + roundId, roundId);

        // 3) 以三元組推導確定性結果。
        RandomStream stream = rng.stream(serverSeed, clientSeed, NONCE);
        SlotOutcome outcome = slotMachine.spin(stream, bet);

        // 4) 命中則派彩（冪等）。
        long balanceAfter = debit.balanceAfter();
        long frozenAfter = 0L;
        if (outcome.payout() > 0) {
            WalletCreditResponse credit = walletClient.credit(
                    playerId, outcome.payout(), "slot-win-" + roundId, roundId);
            balanceAfter = credit.balanceAfter();
            frozenAfter = credit.frozenAfter() == null ? 0L : credit.frozenAfter();
        }

        // 5) 寫對局紀錄（已結算）。
        GameRound round = buildRound(roundId, playerId, bet, serverSeed, serverSeedHash, clientSeed, outcome);
        roundRepository.save(round);

        // 6) 發布 game.result（best-effort）。
        eventPublisher.publishSlotResult(round, outcome);

        log.info("slot spin settled roundId={} playerId={} bet={} payout={} multiplier={}",
                roundId, playerId, bet, outcome.payout(), outcome.multiplier());

        return SpinResponse.builder()
                .roundId(roundId)
                .game("slot")
                .grid(outcome.grid())
                .bet(bet)
                .multiplier(outcome.multiplier())
                .payout(outcome.payout())
                .winningCells(outcome.winningCells())
                .wallet(WalletView.builder().balance(balanceAfter).frozenAmount(frozenAfter).build())
                .serverSeed(serverSeed)
                .serverSeedHash(serverSeedHash)
                .clientSeed(clientSeed)
                .nonce(NONCE)
                .build();
    }

    private GameRound buildRound(String roundId, long playerId, long bet, String serverSeed,
                                 String serverSeedHash, String clientSeed, SlotOutcome outcome) {
        GameRound round = new GameRound();
        round.setRoundId(roundId);
        round.setPlayerId(playerId);
        round.setGameType(GAME_TYPE);
        round.setBetAmount(bet);
        round.setWinAmount(outcome.payout());
        round.setServerSeed(serverSeed);
        round.setServerSeedHash(serverSeedHash);
        round.setClientSeed(clientSeed);
        round.setNonce(NONCE);
        round.setResultData(writeResultJson(outcome));
        round.setStatus(STATUS_SETTLED);
        round.setSettledAt(LocalDateTime.now());
        return round;
    }

    private String writeResultJson(SlotOutcome outcome) {
        try {
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("grid", outcome.grid());
            result.put("win", outcome.win());
            result.put("multiplier", outcome.multiplier());
            result.put("payout", outcome.payout());
            result.put("winningCells", outcome.winningCells());
            return objectMapper.writeValueAsString(result);
        } catch (Exception ex) {
            // 結果序列化失敗不應發生；保底回最小可用 JSON，避免影響整局。
            log.warn("序列化遊戲結果失敗: {}", ex.toString());
            return "{}";
        }
    }
}
