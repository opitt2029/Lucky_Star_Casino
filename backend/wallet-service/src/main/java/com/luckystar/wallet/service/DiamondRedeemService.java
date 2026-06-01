package com.luckystar.wallet.service;

import com.luckystar.wallet.dto.DiamondRedeemResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

/**
 * 點數卡兌換鑽石協調器（T-102）。對應 {@code POST /api/v1/wallet/diamond/redeem}。
 *
 * <p>兌換是跨資料源操作：序號狀態在 MySQL（{@code diamond_cards}），鑽石餘額在 PostgreSQL
 * （{@code diamond_wallets}）。比照 {@link GiftService} 的取捨——<b>刻意不引入 XA/JTA</b>，改以
 * 「先標記、再入帳、入帳失敗則補償回滾序號」的流程串接兩個各自獨立 commit 的交易：
 * <ol>
 *   <li><b>序號 CAS 標記</b>（{@link DiamondCardService#redeemCard}，MySQL 交易）：原子地把序號標記為已兌換並取得面額。
 *       這是防重複兌換的關卡——序號不存在 → 404；已兌換或並發落敗 → 422。<b>先做</b>，確保「序號被消耗」這件事
 *       在入帳前定案，避免同卡多次入帳。</li>
 *   <li><b>鑽石入帳</b>（{@link DiamondWalletService#creditDiamond}，PostgreSQL 交易）：把面額加進鑽石餘額。
 *       錢包不存在 → 404；樂觀鎖衝突 → 409。</li>
 *   <li><b>補償</b>：若入帳拋例外，回滾序號標記（{@link DiamondCardService#revertRedemption}）讓玩家能重試，
 *       再把原始例外往外拋。</li>
 * </ol>
 *
 * <h3>已知限制</h3>
 * 補償回滾本身是 best-effort：若「序號已標記、入帳失敗、補償回滾又失敗」（例如 MySQL 此刻不可用），序號會卡在
 * 已兌換而玩家未得鑽石，需人工介入（已記 ERROR log）。此窗口極窄，且永遠偏向「不重複入帳」的安全側。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class DiamondRedeemService {

    private final DiamondCardService diamondCardService;
    private final DiamondWalletService diamondWalletService;

    public DiamondRedeemResponse redeem(Long playerId, String cardCode) {
        // Step 1: 序號 CAS 標記（MySQL 已 commit）——防重複兌換的關卡，先於入帳
        long faceValue = diamondCardService.redeemCard(cardCode, playerId);

        // Step 2: 鑽石入帳（PostgreSQL）；失敗則補償回滾序號標記後原樣往外拋
        long diamondBalance;
        try {
            diamondBalance = diamondWalletService.creditDiamond(playerId, faceValue);
        } catch (RuntimeException e) {
            log.warn("Diamond credit failed after card marked redeemed, compensating: cardCode={} playerId={}",
                    cardCode, playerId, e);
            diamondCardService.revertRedemption(cardCode);
            throw e;
        }

        return DiamondRedeemResponse.builder()
                .playerId(playerId)
                .cardCode(cardCode)
                .redeemedDiamonds(faceValue)
                .diamondBalance(diamondBalance)
                .build();
    }
}
