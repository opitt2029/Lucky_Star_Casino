package com.luckystar.game.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.luckystar.game.client.WalletClient;
import com.luckystar.game.client.dto.WalletCreditResponse;
import com.luckystar.game.client.dto.WalletDebitResponse;
import com.luckystar.game.dto.FishingEndResponse;
import com.luckystar.game.dto.FishingSessionView;
import com.luckystar.game.dto.FishingShotVerifyResponse;
import com.luckystar.game.dto.FishingShotsRequest;
import com.luckystar.game.dto.FishingShotsResponse;
import com.luckystar.game.dto.WalletView;
import com.luckystar.game.entity.GameRound;
import com.luckystar.game.exception.RoundNotFoundException;
import com.luckystar.game.fishing.FishSpecies;
import com.luckystar.game.fishing.FishingSession;
import com.luckystar.game.fishing.FishingSessionStore;
import com.luckystar.game.kafka.GameResultEventPublisher;
import com.luckystar.game.repository.GameRoundRepository;
import com.luckystar.game.rng.ProvablyFairRng;
import com.luckystar.game.rng.RandomStream;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

/**
 * 捕魚機編排（buy-in 制 + 批次結算）。
 *
 * <pre>
 *   start：wallet 冪等扣 buyIn → 建 Redis Session（局內餘額 = buyIn、公布 serverSeedHash）
 *   shots：逐發以 (serverSeed, clientSeed, nonce=shotSeq) 判定，只動局內餘額（不打 wallet）
 *   end  ：剩餘局內餘額冪等 credit 回 wallet → 寫 game_rounds 彙總 → 發 game.result → 揭露 serverSeed
 * </pre>
 *
 * <p><b>帳務一致性</b>：wallet 只在 start（debit）與 end（credit）各觸發一次，均帶確定性冪等鍵
 * （{@code fishing-buyin-<sessionId>} / {@code fishing-end-<sessionId>}），重試安全。
 * 局內逐發判定可由 seed 三元組確定性重放，end 寫入的彙總紀錄以 roundId（=sessionId）去重。
 *
 * <p><b>基礎防刷</b>（上雲前的底線防護）：
 * <ul>
 *   <li>shotSeq 嚴格遞增（防重放同一發子彈）。</li>
 *   <li>單批上限 30 發（DTO 驗證）。</li>
 *   <li>射速上限：依距上次批次的間隔換算可受理發數（{@value #MAX_SHOTS_PER_SEC} 發/秒 +
 *       {@value #BURST_ALLOWANCE} 發突發緩衝），超限整批拒絕。</li>
 *   <li>betPerShot 必須等於炮台等級的固定注額（防自訂大注小注混打繞過費率）。</li>
 * </ul>
 *
 * <p><b>斷線保護</b>：玩家斷線不結算時，閒置排程（每分鐘掃描）會在閒置
 * {@value #IDLE_TIMEOUT_MINUTES} 分鐘後自動結算，把剩餘局內餘額還回 wallet——「斷線錢不見」不會發生。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class FishingService {

    private static final String GAME_TYPE = "FISHING";
    private static final String STATUS_SETTLED = "SETTLED";

    /** 各炮台等級的固定單發注額（1 → 10、2 → 50、3 → 100 星幣）。 */
    private static final long[] CANNON_BET = {0L, 10L, 50L, 100L};

    /** 射速上限（發/秒）。 */
    static final int MAX_SHOTS_PER_SEC = 8;

    /** 突發緩衝（網路抖動下首批/併批的容忍發數）。 */
    static final int BURST_ALLOWANCE = 15;

    /** 閒置自動結算門檻（分鐘）。 */
    static final long IDLE_TIMEOUT_MINUTES = 10;

    private final ProvablyFairRng rng;
    private final WalletClient walletClient;
    private final FishingSessionStore sessionStore;
    private final GameRoundRepository roundRepository;
    private final GameResultEventPublisher eventPublisher;
    private final ObjectMapper objectMapper;

    /**
     * 開場（或續玩）：已有進行中場次時直接回傳原場次（resumed=true，不重複扣款）；
     * 否則向 wallet 冪等扣 buyIn 並建立新場次。
     */
    public FishingSessionView start(long playerId, long buyIn, int cannonLevel, String requestedClientSeed) {
        Optional<FishingSession> existing = sessionStore.find(playerId);
        if (existing.isPresent() && existing.get().isActive()) {
            log.info("fishing session resumed playerId={} sessionId={}", playerId, existing.get().getSessionId());
            return toView(existing.get(), true, null);
        }

        String sessionId = UUID.randomUUID().toString();
        String serverSeed = rng.generateServerSeed();
        String serverSeedHash = rng.commit(serverSeed);
        String clientSeed = StringUtils.hasText(requestedClientSeed)
                ? requestedClientSeed.trim()
                : rng.generateClientSeed();

        WalletDebitResponse debit = walletClient.debit(
                playerId, buyIn, "fishing-buyin-" + sessionId, sessionId);

        Instant now = Instant.now();
        FishingSession session = FishingSession.builder()
                .sessionId(sessionId)
                .playerId(playerId)
                .roomId("solo-" + sessionId)
                .seatIndex(0)
                .cannonLevel(cannonLevel)
                .buyIn(buyIn)
                .sessionBalance(buyIn)
                .totalBet(0L)
                .totalPayout(0L)
                .totalShots(0L)
                .lastShotSeq(0L)
                .serverSeed(serverSeed)
                .serverSeedHash(serverSeedHash)
                .clientSeed(clientSeed)
                .state("ACTIVE")
                .createdAt(now)
                .lastActivityAt(now)
                .build();
        try {
            sessionStore.save(session);
        } catch (RuntimeException ex) {
            // 補償退款：扣款已成功但 Session 建立失敗（Redis 不可用/序列化失敗）時，
            // 若不退款，這筆 buyIn 會成為「孤兒扣款」（玩家扣了錢卻進不了場、也無 session 可結算）。
            // 帶獨立冪等鍵 fishing-buyin-refund-<sessionId>，與正常結算的 fishing-end-<sessionId> 互不衝突。
            log.error("fishing session save failed after debit, refunding playerId={} sessionId={}",
                    playerId, sessionId, ex);
            try {
                walletClient.credit(playerId, buyIn, "fishing-buyin-refund-" + sessionId, sessionId);
                log.info("fishing buy-in refunded playerId={} sessionId={} amount={}", playerId, sessionId, buyIn);
            } catch (RuntimeException refundEx) {
                // 退款本身又失敗：記為需人工對帳的嚴重事件（冪等鍵已落地，可日後重放補償）
                log.error("fishing buy-in REFUND FAILED playerId={} sessionId={} amount={} (需人工對帳)",
                        playerId, sessionId, buyIn, refundEx);
            }
            throw ex;
        }

        log.info("fishing session started playerId={} sessionId={} buyIn={} cannonLevel={}",
                playerId, sessionId, buyIn, cannonLevel);

        WalletView wallet = WalletView.builder()
                .balance(debit.balanceAfter())
                .frozenAmount(0L)
                .build();
        return toView(session, false, wallet);
    }

    /** 查詢進行中場次（斷線重連恢復）。無進行中場次回 {@link Optional#empty()}。 */
    public Optional<FishingSessionView> findActive(long playerId) {
        return sessionStore.find(playerId)
                .filter(FishingSession::isActive)
                .map(session -> toView(session, true, null));
    }

    /**
     * 批次射擊：逐發判定並更新局內餘額。
     *
     * @throws RoundNotFoundException   無進行中場次或 sessionId 不符
     * @throws IllegalArgumentException 序號/注額/射速驗證失敗（整批拒絕，不動帳）
     */
    public FishingShotsResponse shots(long playerId, String sessionId, List<FishingShotsRequest.Shot> shots) {
        FishingSession session = requireActiveSession(playerId, sessionId);

        validateBatch(session, shots);

        long balance = session.getSessionBalance();
        long totalBet = session.getTotalBet();
        long totalPayout = session.getTotalPayout();
        long totalShots = session.getTotalShots();
        long lastShotSeq = session.getLastShotSeq();

        List<FishingShotsResponse.ShotResult> results = new ArrayList<>(shots.size());
        for (FishingShotsRequest.Shot shot : shots) {
            if (balance < shot.getBetPerShot()) {
                // 局內餘額不足：該發起全部不受理（不扣注、不判定），前端據此停火
                results.add(FishingShotsResponse.ShotResult.builder()
                        .shotSeq(shot.getShotSeq())
                        .accepted(false)
                        .hit(false)
                        .payout(0L)
                        .sessionBalance(balance)
                        .build());
                continue;
            }

            balance -= shot.getBetPerShot();
            totalBet += shot.getBetPerShot();
            totalShots++;
            lastShotSeq = shot.getShotSeq();

            FishSpecies species = FishSpecies.fromCode(shot.getFishType());
            RandomStream stream = rng.stream(session.getServerSeed(), session.getClientSeed(), shot.getShotSeq());
            long payout = species.resolvePayout(stream, shot.getBetPerShot());
            if (payout > 0) {
                balance += payout;
                totalPayout += payout;
            }

            results.add(FishingShotsResponse.ShotResult.builder()
                    .shotSeq(shot.getShotSeq())
                    .accepted(true)
                    .hit(payout > 0)
                    .payout(payout)
                    .sessionBalance(balance)
                    .build());
        }

        session.setSessionBalance(balance);
        session.setTotalBet(totalBet);
        session.setTotalPayout(totalPayout);
        session.setTotalShots(totalShots);
        session.setLastShotSeq(lastShotSeq);
        session.setLastActivityAt(Instant.now());
        sessionStore.save(session);

        return FishingShotsResponse.builder()
                .sessionId(sessionId)
                .results(results)
                .sessionBalance(balance)
                .totalShots(totalShots)
                .lastShotSeq(lastShotSeq)
                .build();
    }

    /**
     * 結算：剩餘局內餘額冪等 credit 回 wallet、寫彙總對局、發 game.result、揭露 serverSeed。
     */
    public FishingEndResponse end(long playerId, String sessionId) {
        FishingSession session = requireActiveSession(playerId, sessionId);
        return settleInternal(session, "player-end");
    }

    /**
     * 閒置回收排程：每分鐘掃描，閒置超過 {@value #IDLE_TIMEOUT_MINUTES} 分鐘的場次自動結算
     * （把錢還回 wallet）。斷線玩家的「彩池與子彈」由此精準結回，不會憑空消失。
     */
    @Scheduled(fixedDelayString = "${game.fishing.sweep-interval-ms:60000}")
    public void sweepIdleSessions() {
        List<Long> playerIds;
        try {
            playerIds = sessionStore.listPlayerIds();
        } catch (Exception ex) {
            // Redis 抖動/不可用時，整批掃描略過本輪即可（下一輪自動重試），不讓排程每分鐘噴 ERROR
            log.warn("fishing idle sweep: 無法列出 session（Redis 不可用?），略過本輪: {}", ex.toString());
            return;
        }
        for (Long playerId : playerIds) {
            try {
                Optional<FishingSession> found = sessionStore.find(playerId);
                if (found.isEmpty() || !found.get().isActive()) {
                    continue;
                }
                FishingSession session = found.get();
                Instant lastActivity = session.getLastActivityAt() == null
                        ? session.getCreatedAt()
                        : session.getLastActivityAt();
                if (lastActivity != null
                        && Duration.between(lastActivity, Instant.now()).toMinutes() >= IDLE_TIMEOUT_MINUTES) {
                    log.info("fishing session idle, auto-settling playerId={} sessionId={}",
                            playerId, session.getSessionId());
                    settleInternal(session, "idle-sweep");
                }
            } catch (Exception ex) {
                // 單一玩家結算失敗不可中斷整批掃描；下一輪會重試（帳務冪等）
                log.warn("fishing idle sweep failed playerId={}: {}", playerId, ex.toString());
            }
        }
    }

    /**
     * 單發公平性驗證（場次結算後）：以對局紀錄的 seed 重放指定 shotSeq 的判定。
     */
    public FishingShotVerifyResponse verifyShot(String sessionId, long shotSeq, String fishType, long betPerShot) {
        GameRound round = roundRepository.findByRoundId(sessionId)
                .orElseThrow(() -> new RoundNotFoundException(
                        "場次不存在或尚未結算（sessionId=" + sessionId + "）"));

        FishSpecies species = FishSpecies.fromCode(fishType);
        boolean commitmentValid = rng.verifyCommitment(round.getServerSeed(), round.getServerSeedHash());
        RandomStream stream = rng.stream(round.getServerSeed(), round.getClientSeed(), shotSeq);
        long payout = species.resolvePayout(stream, betPerShot);

        return FishingShotVerifyResponse.builder()
                .sessionId(sessionId)
                .shotSeq(shotSeq)
                .fishType(species.name())
                .betPerShot(betPerShot)
                .commitmentValid(commitmentValid)
                .hit(payout > 0)
                .payout(payout)
                .serverSeed(round.getServerSeed())
                .serverSeedHash(round.getServerSeedHash())
                .clientSeed(round.getClientSeed())
                .message(commitmentValid
                        ? "承諾相符；該發結果可由 (serverSeed, clientSeed, shotSeq) 確定性重現"
                        : "承諾雜湊不符（異常）")
                .build();
    }

    // ------------------------------------------------------------------
    // 內部
    // ------------------------------------------------------------------

    private FishingSession requireActiveSession(long playerId, String sessionId) {
        return sessionStore.find(playerId)
                .filter(FishingSession::isActive)
                .filter(s -> s.getSessionId().equals(sessionId))
                .orElseThrow(() -> new RoundNotFoundException(
                        "捕魚場次不存在或已結算（sessionId=" + sessionId + "）"));
    }

    /** 整批驗證：注額、序號嚴格遞增、射速上限。任一不符整批拒絕（不動帳）。 */
    private void validateBatch(FishingSession session, List<FishingShotsRequest.Shot> shots) {
        long allowedBet = CANNON_BET[session.getCannonLevel()];
        long previousSeq = session.getLastShotSeq();
        for (FishingShotsRequest.Shot shot : shots) {
            if (shot.getBetPerShot() != allowedBet) {
                throw new IllegalArgumentException(
                        "betPerShot 須等於炮台等級 " + session.getCannonLevel() + " 的固定注額 " + allowedBet);
            }
            if (shot.getShotSeq() <= previousSeq) {
                throw new IllegalArgumentException(
                        "shotSeq 必須嚴格遞增（上次受理至 " + session.getLastShotSeq() + "）");
            }
            previousSeq = shot.getShotSeq();
        }

        Instant lastActivity = session.getLastActivityAt() == null
                ? session.getCreatedAt()
                : session.getLastActivityAt();
        long elapsedMs = Math.max(Duration.between(lastActivity, Instant.now()).toMillis(), 0L);
        long allowedShots = elapsedMs * MAX_SHOTS_PER_SEC / 1000 + BURST_ALLOWANCE;
        if (shots.size() > allowedShots) {
            throw new IllegalArgumentException("射速異常（疑似連點外掛），本批子彈已整批拒絕");
        }
    }

    private FishingEndResponse settleInternal(FishingSession session, String reason) {
        long playerId = session.getPlayerId();
        String sessionId = session.getSessionId();
        long credited = session.getSessionBalance() == null ? 0L : session.getSessionBalance();

        WalletView wallet = null;
        if (credited > 0) {
            WalletCreditResponse credit = walletClient.credit(
                    playerId, credited, "fishing-end-" + sessionId, sessionId);
            wallet = WalletView.builder()
                    .balance(credit.balanceAfter())
                    .frozenAmount(credit.frozenAfter() == null ? 0L : credit.frozenAfter())
                    .build();
        }

        // 彙總對局紀錄（roundId = sessionId 去重，重試不重複插入）
        if (roundRepository.findByRoundId(sessionId).isEmpty()) {
            try {
                GameRound round = buildRound(session);
                roundRepository.save(round);
                eventPublisher.publishFishingResult(round, session.getTotalShots());
            } catch (DataIntegrityViolationException e) {
                // 僅當對局確實已被另一執行緒寫入（round_id 唯一鍵衝突）時，才視為並發結算而忽略；
                // 其他資料完整性錯誤（如 CHECK 約束違反）不可靜默吞掉，否則會遮蔽 schema/資料問題
                // （曾因 chk_gr_game_type 缺 FISHING 而被誤判為並發結算、導致對局未持久化、verify-shot 404）。
                if (roundRepository.findByRoundId(sessionId).isPresent()) {
                    log.info("fishing session concurrently settled, skip persist sessionId={}", sessionId);
                } else {
                    log.error("fishing round persist failed sessionId={}", sessionId, e);
                    throw e;
                }
            }
        }

        sessionStore.delete(playerId);

        log.info("fishing session settled sessionId={} playerId={} reason={} buyIn={} totalBet={} totalPayout={} credited={}",
                sessionId, playerId, reason, session.getBuyIn(), session.getTotalBet(),
                session.getTotalPayout(), credited);

        return FishingEndResponse.builder()
                .sessionId(sessionId)
                .buyIn(session.getBuyIn())
                .totalBet(session.getTotalBet())
                .totalPayout(session.getTotalPayout())
                .totalShots(session.getTotalShots())
                .credited(credited)
                .serverSeed(session.getServerSeed())
                .serverSeedHash(session.getServerSeedHash())
                .clientSeed(session.getClientSeed())
                .wallet(wallet)
                .build();
    }

    private GameRound buildRound(FishingSession session) {
        GameRound round = new GameRound();
        round.setRoundId(session.getSessionId());
        round.setPlayerId(session.getPlayerId());
        round.setGameType(GAME_TYPE);
        // RTP 統計口徑：以「子彈下注總額 / 派彩總額」為準（wallet 流向為 buyIn/credited，淨額一致）
        round.setBetAmount(session.getTotalBet());
        round.setWinAmount(session.getTotalPayout());
        round.setServerSeed(session.getServerSeed());
        round.setServerSeedHash(session.getServerSeedHash());
        round.setClientSeed(session.getClientSeed());
        round.setNonce(session.getLastShotSeq());
        round.setResultData(writeResultJson(session));
        round.setStatus(STATUS_SETTLED);
        round.setSettledAt(LocalDateTime.now());
        return round;
    }

    private String writeResultJson(FishingSession session) {
        try {
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("buyIn", session.getBuyIn());
            result.put("credited", session.getSessionBalance());
            result.put("totalShots", session.getTotalShots());
            result.put("totalBet", session.getTotalBet());
            result.put("totalPayout", session.getTotalPayout());
            result.put("cannonLevel", session.getCannonLevel());
            result.put("roomId", session.getRoomId());
            return objectMapper.writeValueAsString(result);
        } catch (Exception ex) {
            log.warn("序列化捕魚結果失敗: {}", ex.toString());
            return "{}";
        }
    }

    private FishingSessionView toView(FishingSession session, boolean resumed, WalletView wallet) {
        List<FishingSessionView.FishTableEntry> fishTable = new ArrayList<>();
        for (FishSpecies species : FishSpecies.values()) {
            fishTable.add(FishingSessionView.FishTableEntry.builder()
                    .code(species.name())
                    .name(species.displayName())
                    .assetId(species.assetId())
                    .multiplier(species.multiplier())
                    .hitProbability(species.hitProbability())
                    .build());
        }
        return FishingSessionView.builder()
                .sessionId(session.getSessionId())
                .roomId(session.getRoomId())
                .seatIndex(session.getSeatIndex())
                .cannonLevel(session.getCannonLevel())
                .buyIn(session.getBuyIn())
                .sessionBalance(session.getSessionBalance())
                .totalShots(session.getTotalShots())
                .lastShotSeq(session.getLastShotSeq())
                .serverSeedHash(session.getServerSeedHash())
                .clientSeed(session.getClientSeed())
                .resumed(resumed)
                .wallet(wallet)
                .fishTable(fishTable)
                .build();
    }
}
