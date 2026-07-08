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
 * <p>稽核為<b>強一致</b>（非 best-effort）：商品（MySQL）與稽核（PostgreSQL）跨資料源、無 2PC，
 * 但稽核在 mysql 交易 commit <b>之前</b>寫入，故稽核寫入失敗會拋出、連同商品變更一起 rollback
 * ——「稽核寫不進去就不改目錄」，與 DiamondCardService 一致。殘留邊界：稽核先 commit 後 mysql
 * commit 才失敗的窄窗會留下孤兒稽核（過度記錄，安全方向），此為雙資料源無分散式交易的先天限制。
 * 取捨：目錄編輯屬低風險操作，代價是稽核庫短暫不可用時目錄也改不了，換取稽核政策全後台一致。
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

    /** 稽核：寫一筆 admin_action_logs（PostgreSQL）。與商品變更強一致，寫入失敗直接拋（觸發 mysql rollback），不再 best-effort。 */
    private void writeAudit(String operator, String actionType, Long amount, String reason) {
        String idempotencyKey = "shop-" + actionType + "-" + UUID.randomUUID();
        actionLogRepository.save(new AdminActionLog(
                operator, actionType, null, amount, reason, idempotencyKey));
    }
}
