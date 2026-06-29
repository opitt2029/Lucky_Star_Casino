package com.luckystar.wallet.service;

import com.luckystar.wallet.dto.ShopItemView;
import com.luckystar.wallet.exception.ShopItemNotFoundException;
import com.luckystar.wallet.exception.ShopItemUnavailableException;
import com.luckystar.wallet.mysql.entity.ShopItem;
import com.luckystar.wallet.mysql.repository.ShopItemRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * 商城目錄讀取（MySQL 讀端，ADR-001/ADR-006）。
 *
 * <p>刻意與 {@link ShopRedemptionService}（PostgreSQL 帳務寫端）分成兩個 bean：目錄讀走
 * {@code mysqlTransactionManager}、兌換扣款走 {@code postgresTransactionManager}。
 * 由獨立 bean 持有 {@code @Transactional}，兌換流程才能在「postgres 交易內」透過 proxy 呼叫本服務的
 * mysql 交易方法（自我呼叫會讓 {@code @Transactional} 失效，故不可合併在同一個 bean）。
 */
@Service
@RequiredArgsConstructor
public class ShopCatalogService {

    private final ShopItemRepository shopItemRepository;

    /** 玩家端目錄：上架商品依顯示順序排序。 */
    @Transactional(transactionManager = "mysqlTransactionManager", readOnly = true)
    public List<ShopItemView> getCatalog() {
        return shopItemRepository.findByActiveTrueOrderBySortOrderAscIdAsc()
                .stream()
                .map(ShopItemView::from)
                .toList();
    }

    /**
     * 兌換前取商品並驗證：不存在 → {@link ShopItemNotFoundException}(404)、已下架 →
     * {@link ShopItemUnavailableException}(422)。
     */
    @Transactional(transactionManager = "mysqlTransactionManager", readOnly = true)
    public ShopItem findActiveOrThrow(String itemCode) {
        ShopItem item = shopItemRepository.findByItemCode(itemCode)
                .orElseThrow(() -> new ShopItemNotFoundException("Shop item not found: " + itemCode));
        if (!Boolean.TRUE.equals(item.getActive())) {
            throw new ShopItemUnavailableException("Shop item is not available: " + itemCode);
        }
        return item;
    }
}
