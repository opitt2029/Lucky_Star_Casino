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
import com.luckystar.game.dto.FishingTopUpResponse;
import com.luckystar.game.dto.WalletView;
import com.luckystar.game.entity.GameRound;
import com.luckystar.game.exception.RoundNotFoundException;
import com.luckystar.game.fishing.FishSpecies;
import com.luckystar.game.fishing.FishingCombat;
import com.luckystar.game.fishing.FishingSession;
import com.luckystar.game.fishing.FishingSessionStore;
import com.luckystar.game.kafka.GameResultEventPublisher;
import com.luckystar.game.repository.GameRoundRepository;
import com.luckystar.game.rng.ProvablyFairRng;
import com.luckystar.game.rng.RandomStream;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashMap;
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
 *   <li>betPerShot 必須等於進場選定的固定注額（玩家自選面額，整場固定；防自訂大注小注混打繞過費率）。</li>
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

    /** 子彈面額（單發注額）下限／上限（星幣）：玩家進場自選，與砲台解耦；上限為安全天花板防單發暴險。 */
    static final long MIN_BET = 10L;
    static final long MAX_BET = 10_000L;

    /** 入場金額（buyIn）下限／上限（星幣）：上限為安全天花板（實質不限，僅再受錢包餘額約束）。 */
    static final long MIN_BUYIN = 100L;
    static final long MAX_BUYIN = 1_000_000L;

    /** 射速上限（發/秒）。 */
    static final int MAX_SHOTS_PER_SEC = 8;

    /** 突發緩衝（網路抖動下首批/併批的容忍發數）。 */
    static final int BURST_ALLOWANCE = 15;

    /** 閒置自動結算門檻（分鐘）。 */
    static final long IDLE_TIMEOUT_MINUTES = 10;

    /** 單場次同時追蹤傷害的魚 instance 上限（防前端灌量；超出時淘汰最舊者）。 */
    static final int MAX_LIVE_FISH = 80;

    /** 致命一擊紀錄保留上限（供 verifyShot 重放近期捕獲；超出時淘汰最舊，避免 result_data 無限膨脹）。 */
    static final int KILL_LOG_CAP = 300;

    private final ProvablyFairRng rng;
    private final WalletClient walletClient;
    private final FishingSessionStore sessionStore;
    private final GameRoundRepository roundRepository;
    private final GameResultEventPublisher eventPublisher;
    private final ObjectMapper objectMapper;
    private final RiskControlService riskControlService;

    /**
     * 開場（或續玩）：已有進行中場次時直接回傳原場次（resumed=true，不重複扣款）；
     * 否則向 wallet 冪等扣 buyIn 並建立新場次。
     */
    public FishingSessionView start(long playerId, long buyIn, int cannonLevel, long betPerShot,
                                    String requestedClientSeed) {
        Optional<FishingSession> existing = sessionStore.find(playerId);
        if (existing.isPresent() && existing.get().isActive()) {
            log.info("fishing session resumed playerId={} sessionId={}", playerId, existing.get().getSessionId());
            return toView(existing.get(), true, null);
        }

        // 面額/入場金額守門（玩家自選；DTO 已驗，這裡為直接呼叫與防禦性二保險）
        if (betPerShot < MIN_BET || betPerShot > MAX_BET) {
            throw new IllegalArgumentException("子彈面額需介於 " + MIN_BET + "~" + MAX_BET + " 星幣");
        }
        if (buyIn < MIN_BUYIN || buyIn > MAX_BUYIN) {
            throw new IllegalArgumentException("入場金額需介於 " + MIN_BUYIN + "~" + MAX_BUYIN + " 星幣");
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
                .betPerShot(betPerShot)
                .buyIn(buyIn)
                .balanceBefore(debit.balanceBefore())
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
                walletClient.credit(playerId, buyIn, "REFUND", "fishing-buyin-refund-" + sessionId, sessionId);
                log.info("fishing buy-in refunded playerId={} sessionId={} amount={}", playerId, sessionId, buyIn);
            } catch (RuntimeException refundEx) {
                // 退款本身又失敗：記為需人工對帳的嚴重事件（冪等鍵已落地，可日後重放補償）
                log.error("fishing buy-in REFUND FAILED playerId={} sessionId={} amount={} (需人工對帳)",
                        playerId, sessionId, buyIn, refundEx);
            }
            throw ex;
        }

        log.info("fishing session started playerId={} sessionId={} buyIn={} cannonLevel={} betPerShot={}",
                playerId, sessionId, buyIn, cannonLevel, betPerShot);

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
    public FishingShotsResponse shots(long playerId, String sessionId,
                                      List<FishingShotsRequest.Shot> shots) {
        FishingSession session = requireActiveSession(playerId, sessionId);

        validateBatch(session, shots);

        // 風控攔截：整批子彈共用同一攔截結果，避免逐發查詢 DB。
        // shouldIntercept 佔用並發閘；shots() 最後的 finally 必須釋放。
        boolean intercepted = riskControlService.shouldIntercept(session.getPlayerId(), GAME_TYPE);
        try {

        long balance = session.getSessionBalance();
        long totalBet = session.getTotalBet();
        long totalPayout = session.getTotalPayout();
        long totalShots = session.getTotalShots();
        long lastShotSeq = session.getLastShotSeq();

        Map<String, Long> fishDamage = session.getFishDamage();
        if (fishDamage == null) {
            fishDamage = new LinkedHashMap<>();
            session.setFishDamage(fishDamage);
        }
        Map<String, Long> fishRecovery = session.getFishRecovery();
        if (fishRecovery == null) {
            fishRecovery = new LinkedHashMap<>();
            session.setFishRecovery(fishRecovery);
        }
        List<FishingSession.KillRecord> kills = session.getKills();
        if (kills == null) {
            kills = new ArrayList<>();
            session.setKills(kills);
        }

        List<FishingShotsResponse.ShotResult> results = new ArrayList<>(shots.size());
        for (FishingShotsRequest.Shot shot : shots) {
            if (balance < shot.getBetPerShot()) {
                // 局內餘額不足：該發起全部不受理（不扣注、不判定），前端據此停火
                results.add(FishingShotsResponse.ShotResult.builder()
                        .shotSeq(shot.getShotSeq())
                        .accepted(false)
                        .hit(false)
                        .crit(false)
                        .damage(0L)
                        .hpRemaining(0L)
                        .killed(false)
                        .captured(false)
                        .payout(0L)
                        .sessionBalance(balance)
                        .build());
                continue;
            }

            balance -= shot.getBetPerShot();
            totalBet += shot.getBetPerShot();
            totalShots++;
            lastShotSeq = shot.getShotSeq();

            String instanceId = shot.getFishInstanceId();
            int cannonLevel = session.getCannonLevel();
            if (isMissShotType(shot.getFishType())) {
                results.add(FishingShotsResponse.ShotResult.builder()
                        .shotSeq(shot.getShotSeq())
                        .accepted(true)
                        .hit(false)
                        .crit(false)
                        .damage(0L)
                        .hpRemaining(0L)
                        .killed(false)
                        .captured(false)
                        .payout(0L)
                        .sessionBalance(balance)
                        .build());
                continue;
            }

            if (isBlockerFishType(shot.getFishType())) {
                results.add(FishingShotsResponse.ShotResult.builder()
                        .shotSeq(shot.getShotSeq())
                        .accepted(true)
                        .hit(true)
                        .crit(false)
                        .damage(0L)
                        .hpRemaining(0L)
                        .killed(false)
                        .captured(false)
                        .payout(0L)
                        .sessionBalance(balance)
                        .build());
                continue;
            }

            FishSpecies species = FishSpecies.fromCode(shot.getFishType());
            long damageBefore = fishDamage.getOrDefault(instanceId, 0L);
            RandomStream stream = rng.stream(session.getServerSeed(), session.getClientSeed(), shot.getShotSeq());

            // 風控攔截時仍正常消耗 RNG stream，確保 seed 可重放驗證（Provably Fair）。
            FishingCombat.ShotOutcome outcome =
                    FishingCombat.resolveShot(stream, species, cannonLevel, damageBefore, shot.getBetPerShot());

            // 風控攔截：致命一擊的捕獲一律改判「掙脫」、派彩 0（RNG 已照常消耗）。
            boolean captured = outcome.captured() && !intercepted;
            long payout = captured ? outcome.payout() : 0L;

            if (outcome.killed()) {
                // 致命一擊：記錄供 verifyShot 精確重放，並移除該魚 instance 的累傷。
                kills.add(new FishingSession.KillRecord(shot.getShotSeq(), species.name(), damageBefore, cannonLevel));
                while (kills.size() > KILL_LOG_CAP) {
                    kills.remove(0);
                }
                fishDamage.remove(instanceId);
                fishRecovery.remove(instanceId);
            } else {
                // 未死：累積傷害（並控管並存 instance 數，淘汰最舊者）。
                fishDamage.put(instanceId, outcome.damageTakenAfter());
                long recovery = fishRecovery.getOrDefault(instanceId, 0L)
                        + FishingCombat.recoveryPayout(shot.getBetPerShot(), cannonLevel, outcome.damage());
                fishRecovery.put(instanceId, recovery);
                pruneFishDamage(fishDamage);
            }

            if (payout > 0) {
                balance += payout;
                totalPayout += payout;
            }

            results.add(FishingShotsResponse.ShotResult.builder()
                    .shotSeq(shot.getShotSeq())
                    .accepted(true)
                    .hit(true)
                    .crit(outcome.crit())
                    .damage(outcome.damage())
                    .hpRemaining(outcome.hpRemaining())
                    .killed(outcome.killed())
                    .captured(captured)
                    .payout(payout)
                    .sessionBalance(balance)
                    .build());
        }

        if (intercepted) {
            session.setIntercepted(Boolean.TRUE);
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
        } finally {
            riskControlService.releaseRiskSlot(session.getPlayerId());
        }
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

    /**
     * Adds wallet balance into an active fishing session without settling the round.
     * The clientRequestId is persisted in the Redis session so a retried top-up cannot
     * add the same wallet debit into the table twice.
     */
    public FishingTopUpResponse topUp(long playerId, String sessionId, long amount, String clientRequestId) {
        FishingSession session = requireActiveSession(playerId, sessionId);
        if (amount < MIN_BUYIN || amount > MAX_BUYIN) {
            throw new IllegalArgumentException("top-up amount must be between " + MIN_BUYIN + " and " + MAX_BUYIN);
        }
        if (!StringUtils.hasText(clientRequestId)) {
            throw new IllegalArgumentException("clientRequestId is required");
        }
        String requestId = clientRequestId.trim();
        List<String> processed = session.getTopUpRequestIds();
        if (processed == null) {
            processed = new ArrayList<>();
            session.setTopUpRequestIds(processed);
        }
        if (processed.contains(requestId)) {
            return FishingTopUpResponse.builder()
                    .sessionId(sessionId)
                    .amount(0L)
                    .buyIn(session.getBuyIn() == null ? 0L : session.getBuyIn())
                    .sessionBalance(session.getSessionBalance() == null ? 0L : session.getSessionBalance())
                    .wallet(null)
                    .build();
        }

        String idempotencyKey = "fishing-topup-" + sessionId + "-" + requestId;
        WalletDebitResponse debit = walletClient.debit(playerId, amount, idempotencyKey, sessionId);

        long buyIn = session.getBuyIn() == null ? 0L : session.getBuyIn();
        long tableBalance = session.getSessionBalance() == null ? 0L : session.getSessionBalance();
        session.setBuyIn(buyIn + amount);
        session.setSessionBalance(tableBalance + amount);
        processed.add(requestId);
        session.setLastActivityAt(Instant.now());
        try {
            sessionStore.save(session);
        } catch (RuntimeException ex) {
            log.error("fishing top-up session save failed, refunding playerId={} sessionId={} amount={}",
                    playerId, sessionId, amount, ex);
            try {
                walletClient.credit(playerId, amount, "REFUND", "fishing-topup-refund-" + sessionId + "-" + requestId, sessionId);
            } catch (RuntimeException refundEx) {
                log.error("fishing top-up REFUND FAILED playerId={} sessionId={} amount={}", playerId, sessionId, amount, refundEx);
            }
            throw ex;
        }

        WalletView wallet = WalletView.builder()
                .balance(debit.balanceAfter())
                .frozenAmount(0L)
                .build();
        log.info("fishing session topped up playerId={} sessionId={} amount={} buyIn={} sessionBalance={}",
                playerId, sessionId, amount, session.getBuyIn(), session.getSessionBalance());
        return FishingTopUpResponse.builder()
                .sessionId(sessionId)
                .amount(amount)
                .buyIn(session.getBuyIn())
                .sessionBalance(session.getSessionBalance())
                .wallet(wallet)
                .build();
    }

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

        boolean commitmentValid = rng.verifyCommitment(round.getServerSeed(), round.getServerSeedHash());

        // 讀取場次結算時記錄的：砲台等級、風控旗標、各致命一擊（shotSeq→damageBefore/魚種）
        int cannonLevel = 1;
        boolean riskControlled = false;
        Map<Long, Long> killDamageBefore = new HashMap<>();
        Map<Long, String> killSpecies = new HashMap<>();
        Map<Long, Integer> killCannonLevel = new HashMap<>();
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> resultData = objectMapper.readValue(round.getResultData(), Map.class);
            Object cl = resultData.get("cannonLevel");
            if (cl instanceof Number) cannonLevel = ((Number) cl).intValue();
            riskControlled = Boolean.TRUE.equals(resultData.get("riskControlled"));
            Object killsObj = resultData.get("kills");
            if (killsObj instanceof List<?> list) {
                for (Object entry : list) {
                    if (entry instanceof Map<?, ?> m && m.get("shotSeq") instanceof Number seq) {
                        long s = seq.longValue();
                        Object before = m.get("damageBefore");
                        killDamageBefore.put(s, before instanceof Number ? ((Number) before).longValue() : 0L);
                        Object ft = m.get("fishType");
                        if (ft != null) killSpecies.put(s, String.valueOf(ft));
                        Object cannon = m.get("cannonLevel");
                        if (cannon instanceof Number) killCannonLevel.put(s, ((Number) cannon).intValue());
                    }
                }
            }
        } catch (Exception ignored) {
            // result_data 不存在或格式異常時，保守以 fishType 參數 + damageBefore=0 重放（不影響承諾驗證本身）
        }

        // 致命一擊以結算紀錄的魚種為準（避免依賴 client 傳入的 fishType）；非致命發則用查詢參數。
        boolean killingBlow = killDamageBefore.containsKey(shotSeq);
        FishSpecies species = FishSpecies.fromCode(killSpecies.getOrDefault(shotSeq, fishType));
        long damageBefore = killingBlow ? killDamageBefore.get(shotSeq) : 0L;
        if (killCannonLevel.containsKey(shotSeq)) cannonLevel = killCannonLevel.get(shotSeq);

        RandomStream stream = rng.stream(round.getServerSeed(), round.getClientSeed(), shotSeq);
        FishingCombat.ShotOutcome outcome =
                FishingCombat.resolveShot(stream, species, cannonLevel, damageBefore, betPerShot);

        String message;
        if (!commitmentValid) {
            message = "承諾雜湊不符（異常）";
        } else if (!killingBlow) {
            message = "承諾相符；此發為非致命發（未派彩），暴擊/傷害判定可由 (serverSeed, clientSeed, shotSeq) 重放";
        } else if (riskControlled && outcome.captured()) {
            // PF 重現為捕獲，但場次有風控介入；實際入帳派彩為 0
            message = "承諾相符；RNG 重現為捕獲，但此場次有風控介入，"
                    + "命中局的實際入帳派彩已調整為 0（payout 欄位顯示原始 RNG 值）";
        } else {
            message = "承諾相符；該致命一擊結果可由 (serverSeed, clientSeed, shotSeq) 確定性重現";
        }

        return FishingShotVerifyResponse.builder()
                .sessionId(sessionId)
                .shotSeq(shotSeq)
                .fishType(species.name())
                .betPerShot(betPerShot)
                .commitmentValid(commitmentValid)
                .hit(outcome.captured())
                .payout(outcome.payout())
                .riskControlled(riskControlled)
                .serverSeed(round.getServerSeed())
                .serverSeedHash(round.getServerSeedHash())
                .clientSeed(round.getClientSeed())
                .message(message)
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
    private boolean isMissShotType(String fishType) {
        if (fishType == null) {
            return false;
        }
        return fishType.trim().equalsIgnoreCase("MISS");
    }

    private boolean isBlockerFishType(String fishType) {
        if (fishType == null) {
            return false;
        }
        String normalized = fishType.trim().toUpperCase();
        return normalized.equals("BLOCKER_OCTOPUS")
                || normalized.equals("BLOCKER_STARFISH")
                || normalized.equals("BLOCKER_TURTLE");
    }

    private void validateBatch(FishingSession session, List<FishingShotsRequest.Shot> shots) {
        long previousSeq = session.getLastShotSeq();
        for (FishingShotsRequest.Shot shot : shots) {
            if (shot.getBetPerShot() == null || shot.getBetPerShot() < MIN_BET || shot.getBetPerShot() > MAX_BET) {
                throw new IllegalArgumentException("betPerShot must be between " + MIN_BET + " and " + MAX_BET);
            }
            if (session.getBetPerShot() != null && !shot.getBetPerShot().equals(session.getBetPerShot())) {
                throw new IllegalArgumentException("betPerShot must equal the session betPerShot");
            }
            Integer cannonLevel = shot.getCannonLevel();
            if (cannonLevel != null && (cannonLevel < 1 || cannonLevel > 3)) {
                throw new IllegalArgumentException("cannonLevel must be between 1 and 3");
            }
            if (cannonLevel != null && session.getCannonLevel() != null && !cannonLevel.equals(session.getCannonLevel())) {
                throw new IllegalArgumentException("cannonLevel must equal the session cannonLevel");
            }
            if (shot.getShotSeq() <= previousSeq) {
                throw new IllegalArgumentException(
                        "shotSeq 必須遞增，目前最後序號 " + session.getLastShotSeq());
            }
            previousSeq = shot.getShotSeq();
        }

        Instant lastActivity = session.getLastActivityAt() == null
                ? session.getCreatedAt()
                : session.getLastActivityAt();
        long elapsedMs = Math.max(Duration.between(lastActivity, Instant.now()).toMillis(), 0L);
        long allowedShots = elapsedMs * MAX_SHOTS_PER_SEC / 1000 + BURST_ALLOWANCE;
        if (shots.size() > allowedShots) {
            throw new IllegalArgumentException("射擊速度過快，請稍後再試");
        }
    }

    /**
     * 殘血部分回收總額（ADR-004）：對結算時仍受傷未死的每條魚（fishDamage 的每個 entry），
     * 累加 {@link FishingCombat#recoveryPayout}。只需 session 級的 cannonLevel/betPerShot ＋ 累傷值，
     * 不需查 species/HP（致命一擊後該魚已從 fishDamage 移除，故這裡掃到的都是未死殘血魚）。
     */
    private long computeResidualRecovery(FishingSession session) {
        Map<String, Long> fishRecovery = session.getFishRecovery();
        if (fishRecovery != null && !fishRecovery.isEmpty()) {
            long total = 0L;
            for (Long recovery : fishRecovery.values()) {
                if (recovery != null) total += recovery;
            }
            return total;
        }
        Map<String, Long> fishDamage = session.getFishDamage();
        if (fishDamage == null || fishDamage.isEmpty()) {
            return 0L;
        }
        Integer cannonLevel = session.getCannonLevel();
        Long betPerShot = session.getBetPerShot();
        if (cannonLevel == null || betPerShot == null) {
            return 0L;
        }
        long total = 0L;
        for (Long dmg : fishDamage.values()) {
            if (dmg != null) {
                total += FishingCombat.recoveryPayout(betPerShot, cannonLevel, dmg);
            }
        }
        return total;
    }

    /** 控管同時追蹤傷害的魚 instance 數：超出上限時淘汰最舊（LinkedHashMap 插入序）者。 */
    private void pruneFishDamage(Map<String, Long> fishDamage) {
        while (fishDamage.size() > MAX_LIVE_FISH) {
            String eldest = fishDamage.keySet().iterator().next();
            fishDamage.remove(eldest);
        }
    }

    private FishingEndResponse settleInternal(FishingSession session, String reason) {
        long playerId = session.getPlayerId();
        String sessionId = session.getSessionId();

        // 殘血部分回收（ADR-004）：結算時 fishDamage 只剩「受傷但未打死」的魚（致命一擊後已移除），
        // 按已造成傷害換算的期望耗彈成本退還 RECOVERY_RATE 比例，折入局內餘額（會 credit 回 wallet）
        // 並計入 totalPayout（→ game_rounds.win_amount，admin RTP 監控涵蓋）。回收恆 ≤ 投入成本，RTP 不超付。
        long recovery = computeResidualRecovery(session);
        if (recovery > 0) {
            long base = session.getSessionBalance() == null ? 0L : session.getSessionBalance();
            session.setSessionBalance(base + recovery);
            long tp = session.getTotalPayout() == null ? 0L : session.getTotalPayout();
            session.setTotalPayout(tp + recovery);
            if (session.getFishDamage() != null) {
                session.getFishDamage().clear();
            }
        }

        long credited = session.getSessionBalance() == null ? 0L : session.getSessionBalance();

        WalletView wallet = null;
        // 派彩後餘額（稽核）：有退回時取 credit 後餘額；無退回時＝投注前餘額扣掉 buyIn（buyIn 全數消耗）。
        Long balanceAfter = (session.getBalanceBefore() != null && session.getBuyIn() != null)
                ? session.getBalanceBefore() - session.getBuyIn()
                : null;
        if (credited > 0) {
            // 結算返還的是「剩餘局內餘額」（未消耗的 buy-in + 局內累積派彩的混合），不是單純中獎；
            // 用 REFUND 而非 WIN，避免 rank-service 把本金返還誤計入「今日贏幣榜」（Bug 5）。
            WalletCreditResponse credit = walletClient.credit(
                    playerId, credited, "REFUND", "fishing-end-" + sessionId, sessionId);
            balanceAfter = credit.balanceAfter();
            wallet = WalletView.builder()
                    .balance(credit.balanceAfter())
                    .frozenAmount(credit.frozenAfter() == null ? 0L : credit.frozenAfter())
                    .build();
        }

        // 彙總對局紀錄（roundId = sessionId 去重，重試不重複插入）
        if (roundRepository.findByRoundId(sessionId).isEmpty()) {
            try {
                GameRound round = buildRound(session, balanceAfter);
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
                .residualRecovery(recovery)
                .serverSeed(session.getServerSeed())
                .serverSeedHash(session.getServerSeedHash())
                .clientSeed(session.getClientSeed())
                .wallet(wallet)
                .build();
    }

    private GameRound buildRound(FishingSession session, Long balanceAfter) {
        GameRound round = new GameRound();
        round.setRoundId(session.getSessionId());
        round.setPlayerId(session.getPlayerId());
        round.setGameType(GAME_TYPE);
        // RTP 統計口徑：以「子彈下注總額 / 派彩總額」為準（wallet 流向為 buyIn/credited，淨額一致）
        round.setBetAmount(session.getTotalBet());
        round.setWinAmount(session.getTotalPayout());
        round.setBalanceBefore(session.getBalanceBefore());
        round.setBalanceAfter(balanceAfter);
        round.setServerSeed(session.getServerSeed());
        round.setServerSeedHash(session.getServerSeedHash());
        round.setClientSeed(session.getClientSeed());
        round.setNonce(session.getLastShotSeq());
        round.setResultData(writeResultJson(session));
        round.setStatus(STATUS_SETTLED);
        // 下注時間＝進場（start）時間；派彩時間＝結算當下。
        if (session.getCreatedAt() != null) {
            round.setBetAt(LocalDateTime.ofInstant(session.getCreatedAt(), ZoneId.systemDefault()));
        }
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
            // verifyShot 用：此場次是否曾有批次被風控攔截（命中時實際派彩為 0）
            result.put("riskControlled", Boolean.TRUE.equals(session.getIntercepted()));
            // verifyShot 用：各致命一擊的 shotSeq / 魚種 / 該發前累積傷害，供重放捕獲判定
            result.put("kills", session.getKills());
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
                    .hp(species.hp())
                    .tier(species.tier().name())
                    .spawnWeight(species.spawnWeight())
                    .build());
        }
        return FishingSessionView.builder()
                .sessionId(session.getSessionId())
                .roomId(session.getRoomId())
                .seatIndex(session.getSeatIndex())
                .cannonLevel(session.getCannonLevel())
                .betPerShot(session.getBetPerShot())
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
