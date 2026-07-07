package com.luckystar.game.compensation;

import java.time.LocalDateTime;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * game→wallet 最小 Saga 補償：credit 失敗時落補償單（ADR-009）。
 *
 * <p>{@link #recordPending} 給三個遊戲服務在「credit 失敗的 catch 區塊」內呼叫，兩個關鍵保證：
 * <ul>
 *   <li><b>REQUIRES_NEW 獨立交易</b>：補償單在自己的交易內提交。即使呼叫端的主流程交易
 *       之後 rollback（結算請求以 5xx 失敗），補償單仍已落地——這正是它存在的目的。</li>
 *   <li><b>絕不拋出例外</b>：本方法在 catch 區塊內執行，若自己再拋例外會遮蔽原始錯誤。
 *       連補償單都寫不進去（wallet 與 game DB 同時故障）時，只能 log.error 留人工對帳線索。</li>
 * </ul>
 *
 * <p>用 {@link TransactionTemplate}（程式化交易）而非 {@code @Transactional(REQUIRES_NEW)} 註解：
 * 註解版的例外會在 proxy 提交時才拋出、逃出我們的 try/catch，無法滿足「絕不拋出」；
 * template 版把「開交易→寫入→提交」整段包進同一個 try，提交失敗也接得住。
 *
 * <p><b>雷區 6</b>：補償重試只走 HTTP {@code WalletClient}（見 {@link WalletCompensationRetryJob}），
 * 絕不新增消費 {@code wallet.credit}/{@code wallet.debit} 事件回呼 credit/debit 的 listener。
 */
@Slf4j
@Service
public class WalletCompensationService {

    /** last_error 欄位長度上限（與 V14 schema 的 VARCHAR(500) 一致）。 */
    static final int MAX_ERROR_LENGTH = 500;

    private final PendingWalletCreditRepository repository;
    private final TransactionTemplate requiresNewTx;

    public WalletCompensationService(PendingWalletCreditRepository repository,
                                     PlatformTransactionManager transactionManager) {
        this.repository = repository;
        this.requiresNewTx = new TransactionTemplate(transactionManager);
        this.requiresNewTx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    /**
     * 落補償單（僅限 credit 失敗的 catch 區塊內呼叫；絕不拋出例外）。
     *
     * @param gameType       SLOT / BACCARAT / FISHING
     * @param roundId        對局 roundId 或捕魚 sessionId（重試時作為 credit 的 referenceId）
     * @param playerId       玩家 ID
     * @param amount         欠付金額（星幣）
     * @param subType        WIN（結算派彩）/ REFUND（退款、捕魚場次返還）
     * @param idempotencyKey 與剛剛失敗的 credit 呼叫完全相同的冪等鍵
     * @param cause          credit 失敗的原因（截斷存入 last_error）
     */
    public void recordPending(String gameType, String roundId, long playerId, long amount,
                              String subType, String idempotencyKey, Throwable cause) {
        try {
            requiresNewTx.executeWithoutResult(status -> {
                // 去重：同一冪等鍵已有補償單（例如玩家重試結算、同一 credit 再度失敗）就不重複建單
                if (repository.existsByIdempotencyKey(idempotencyKey)) {
                    log.info("[補償] 補償單已存在，跳過 idemKey={}", idempotencyKey);
                    return;
                }
                PendingWalletCredit pending = new PendingWalletCredit();
                pending.setGameType(gameType);
                pending.setRoundId(roundId);
                pending.setPlayerId(playerId);
                pending.setAmount(amount);
                pending.setSubType(subType);
                pending.setIdempotencyKey(idempotencyKey);
                pending.setStatus("PENDING");
                pending.setRetryCount(0);
                pending.setLastError(truncateError(cause));
                pending.setNextRetryAt(LocalDateTime.now());
                repository.save(pending);
                log.warn("[補償] credit 失敗已落補償單 gameType={} roundId={} playerId={} amount={} subType={} idemKey={}",
                        gameType, roundId, playerId, amount, subType, idempotencyKey);
            });
        } catch (Exception ex) {
            // 並發下 UNIQUE 撞鍵（另一請求已建單）在此也會被接住，等同已有補償單；
            // 其餘情況＝wallet 與 game DB 同時故障，補償單寫不進去，只剩 log 可供人工對帳。
            log.error("[補償] 補償單寫入失敗（需人工對帳）gameType={} roundId={} playerId={} amount={} subType={} idemKey={}",
                    gameType, roundId, playerId, amount, subType, idempotencyKey, ex);
        }
    }

    /** 截斷例外訊息至 last_error 欄位長度（VARCHAR(500)），避免超長訊息反過來害補償單寫入失敗。 */
    static String truncateError(Throwable cause) {
        if (cause == null) return null;
        String msg = cause.toString();
        return msg.length() <= MAX_ERROR_LENGTH ? msg : msg.substring(0, MAX_ERROR_LENGTH);
    }
}
