package com.luckystar.game.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.luckystar.game.baccarat.BaccaratGameService;
import com.luckystar.game.baccarat.BaccaratOutcome;
import com.luckystar.game.baccarat.BaccaratResult;
import com.luckystar.game.baccarat.BaccaratSettlement;
import com.luckystar.game.baccarat.Card;
import com.luckystar.game.client.WalletClient;
import com.luckystar.game.client.dto.WalletCreditResponse;
import com.luckystar.game.dto.BaccaratBetResponse;
import com.luckystar.game.dto.BaccaratResultResponse;
import com.luckystar.game.dto.WalletView;
import com.luckystar.game.entity.GameRound;
import com.luckystar.game.exception.RoundNotFoundException;
import com.luckystar.game.kafka.GameResultEventPublisher;
import com.luckystar.game.repository.GameRoundRepository;
import com.luckystar.game.rng.ProvablyFairRng;
import com.luckystar.game.rng.RandomStream;
import com.luckystar.game.session.GameSession;
import com.luckystar.game.session.GameSessionService;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

/**
 * 百家樂下注編排（T-035）。串接 RNG（T-030）、百家樂邏輯（T-034）、Redis Session（T-033）、
 * Wallet 帳務與 {@code game.result} 事件，採兩階段 commit-ahead：
 *
 * <pre>
 *   /bet     ：驗證多區押注 → 扣下注總額(debit) → 產生並承諾 serverSeedHash → 建 STARTED Session
 *   /result  ：載入 Session → RNG 發牌 → 各區結算派彩 → 命中則 credit → 寫對局 → 揭露 serverSeed(SETTLED) → 發事件
 * </pre>
 *
 * <p>下注在 /bet 即扣款並鎖定 serverSeedHash（玩家此時看不到結果），/result 才揭露 serverSeed，
 * 確保結果在下注前已決定且事後可驗證（Provably Fair）。帳務以確定性冪等鍵
 * （{@code bac-bet-<roundId>} / {@code bac-win-<roundId>}）保護，結果由 seed 確定性推導、
 * 對局以 roundId 去重，故 /result 可安全重試。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class BaccaratService {

    private static final String GAME_TYPE = "BACCARAT";
    private static final String STATUS_SETTLED = "SETTLED";
    private static final long NONCE = 0L;
    private static final long MIN_TOTAL_BET = 100L;
    private static final long MAX_TOTAL_BET = 5000L;

    private final ProvablyFairRng rng;
    private final BaccaratGameService baccaratGame;
    private final WalletClient walletClient;
    private final GameRoundRepository roundRepository;
    private final GameResultEventPublisher eventPublisher;
    private final GameSessionService sessionService;
    private final ObjectMapper objectMapper;

    /**
     * 下注（commit-ahead 第一階段）：驗證多區押注、扣款、建立 STARTED Session、回傳 serverSeedHash 承諾。
     *
     * @param playerId            玩家 ID
     * @param player              押閒金額（null 視為 0）
     * @param banker              押莊金額（null 視為 0）
     * @param tie                 押和金額（null 視為 0）
     * @param requestedClientSeed 玩家自訂 client seed（可為 null/空白）
     */
    public BaccaratBetResponse placeBet(long playerId, Long player, Long banker, Long tie,
                                        String requestedClientSeed) {
        long bp = nz(player);
        long bb = nz(banker);
        long bt = nz(tie);
        if (bp < 0 || bb < 0 || bt < 0) {
            throw new IllegalArgumentException("押注金額不可為負");
        }
        long total = bp + bb + bt;
        if (total < MIN_TOTAL_BET) {
            throw new IllegalArgumentException("三押注區下注總額最低 " + MIN_TOTAL_BET + " 星幣");
        }
        if (total > MAX_TOTAL_BET) {
            throw new IllegalArgumentException("三押注區下注總額上限 " + MAX_TOTAL_BET + " 星幣");
        }

        String roundId = UUID.randomUUID().toString();
        String serverSeed = rng.generateServerSeed();
        String serverSeedHash = rng.commit(serverSeed);
        String clientSeed = StringUtils.hasText(requestedClientSeed)
                ? requestedClientSeed : rng.generateClientSeed();

        // 扣下注總額（冪等）。餘額不足會丟 InsufficientBalanceException，於此中止、不建 Session。
        walletClient.debit(playerId, total, "bac-bet-" + roundId, roundId);

        GameSession session = GameSession.builder()
                .roundId(roundId)
                .playerId(playerId)
                .gameType(GAME_TYPE)
                .betAmount(total)
                .betPlayer(bp)
                .betBanker(bb)
                .betTie(bt)
                .serverSeed(serverSeed)
                .serverSeedHash(serverSeedHash)
                .clientSeed(clientSeed)
                .nonce(NONCE)
                .build();
        sessionService.start(session);

        log.info("baccarat bet placed roundId={} playerId={} total={} (P={},B={},T={})",
                roundId, playerId, total, bp, bb, bt);

        return BaccaratBetResponse.builder()
                .roundId(roundId)
                .game("baccarat")
                .bets(betsMap(bp, bb, bt))
                .totalBet(total)
                .serverSeedHash(serverSeedHash)
                .clientSeed(clientSeed)
                .build();
    }

    /**
     * 結算（commit-ahead 第二階段）：以 Session 種子發牌、計算各區派彩、命中則派彩、寫對局、
     * 揭露 serverSeed 並標記 SETTLED。
     *
     * @throws RoundNotFoundException Session 不存在或已逾時
     */
    public BaccaratResultResponse settle(long playerId, String roundId) {
        GameSession session = sessionService.find(playerId, roundId)
                .orElseThrow(() -> new RoundNotFoundException(
                        "對局不存在或已逾時（roundId=" + roundId + "）"));

        long bp = nz(session.getBetPlayer());
        long bb = nz(session.getBetBanker());
        long bt = nz(session.getBetTie());
        long totalBet = nz(session.getBetAmount());

        // 發牌與結算（確定性）
        RandomStream stream = rng.stream(session.getServerSeed(), session.getClientSeed(), NONCE);
        BaccaratOutcome outcome = baccaratGame.deal(stream);
        Map<BaccaratResult, Long> bets = new EnumMap<>(BaccaratResult.class);
        if (bp > 0) {
            bets.put(BaccaratResult.PLAYER, bp);
        }
        if (bb > 0) {
            bets.put(BaccaratResult.BANKER, bb);
        }
        if (bt > 0) {
            bets.put(BaccaratResult.TIE, bt);
        }
        BaccaratSettlement settlement = baccaratGame.settle(outcome, bets);
        long totalPayout = settlement.totalPayout();

        // 命中則派彩（冪等）；未中則無需呼叫 wallet。
        WalletView wallet = null;
        if (totalPayout > 0) {
            WalletCreditResponse credit = walletClient.credit(
                    playerId, totalPayout, "bac-win-" + roundId, roundId);
            wallet = WalletView.builder()
                    .balance(credit.balanceAfter())
                    .frozenAmount(credit.frozenAfter() == null ? 0L : credit.frozenAfter())
                    .build();
        }

        // 寫對局（以 roundId 去重，重試不重複插入）。
        if (roundRepository.findByRoundId(roundId).isEmpty()) {
            try {
                GameRound round = buildRound(session, outcome, settlement);
                roundRepository.save(round);
                eventPublisher.publishBaccaratResult(round, outcome);
            } catch (DataIntegrityViolationException e) {
                // 並發結算同時通過去重檢查，unique 約束擋下第二筆 → 視同已結算，不讓重試者收到 500
                log.info("baccarat round concurrently settled by another request, skip roundId={}", roundId);
            }
        } else {
            log.info("baccarat round already settled, skip persist/publish roundId={}", roundId);
        }

        // 揭露 serverSeed 並標記結算
        sessionService.markSettled(playerId, roundId, session.getServerSeed(), NONCE);

        log.info("baccarat settled roundId={} playerId={} result={} totalBet={} totalPayout={}",
                roundId, playerId, outcome.result(), totalBet, totalPayout);

        return BaccaratResultResponse.builder()
                .roundId(roundId)
                .game("baccarat")
                .playerCards(display(outcome.playerCards()))
                .bankerCards(display(outcome.bankerCards()))
                .playerScore(outcome.playerScore())
                .bankerScore(outcome.bankerScore())
                .result(outcome.result().name())
                .bets(betsMap(bp, bb, bt))
                .payouts(payoutsMap(settlement))
                .totalBet(totalBet)
                .totalPayout(totalPayout)
                .wallet(wallet)
                .serverSeed(session.getServerSeed())
                .serverSeedHash(session.getServerSeedHash())
                .clientSeed(session.getClientSeed())
                .nonce(NONCE)
                .build();
    }

    private GameRound buildRound(GameSession session, BaccaratOutcome outcome, BaccaratSettlement settlement) {
        GameRound round = new GameRound();
        round.setRoundId(session.getRoundId());
        round.setPlayerId(session.getPlayerId());
        round.setGameType(GAME_TYPE);
        round.setBetAmount(settlement.totalBet());
        round.setWinAmount(settlement.totalPayout());
        round.setServerSeed(session.getServerSeed());
        round.setServerSeedHash(session.getServerSeedHash());
        round.setClientSeed(session.getClientSeed());
        round.setNonce(NONCE);
        round.setResultData(writeResultJson(outcome, settlement));
        round.setStatus(STATUS_SETTLED);
        round.setSettledAt(LocalDateTime.now());
        return round;
    }

    private String writeResultJson(BaccaratOutcome outcome, BaccaratSettlement settlement) {
        try {
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("result", outcome.result().name());
            result.put("playerScore", outcome.playerScore());
            result.put("bankerScore", outcome.bankerScore());
            result.put("playerCards", display(outcome.playerCards()));
            result.put("bankerCards", display(outcome.bankerCards()));
            result.put("payouts", payoutsMap(settlement));
            result.put("totalPayout", settlement.totalPayout());
            return objectMapper.writeValueAsString(result);
        } catch (Exception ex) {
            log.warn("序列化百家樂結果失敗: {}", ex.toString());
            return "{}";
        }
    }

    private static List<String> display(List<Card> cards) {
        List<String> out = new ArrayList<>(cards.size());
        for (Card c : cards) {
            out.add(c.display());
        }
        return out;
    }

    private static Map<String, Long> betsMap(long player, long banker, long tie) {
        Map<String, Long> m = new LinkedHashMap<>();
        m.put("player", player);
        m.put("banker", banker);
        m.put("tie", tie);
        return m;
    }

    private static Map<String, Long> payoutsMap(BaccaratSettlement settlement) {
        Map<BaccaratResult, Long> byArea = settlement.payoutByArea();
        Map<String, Long> m = new LinkedHashMap<>();
        m.put("player", byArea.getOrDefault(BaccaratResult.PLAYER, 0L));
        m.put("banker", byArea.getOrDefault(BaccaratResult.BANKER, 0L));
        m.put("tie", byArea.getOrDefault(BaccaratResult.TIE, 0L));
        return m;
    }

    private static long nz(Long v) {
        return v == null ? 0L : v;
    }
}
