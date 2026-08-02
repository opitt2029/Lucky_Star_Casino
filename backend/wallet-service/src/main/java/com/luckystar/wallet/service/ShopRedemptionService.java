package com.luckystar.wallet.service;

import com.luckystar.wallet.dto.DebitRequest;
import com.luckystar.wallet.dto.DebitResponse;
import com.luckystar.wallet.dto.ShopInventoryItem;
import com.luckystar.wallet.dto.ShopItemView;
import com.luckystar.wallet.dto.ShopRedeemResponse;
import com.luckystar.wallet.dto.ShopUseResponse;
import com.luckystar.wallet.exception.ShopInventoryItemAlreadyUsedException;
import com.luckystar.wallet.exception.ShopInventoryItemNotFoundException;
import com.luckystar.wallet.mysql.entity.ShopItem;
import com.luckystar.wallet.postgres.entity.ShopRedemption;
import com.luckystar.wallet.postgres.repository.ShopRedemptionRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/** Coordinates shop catalog reads, redemptions, and player inventory actions. */
@Slf4j
@Service
@RequiredArgsConstructor
public class ShopRedemptionService {

    private static final Set<String> EQUIPPABLE_ITEM_CODES = Set.of(
            "avatar-frame",
            "royal-nameplate",
            "star-title-badge",
            "profile-backdrop",
            "coin-rain-entry"
    );

    private final ShopCatalogService shopCatalogService;
    private final WalletService walletService;
    private final ShopRedemptionRepository shopRedemptionRepository;

    public List<ShopItemView> getCatalog() {
        return shopCatalogService.getCatalog();
    }

    @Transactional(transactionManager = "postgresTransactionManager")
    public ShopRedeemResponse redeem(Long playerId, String itemCode, String clientKey) {
        ShopItem item = shopCatalogService.findActiveOrThrow(itemCode);

        String idemKey = buildIdempotencyKey(playerId, clientKey);

        DebitRequest debitReq = new DebitRequest();
        debitReq.setPlayerId(playerId);
        debitReq.setAmount(item.getCostStar());
        debitReq.setSubType("SHOP_PURCHASE");
        debitReq.setIdempotencyKey(idemKey);
        debitReq.setReferenceId(item.getItemCode());
        DebitResponse debit = walletService.debit(debitReq);

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

    @Transactional(transactionManager = "postgresTransactionManager", readOnly = true)
    public List<ShopInventoryItem> getInventory(Long playerId) {
        return shopRedemptionRepository.findByPlayerIdOrderByCreatedAtDesc(playerId)
                .stream()
                .map(ShopInventoryItem::from)
                .toList();
    }

    @Transactional(transactionManager = "postgresTransactionManager")
    public ShopUseResponse useInventoryItem(Long playerId, Long redemptionId) {
        ShopRedemption redemption = shopRedemptionRepository.findByIdAndPlayerId(redemptionId, playerId)
                .orElseThrow(() -> new ShopInventoryItemNotFoundException("Inventory item not found: " + redemptionId));

        String status = redemption.getStatus();
        if ("USED".equals(status)) {
            throw new ShopInventoryItemAlreadyUsedException("Inventory item already used: " + redemptionId);
        }
        if ("EQUIPPED".equals(status)) {
            return ShopUseResponse.from(redemption, "EQUIPPED");
        }
        if (!"COMPLETED".equals(status)) {
            throw new ShopInventoryItemAlreadyUsedException("Inventory item is not usable in status: " + status);
        }

        LocalDateTime now = LocalDateTime.now();
        String action;
        if (EQUIPPABLE_ITEM_CODES.contains(redemption.getItemCode())) {
            redemption.setStatus("EQUIPPED");
            redemption.setEquippedAt(now);
            action = "EQUIPPED";
        } else {
            redemption.setStatus("USED");
            redemption.setUsedAt(now);
            action = "USED";
        }

        ShopRedemption saved = shopRedemptionRepository.save(redemption);
        return ShopUseResponse.from(saved, action);
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
