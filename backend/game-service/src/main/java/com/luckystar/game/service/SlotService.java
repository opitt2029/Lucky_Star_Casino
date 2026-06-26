package com.luckystar.game.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.luckystar.game.client.WalletClient;
import com.luckystar.game.client.dto.WalletCreditResponse;
import com.luckystar.game.client.dto.WalletDebitResponse;
import com.luckystar.game.dto.PrepareRoundResponse;
import com.luckystar.game.dto.SpinResponse;
import com.luckystar.game.dto.WalletView;
import com.luckystar.game.entity.GameRound;
import com.luckystar.game.exception.RoundNotFoundException;
import com.luckystar.game.kafka.GameResultEventPublisher;
import com.luckystar.game.repository.GameRoundRepository;
import com.luckystar.game.rng.ProvablyFairRng;
import com.luckystar.game.rng.RandomStream;
import com.luckystar.game.session.GameSession;
import com.luckystar.game.session.GameSessionService;
import com.luckystar.game.slot.SlotMachine;
import com.luckystar.game.slot.SlotOutcome;
import com.luckystar.game.slot.SlotSymbol;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

/**
 * 老虎機下注編排（T-032 + T-033）。串接 RNG（T-030）、老虎機邏輯（T-031）、wallet 帳務、
 * Redis 對局 Session（T-033）與 game.result 事件，對應 architecture.md §8.2 的下注流程：
 *
 * <pre>
 *   扣下注(debit) → RNG 計算結果 → 命中則派彩(credit) → 寫對局紀錄 → 發布 game.result
 * </pre>
 *
 * <p>提供兩種玩法入口：
 * <ul>
 *   <li><b>單次模式</b> {@link #spin}：相容前端 mockApi 的一次呼叫——即時產生 serverSeed、
 *       轉動並於同一回應揭露 serverSeed。不使用 Session。</li>
 *   <li><b>兩階段 commit-ahead 模式</b> {@link #prepareRound} + {@link #settle}：開局先公布
 *       serverSeedHash 並把保密 serverSeed 暫存於 Redis Session（STARTED、TTL 30 分鐘），
 *       玩家下注後才扣款、轉動並揭露 serverSeed（SETTLED）。確保結果在玩家下注前已鎖定、
 *       事後可獨立驗證未遭竄改。</li>
 * </ul>
 *
 * <p><b>一致性界線</b>：debit 與 credit 為兩次獨立的 wallet HTTP 呼叫，皆以確定性冪等鍵
 * （{@code slot-bet-<roundId>} / {@code slot-win-<roundId>}）保護；對局結果由 seed 三元組
 * 確定性推導，故結算可安全重試（重算結果一致、帳務冪等、對局紀錄以 roundId 去重）。
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
    private final GameSessionService sessionService;
    private final ObjectMapper objectMapper;
    private final RiskControlService riskControlService;

    /**
     * 單次模式：扣款、轉動並於同一回應揭露 serverSeed（相容前端一次呼叫）。
     *
     * @param playerId            玩家 ID（由 gateway 注入的 X-User-Id）
     * @param bet                 下注金額（已由 controller 驗證 [100, 5000]）
     * @param requestedClientSeed 玩家自訂 client seed（可為 null/空白，則由伺服器產生）
     */
    public SpinResponse spin(long playerId, long bet, String requestedClientSeed) {
        String roundId = UUID.randomUUID().toString();
        String serverSeed = rng.generateServerSeed();
        String serverSeedHash = rng.commit(serverSeed);
        String clientSeed = resolveClientSeed(requestedClientSeed);

        return settleInternal(roundId, playerId, bet, serverSeed, serverSeedHash, clientSeed);
    }

    /**
     * commit-ahead 第一階段「開局」：產生 serverSeed 並承諾其雜湊，把保密種子與下注額暫存於
     * Redis Session（STARTED）。<b>不扣款、不揭露 serverSeed。</b>
     *
     * @param requestedClientSeed 玩家自訂 client seed（可為 null/空白，則由伺服器產生）
     * @return 開局結果（roundId、serverSeedHash、clientSeed、bet）
     */
    public PrepareRoundResponse prepareRound(long playerId, long bet, String requestedClientSeed) {
        String roundId = UUID.randomUUID().toString();
        String serverSeed = rng.generateServerSeed();
        String serverSeedHash = rng.commit(serverSeed);
        String clientSeed = resolveClientSeed(requestedClientSeed);

        GameSession session = GameSession.builder()
                .roundId(roundId)
                .playerId(playerId)
                .gameType(GAME_TYPE)
                .betAmount(bet)
                .serverSeed(serverSeed)
                .serverSeedHash(serverSeedHash)
                .clientSeed(clientSeed)
                .nonce(NONCE)
                .build();
        sessionService.start(session);

        log.info("slot round prepared roundId={} playerId={} bet={}", roundId, playerId, bet);

        return PrepareRoundResponse.builder()
                .roundId(roundId)
                .game("slot")
                .bet(bet)
                .serverSeedHash(serverSeedHash)
                .clientSeed(clientSeed)
                .build();
    }

    /**
     * commit-ahead 第二階段「結算」：以開局暫存的 Session 種子扣款、轉動、派彩、寫對局，
     * 並把 Session 轉為 SETTLED、揭露 serverSeed。下注額以開局綁定者為準（玩家無法在看到雜湊後改注）。
     *
     * @param playerId 玩家 ID（須與開局者一致）
     * @param roundId  開局回傳的對局識別碼
     * @return 本局結果（含盤面、派彩、結算後餘額與已揭露的 serverSeed）
     * @throws RoundNotFoundException Session 不存在或已逾時
     */
    public SpinResponse settle(long playerId, String roundId) {
        GameSession session = sessionService.find(playerId, roundId)
                .orElseThrow(() -> new RoundNotFoundException(
                        "對局不存在或已逾時（roundId=" + roundId + "）"));

        SpinResponse response = settleInternal(
                roundId, playerId, session.getBetAmount(),
                session.getServerSeed(), session.getServerSeedHash(), session.getClientSeed());

        // 揭露 serverSeed 並標記結算（保留 30 分鐘驗證視窗）。
        sessionService.markSettled(playerId, roundId, session.getServerSeed(), NONCE);
        return response;
    }

    /**
     * 共用結算流程：扣款 → RNG → 命中派彩 → 寫對局（以 roundId 去重）→ 發布 game.result。
     * 供單次模式與 commit-ahead 結算共用；不觸碰 Session（由呼叫端決定是否標記）。
     */
    private SpinResponse settleInternal(String roundId, long playerId, long bet,
                                        String serverSeed, String serverSeedHash, String clientSeed) {
        // 下注時間（毫秒精度）：單次模式下注與結算同一瞬間，於扣款前取時間戳供注單稽核。
        LocalDateTime betAt = LocalDateTime.now();

        // 1) 扣下注（冪等）。餘額不足會丟 InsufficientBalanceException，於此中止、不產生對局。
        WalletDebitResponse debit = walletClient.debit(
                playerId, bet, "slot-bet-" + roundId, roundId);
        Long balanceBefore = debit.balanceBefore();

        // 2) 風控檢查：shouldIntercept 會佔用並發閘；無論是否攔截，finally 均須呼叫 releaseRiskSlot。
        boolean riskIntercept = riskControlService.shouldIntercept(playerId, GAME_TYPE);
        try {
        RandomStream stream = rng.stream(serverSeed, clientSeed, NONCE);
        SlotOutcome outcome = slotMachine.spin(stream, bet);

        // 轉動若命中但被風控攔截，打破中線顯示確保盤面與派彩視覺一致（不出現中獎符號配零派彩）。
        if (riskIntercept && outcome.win()) {
            outcome = SlotOutcome.noWin(breakPayline(outcome.grid()));
        }

        // 3) 命中則派彩（冪等）。
        long balanceAfter = debit.balanceAfter();
        long frozenAfter = 0L;
        if (outcome.payout() > 0) {
            WalletCreditResponse credit = walletClient.credit(
                    playerId, outcome.payout(), "slot-win-" + roundId, roundId);
            balanceAfter = credit.balanceAfter();
            frozenAfter = credit.frozenAfter() == null ? 0L : credit.frozenAfter();
        }

        // 4) 寫對局紀錄（已結算）；以 roundId 去重，重試不重複插入（unique 約束保護）。
        if (roundRepository.findByRoundId(roundId).isEmpty()) {
            try {
                GameRound round = buildRound(roundId, playerId, bet, serverSeed, serverSeedHash, clientSeed,
                        outcome, balanceBefore, balanceAfter, betAt);
                roundRepository.save(round);
                // 5) 發布 game.result（best-effort）。僅在首次落地時發布，避免重試重複事件。
                eventPublisher.publishSlotResult(round, outcome);
            } catch (DataIntegrityViolationException e) {
                // 並發結算同時通過去重檢查，unique 約束擋下第二筆 → 視同已結算，不讓重試者收到 500
                log.info("slot round concurrently settled by another request, skip roundId={}", roundId);
            }
        } else {
            log.info("slot round already settled, skip persist/publish roundId={}", roundId);
        }

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
        } finally {
            riskControlService.releaseRiskSlot(playerId);
        }
    }

    /**
     * 深複製盤面並將中線中格換成與兩側不同的符號，打破視覺三連，供風控攔截時使用。
     */
    private String[][] breakPayline(String[][] src) {
        String[][] masked = new String[src.length][];
        for (int i = 0; i < src.length; i++) masked[i] = src[i].clone();
        String paylineSymbol = masked[SlotMachine.PAYLINE_ROW][0];
        for (SlotSymbol s : SlotSymbol.values()) {
            if (!s.display().equals(paylineSymbol)) {
                masked[SlotMachine.PAYLINE_ROW][1] = s.display();
                return masked;
            }
        }
        return masked;
    }

    private String resolveClientSeed(String requestedClientSeed) {
        return StringUtils.hasText(requestedClientSeed) ? requestedClientSeed : rng.generateClientSeed();
    }

    private GameRound buildRound(String roundId, long playerId, long bet, String serverSeed,
                                 String serverSeedHash, String clientSeed, SlotOutcome outcome,
                                 Long balanceBefore, long balanceAfter, LocalDateTime betAt) {
        GameRound round = new GameRound();
        round.setRoundId(roundId);
        round.setPlayerId(playerId);
        round.setGameType(GAME_TYPE);
        round.setBetAmount(bet);
        round.setWinAmount(outcome.payout());
        round.setBalanceBefore(balanceBefore);
        round.setBalanceAfter(balanceAfter);
        round.setServerSeed(serverSeed);
        round.setServerSeedHash(serverSeedHash);
        round.setClientSeed(clientSeed);
        round.setNonce(NONCE);
        round.setResultData(writeResultJson(outcome));
        round.setStatus(STATUS_SETTLED);
        round.setBetAt(betAt);
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
