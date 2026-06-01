package com.luckystar.wallet.service;

import com.luckystar.wallet.exception.CardAlreadyRedeemedException;
import com.luckystar.wallet.exception.CardNotFoundException;
import com.luckystar.wallet.mysql.entity.DiamondCard;
import com.luckystar.wallet.mysql.repository.DiamondCardRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;

/**
 * 點數卡兌換的「序號標記」核心（T-102）。<b>只</b>負責 MySQL 端 {@code diamond_cards} 的狀態異動，
 * 是整個兌換流程裡「防止同一序號重複兌換」的關卡。鑽石餘額入帳在 PostgreSQL，由
 * {@link DiamondRedeemService} 在交易外協調（跨資料源，刻意不引入 XA）。
 *
 * <p>獨立成 bean 是為了讓 {@code @Transactional(mysqlTransactionManager)} proxy 生效——同類別內
 * self-invocation 不會套用交易（與 {@link GiftTransferService} 同理）。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class DiamondCardService {

    private final DiamondCardRepository diamondCardRepository;

    /**
     * 以條件式 UPDATE（CAS）原子地把序號標記為已兌換，回傳其面額。
     *
     * <p>先 SELECT 是為了區分「序號不存在」與「已被兌換」兩種錯誤好給出明確訊息；真正的防重複關卡是後面的
     * {@link DiamondCardRepository#markRedeemed} 條件式 UPDATE：即使 SELECT 與 UPDATE 之間有另一個並發兌換
     * 搶先，CAS 也只會讓一方的回傳列數為 1，落敗者得到 0 → 丟 {@link CardAlreadyRedeemedException}。
     *
     * @return 該序號面額（= 應入帳的鑽石數）
     * @throws CardNotFoundException        序號不存在 → 404
     * @throws CardAlreadyRedeemedException 序號已兌換，或並發 CAS 落敗 → 422
     */
    @Transactional(transactionManager = "mysqlTransactionManager")
    public long redeemCard(String cardCode, Long playerId) {
        DiamondCard card = diamondCardRepository.findByCardCode(cardCode)
                .orElseThrow(() -> new CardNotFoundException("Diamond card not found: " + cardCode));

        if (Boolean.TRUE.equals(card.getIsRedeemed())) {
            throw new CardAlreadyRedeemedException("Diamond card already redeemed: " + cardCode);
        }

        int updated = diamondCardRepository.markRedeemed(cardCode, playerId, LocalDateTime.now());
        if (updated == 0) {
            // SELECT 之後、UPDATE 之前被另一個並發兌換搶先 flip → CAS 落敗
            throw new CardAlreadyRedeemedException("Diamond card already redeemed: " + cardCode);
        }

        log.info("Diamond card redeemed: cardCode={} playerId={} faceValue={}",
                cardCode, playerId, card.getFaceValue());
        return card.getFaceValue();
    }

    /**
     * 補償：把先前標記成功的序號回復為未兌換。僅在序號已標記、但後續鑽石入帳失敗時呼叫，讓玩家能重試。
     * best-effort：回復失敗只記 ERROR（序號會卡在已兌換、玩家未得鑽石，需人工介入），不再往外拋以免遮蔽
     * 原始的入帳失敗例外。
     */
    @Transactional(transactionManager = "mysqlTransactionManager")
    public void revertRedemption(String cardCode) {
        try {
            int reverted = diamondCardRepository.revertRedemption(cardCode);
            if (reverted == 0) {
                log.error("Compensation no-op: diamond card not in redeemed state, cardCode={}", cardCode);
            } else {
                log.warn("Diamond card redemption reverted after credit failure: cardCode={}", cardCode);
            }
        } catch (Exception e) {
            log.error("Failed to revert diamond card redemption, manual intervention needed: cardCode={}",
                    cardCode, e);
        }
    }
}
