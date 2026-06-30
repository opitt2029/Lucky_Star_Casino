package com.luckystar.wallet.service;

import com.luckystar.wallet.dto.DebitRequest;
import com.luckystar.wallet.dto.DebitResponse;
import com.luckystar.wallet.dto.ShopInventoryItem;
import com.luckystar.wallet.dto.ShopItemView;
import com.luckystar.wallet.dto.ShopRedeemResponse;
import com.luckystar.wallet.mysql.entity.ShopItem;
import com.luckystar.wallet.postgres.entity.ShopRedemption;
import com.luckystar.wallet.postgres.repository.ShopRedemptionRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

/**
 * 禮品商城兌換（玩家端核心，ADR-006）。
 *
 * <p>兌換＝在<b>單一 Postgres 交易</b>內原子完成：
 * <ol>
 *   <li>{@link WalletService#debit(DebitRequest)} 扣星幣（sub_type=SHOP_PURCHASE，冪等＋樂觀鎖，發 wallet.debit 事件）；</li>
 *   <li>寫 {@code shop_redemptions} 兌換紀錄（＝帳務真相＋玩家背包來源）。</li>
 * </ol>
 * 兩者都走 {@code postgresTransactionManager}，透過 {@code @Transactional} 預設 REQUIRED 傳播join 同一交易，
 * 失敗一起回滾。商品目錄在 MySQL，由 {@link ShopCatalogService}（另一個 bean，mysql 交易）讀取——
 * 與鑽石點數卡兌換（{@link DiamondRedeemService}）相同的「跨資料源拆 bean」設計。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ShopRedemptionService {

    private final ShopCatalogService shopCatalogService;
    private final WalletService walletService;
    private final ShopRedemptionRepository shopRedemptionRepository;

    /** 玩家端目錄（委派 MySQL 讀端）。 */
    public List<ShopItemView> getCatalog() {
        return shopCatalogService.getCatalog();
    }

    /**
     * 兌換禮品。本方法是 Postgres 交易入口（由 controller 經 proxy 呼叫，{@code @Transactional} 生效）；
     * 內部呼叫 {@link ShopCatalogService}（mysql 交易）讀目錄、{@link WalletService#debit}（postgres，join 本交易）扣款。
     *
     * @param clientKey 選填 client 冪等鍵；不帶則伺服器產生一次性 UUID（允許重複購買同款商品）。
     */
    @Transactional(transactionManager = "postgresTransactionManager")
    public ShopRedeemResponse redeem(Long playerId, String itemCode, String clientKey) {
        ShopItem item = shopCatalogService.findActiveOrThrow(itemCode);

        String idemKey = buildIdempotencyKey(playerId, clientKey);

        // Step 1: 扣星幣（冪等：同一鍵已扣過會回 idempotent=true，不重複扣款）
        DebitRequest debitReq = new DebitRequest();
        debitReq.setPlayerId(playerId);
        debitReq.setAmount(item.getCostStar());
        debitReq.setSubType("SHOP_PURCHASE");
        debitReq.setIdempotencyKey(idemKey);
        debitReq.setReferenceId(item.getItemCode());
        DebitResponse debit = walletService.debit(debitReq);

        // Step 2: 冪等命中（這把鍵先前已兌換過）→ 回先前的兌換紀錄，不重寫
        if (debit.isIdempotent()) {
            return shopRedemptionRepository.findByIdempotencyKey(idemKey)
                    .map(prev -> toResponse(prev, true))
                    .orElseGet(() -> ShopRedeemResponse.builder()
                            .itemCode(item.getItemCode())
                            .itemName(item.getName())
                            .starSpent(item.getCostStar())
                            .balanceAfter(debit.getBalanceAfter())
                            .idempotent(true)
                            .build());
        }

        // Step 3: 寫兌換紀錄（與扣款同一 Postgres 交易，原子）
        ShopRedemption redemption = ShopRedemption.builder()
                .playerId(playerId)
                .itemCode(item.getItemCode())
                .itemName(item.getName())
                .starSpent(item.getCostStar())
                .balanceBefore(debit.getBalanceBefore())
                .balanceAfter(debit.getBalanceAfter())
                .idempotencyKey(idemKey)
                .status("COMPLETED")
                .build();
        ShopRedemption saved = shopRedemptionRepository.save(redemption);

        log.info("shop redemption completed playerId={} itemCode={} starSpent={} balanceAfter={}",
                playerId, item.getItemCode(), item.getCostStar(), debit.getBalanceAfter());

        return toResponse(saved, false);
    }

    /** 玩家背包/兌換履歷（讀 Postgres 兌換紀錄）。 */
    @Transactional(transactionManager = "postgresTransactionManager", readOnly = true)
    public List<ShopInventoryItem> getInventory(Long playerId) {
        return shopRedemptionRepository.findByPlayerIdOrderByCreatedAtDesc(playerId)
                .stream()
                .map(ShopInventoryItem::from)
                .toList();
    }

    private String buildIdempotencyKey(Long playerId, String clientKey) {
        String suffix = (clientKey != null && !clientKey.isBlank())
                ? clientKey.trim()
                : UUID.randomUUID().toString();
        return "shop-redeem:" + playerId + ":" + suffix;
    }

    private ShopRedeemResponse toResponse(ShopRedemption r, boolean idempotent) {
        return ShopRedeemResponse.builder()
                .itemCode(r.getItemCode())
                .itemName(r.getItemName())
                .starSpent(r.getStarSpent())
                .balanceAfter(r.getBalanceAfter())
                .idempotent(idempotent)
                .build();
    }
}
