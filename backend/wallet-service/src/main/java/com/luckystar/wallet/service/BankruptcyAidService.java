package com.luckystar.wallet.service;

import com.luckystar.wallet.dto.BankruptcyAidResponse;
import com.luckystar.wallet.dto.CreditRequest;
import com.luckystar.wallet.dto.CreditResponse;
import com.luckystar.wallet.dto.WalletBalanceResponse;
import com.luckystar.wallet.exception.BankruptcyAidNotEligibleException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.ZoneId;
import java.time.ZonedDateTime;

/**
 * 破產補助協調器（T-027）。對應 {@code POST /api/v1/wallet/bankruptcy-aid}。
 *
 * <p>當玩家「破產」（餘額低於 {@value #BALANCE_THRESHOLD}）且當日尚未領取時，發放
 * {@value #AID_AMOUNT} 星幣救濟。每位玩家每天只能領一次，當日狀態記在 Redis、TTL 到當地午夜。
 *
 * <h3>流程</h3>
 * <ol>
 *   <li><b>資格檢查</b>：載入錢包餘額（{@link WalletService#getBalance}，錢包不存在 → 404），
 *       以<b>總餘額</b>（非可用餘額）判定，≥ 門檻則拒絕（{@link BankruptcyAidNotEligibleException} → 422）。
 *       採總餘額的理由見 {@link #BALANCE_THRESHOLD}。</li>
 *   <li><b>Redis 當日鎖（SETNX）</b>：以 {@code SET key 1 NX} 搶當日領取權；搶不到代表今天已領過 → 422。
 *       搶到後設 TTL 到當地午夜。</li>
 *   <li><b>入帳</b>：委派 {@link WalletService#credit} 加 {@value #AID_AMOUNT}，subType=BANKRUPTCY_AID，
 *       冪等鍵 {@code bankruptcy-aid:{playerId}:{date}}（DB 層第二道防線：即使 Redis 被清空，
 *       同日仍不會重複入帳）。入帳失敗會釋放 Redis 鎖讓玩家可重試。</li>
 *   <li><b>冪等命中保護</b>：若 credit 回傳 idempotent=true（Redis 曾被清空、但 DB 已有當日紀錄），
 *       視為今天已領過 → 422（不重複加錢、保留 Redis 鎖）。</li>
 * </ol>
 *
 * <h3>並發</h3>
 * 兩個同時請求都通過資格檢查時，Redis SETNX 只有一個會成功，另一個拿到 422；即使兩者都越過 Redis
 * （例如 Redis 短暫不可用），credit 的 idempotencyKey UNIQUE 仍保證當日只入帳一次。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class BankruptcyAidService {

    /**
     * 餘額低於此門檻（星幣）才符合補助資格。
     *
     * <p><b>用「總餘額」而非「可用餘額」判定，是刻意的設計決策</b>：
     * <ul>
     *   <li><b>防套利</b>：可用餘額 = 總餘額 − 凍結金額；若以可用餘額判定，玩家可把錢凍結在未結算的
     *       下注上，把可用餘額壓低來騙取補助，實際身家不少。總餘額無法被這樣操弄。</li>
     *   <li><b>語意正確</b>：凍結金額來自進行中的下注（結算後返還或本就投入遊戲），「總身家枯竭」才是
     *       真正破產，與規格「餘額 &lt; 100」一致。</li>
     * </ul>
     */
    static final long BALANCE_THRESHOLD = 100L;

    /** 每次補助發放金額（星幣）。 */
    static final long AID_AMOUNT = 1_000L;

    /** 帳務子類型，須在 wallet_transactions chk_wt_sub_type 允許清單內。 */
    private static final String SUB_TYPE = "BANKRUPTCY_AID";

    /** 當日界線以當地（台北）為準，Redis 鎖 TTL 重置在當地午夜。 */
    private static final ZoneId ZONE = ZoneId.of("Asia/Taipei");

    private final WalletService walletService;
    private final StringRedisTemplate redisTemplate;

    public BankruptcyAidResponse claim(Long playerId) {
        // Step 1: 資格檢查 —— 以「總餘額」判定須低於門檻（理由見 BALANCE_THRESHOLD：防凍結套利 + 語意正確）。
        // 錢包不存在會在 getBalance 丟 WalletNotFoundException → 404。
        WalletBalanceResponse wallet = walletService.getBalance(playerId);
        if (wallet.getBalance() >= BALANCE_THRESHOLD) {
            throw new BankruptcyAidNotEligibleException(
                    "Balance not below threshold (" + BALANCE_THRESHOLD + "), not eligible for bankruptcy aid");
        }

        // Step 2: Redis 當日鎖 —— 單一原子指令 SET key 1 NX PX(到午夜)，搶不到代表今天已領過。
        // 用「SETNX + TTL 一次完成」避免兩步之間程序被硬殺時鎖殘留卻無 TTL（→ 該玩家當天再也領不了）。
        ZonedDateTime now = ZonedDateTime.now(ZONE);
        String date = now.toLocalDate().toString();
        String claimKey = "wallet:bankruptcy-aid:" + playerId + ":" + date;
        Duration ttl = Duration.between(now, now.toLocalDate().plusDays(1).atStartOfDay(ZONE));
        Boolean acquired = redisTemplate.opsForValue().setIfAbsent(claimKey, "1", ttl);
        if (!Boolean.TRUE.equals(acquired)) {
            throw new BankruptcyAidNotEligibleException("Bankruptcy aid already claimed today");
        }

        // Step 3: 入帳；失敗釋放 Redis 鎖讓玩家可重試
        CreditResponse credit;
        try {
            CreditRequest req = new CreditRequest();
            req.setPlayerId(playerId);
            req.setAmount(AID_AMOUNT);
            req.setSubType(SUB_TYPE);
            req.setIdempotencyKey("bankruptcy-aid:" + playerId + ":" + date);
            credit = walletService.credit(req);
        } catch (RuntimeException e) {
            releaseClaim(claimKey);
            throw e;
        }

        // Step 4: 冪等命中保護 —— DB 已有當日紀錄（Redis 必曾被清空），視為今天已領過，不重複加錢、保留鎖
        if (credit.isIdempotent()) {
            throw new BankruptcyAidNotEligibleException("Bankruptcy aid already claimed today");
        }

        return BankruptcyAidResponse.builder()
                .playerId(playerId)
                .amount(AID_AMOUNT)
                .transactionId(credit.getTransactionId())
                .balanceBefore(credit.getBalanceBefore())
                .balanceAfter(credit.getBalanceAfter())
                .build();
    }

    /** 釋放當日鎖（入帳失敗時）。失敗只記 WARN：鍵仍有午夜 TTL 會自動到期。 */
    private void releaseClaim(String key) {
        try {
            redisTemplate.delete(key);
        } catch (Exception e) {
            log.warn("Failed to release bankruptcy-aid claim key={}", key, e);
        }
    }
}
