package com.luckystar.admin.service;

import com.luckystar.admin.dto.ShopItemRequest;
import com.luckystar.admin.dto.ShopItemUpdateRequest;
import com.luckystar.admin.dto.ShopItemView;
import com.luckystar.admin.mysql.entity.ShopItem;
import com.luckystar.admin.mysql.repository.ShopItemRepository;
import com.luckystar.admin.postgres.entity.AdminActionLog;
import com.luckystar.admin.postgres.repository.AdminActionLogRepository;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * 禮品商城目錄後台管理（ADR-006）。寫入 MySQL {@code shop_items}（admin 的 @Primary 源），
 * 每次變更另落一筆 {@code admin_action_logs}（PostgreSQL）稽核——operator/動作/標的/金額。
 *
 * <p>稽核紀錄為 best-effort：稽核寫入失敗不應讓商品變更回滾（兩者跨資料源、各自交易），
 * 失敗僅記 WARN。商品變更本身的原子性由 mysqlTransactionManager 保證。
 */
@Service
public class AdminShopService {

    private static final Logger log = LoggerFactory.getLogger(AdminShopService.class);

    private final ShopItemRepository shopItemRepository;
    private final AdminActionLogRepository actionLogRepository;

    public AdminShopService(ShopItemRepository shopItemRepository,
                            AdminActionLogRepository actionLogRepository) {
        this.shopItemRepository = shopItemRepository;
        this.actionLogRepository = actionLogRepository;
    }

    @Transactional(transactionManager = "mysqlTransactionManager")
    public ShopItemView create(String operator, ShopItemRequest req) {
        if (shopItemRepository.existsByItemCode(req.itemCode())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Shop item code already exists: " + req.itemCode());
        }
        ShopItem item = new ShopItem();
        item.setItemCode(req.itemCode());
        item.setName(req.name());
        item.setCaption(req.caption());
        item.setCostStar(req.costStar());
        item.setAssetKey(req.assetKey());
        item.setSortOrder(req.sortOrder() != null ? req.sortOrder() : 0);
        item.setActive(req.active() == null || req.active());
        ShopItem saved = shopItemRepository.save(item);

        log.info("shop item created: operator={} itemCode={} cost={} active={}",
                operator, saved.getItemCode(), saved.getCostStar(), saved.isActive());
        writeAudit(operator, "SHOP_ITEM_CREATE", saved.getCostStar(),
                "create " + saved.getItemCode());
        return ShopItemView.from(saved);
    }

    @Transactional(transactionManager = "mysqlTransactionManager")
    public ShopItemView update(String operator, Long id, ShopItemUpdateRequest req) {
        ShopItem item = shopItemRepository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND,
                        "Shop item not found: " + id));

        if (req.name() != null) {
            item.setName(req.name());
        }
        if (req.caption() != null) {
            item.setCaption(req.caption());
        }
        if (req.costStar() != null) {
            item.setCostStar(req.costStar());
        }
        if (req.assetKey() != null) {
            item.setAssetKey(req.assetKey());
        }
        if (req.sortOrder() != null) {
            item.setSortOrder(req.sortOrder());
        }
        if (req.active() != null) {
            item.setActive(req.active());
        }
        ShopItem saved = shopItemRepository.save(item);

        log.info("shop item updated: operator={} itemCode={} cost={} active={}",
                operator, saved.getItemCode(), saved.getCostStar(), saved.isActive());
        writeAudit(operator, "SHOP_ITEM_UPDATE", saved.getCostStar(),
                "update " + saved.getItemCode());
        return ShopItemView.from(saved);
    }

    @Transactional(transactionManager = "mysqlTransactionManager", readOnly = true)
    public Page<ShopItemView> list(Pageable pageable) {
        return shopItemRepository.findAll(pageable).map(ShopItemView::from);
    }

    /** 稽核：寫一筆 admin_action_logs（PostgreSQL）。best-effort，失敗只記 WARN，不影響商品變更。 */
    private void writeAudit(String operator, String actionType, Long amount, String reason) {
        try {
            String idempotencyKey = "shop-" + actionType + "-" + UUID.randomUUID();
            actionLogRepository.save(new AdminActionLog(
                    operator, actionType, null, amount, reason, idempotencyKey));
        } catch (RuntimeException e) {
            log.warn("Failed to write admin_action_logs for {} by {}: {}",
                    actionType, operator, e.getMessage());
        }
    }
}
