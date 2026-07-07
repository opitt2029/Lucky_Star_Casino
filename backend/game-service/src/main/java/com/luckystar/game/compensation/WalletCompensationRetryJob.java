package com.luckystar.game.compensation;

import com.luckystar.game.client.WalletClient;
import java.time.LocalDateTime;
import java.util.List;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 補償單重試排程（ADR-009）：每 30 秒撈 {@code PENDING} 且到期（{@code next_retry_at <= now}）
 * 的補償單，帶<b>與原始呼叫相同的冪等鍵</b>重呼 {@code WalletClient.credit}。
 *
 * <ul>
 *   <li><b>成功</b> → 標 DONE。若原始 credit 其實已在 wallet 端生效（例如回應在半路逾時），
 *       wallet 的冪等檢查會直接回原流水、不重複入帳——所以「盲目重試」是安全的。</li>
 *   <li><b>失敗</b> → retry_count+1、指數退避（30s 起倍增、上限 {@value #MAX_BACKOFF_SECONDS}s）；
 *       超過 {@value #MAX_RETRIES} 次標 FAILED 並 log.error（需人工對帳，
 *       可由 tools/reconciliation/reconcile-game-wallet.mjs 盤點）。</li>
 * </ul>
 *
 * <p><b>雷區 6</b>：只走 HTTP {@code WalletClient}，不消費 wallet 事件回呼帳務方法。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class WalletCompensationRetryJob {

    /** 重試次數上限，超過標 FAILED（30s 起指數退避，約 1.5~2 小時的自動修復窗口）。 */
    static final int MAX_RETRIES = 10;

    /** 首次重試的退避基數（秒）。 */
    static final long BASE_BACKOFF_SECONDS = 30L;

    /** 退避上限（秒）＝ 30 分鐘，避免高次重試把下次時間推到天邊。 */
    static final long MAX_BACKOFF_SECONDS = 1800L;

    private final PendingWalletCreditRepository repository;
    private final WalletClient walletClient;

    @Scheduled(fixedDelayString = "${game.compensation.retry-interval-ms:30000}")
    public void retryPending() {
        List<PendingWalletCredit> due;
        try {
            due = repository.findTop50ByStatusAndNextRetryAtLessThanEqualOrderByIdAsc(
                    "PENDING", LocalDateTime.now());
        } catch (Exception ex) {
            // DB 抖動時略過本輪即可（下一輪自動重試），比照 fishing idle sweep 的作法
            log.warn("[補償] 無法撈取補償單（DB 不可用?），略過本輪: {}", ex.toString());
            return;
        }
        for (PendingWalletCredit pending : due) {
            try {
                walletClient.credit(pending.getPlayerId(), pending.getAmount(), pending.getSubType(),
                        pending.getIdempotencyKey(), pending.getRoundId());
                pending.setStatus("DONE");
                pending.setDoneAt(LocalDateTime.now());
                repository.save(pending);
                log.info("[補償] 補償入帳成功 id={} gameType={} roundId={} playerId={} amount={} idemKey={} (第 {} 次重試)",
                        pending.getId(), pending.getGameType(), pending.getRoundId(), pending.getPlayerId(),
                        pending.getAmount(), pending.getIdempotencyKey(), pending.getRetryCount() + 1);
            } catch (Exception ex) {
                // 單筆失敗不可中斷整批：更新退避後繼續處理下一筆
                markFailure(pending, ex);
            }
        }
    }

    private void markFailure(PendingWalletCredit pending, Exception ex) {
        int retries = pending.getRetryCount() + 1;
        pending.setRetryCount(retries);
        pending.setLastError(WalletCompensationService.truncateError(ex));
        if (retries >= MAX_RETRIES) {
            pending.setStatus("FAILED");
            log.error("[補償] 重試 {} 次仍失敗，標記 FAILED（需人工對帳）id={} gameType={} roundId={} playerId={} amount={} idemKey={}",
                    retries, pending.getId(), pending.getGameType(), pending.getRoundId(),
                    pending.getPlayerId(), pending.getAmount(), pending.getIdempotencyKey(), ex);
        } else {
            pending.setNextRetryAt(LocalDateTime.now().plusSeconds(backoffSeconds(retries)));
            log.warn("[補償] 補償入帳失敗（第 {} 次），{} 秒後重試 id={} idemKey={}: {}",
                    retries, backoffSeconds(retries), pending.getId(), pending.getIdempotencyKey(), ex.toString());
        }
        try {
            repository.save(pending);
        } catch (Exception saveEx) {
            // 連退避狀態都存不進去（DB 也故障）：留在原狀態，下一輪重撈時再處理
            log.error("[補償] 補償單狀態更新失敗 id={}", pending.getId(), saveEx);
        }
    }

    /** 指數退避（秒）：第 n 次失敗後等 30 * 2^(n-1) 秒，上限 {@value #MAX_BACKOFF_SECONDS} 秒。 */
    static long backoffSeconds(int retryCount) {
        long delay = BASE_BACKOFF_SECONDS << Math.min(retryCount - 1, 20);
        return Math.min(delay, MAX_BACKOFF_SECONDS);
    }
}
