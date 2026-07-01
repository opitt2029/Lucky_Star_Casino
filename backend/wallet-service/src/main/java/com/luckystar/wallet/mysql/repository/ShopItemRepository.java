package com.luckystar.wallet.mysql.repository;

import com.luckystar.wallet.mysql.entity.ShopItem;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

/**
 * 商城目錄讀取（MySQL 讀端）。wallet-service 只讀：列上架商品、兌換時依 item_code 驗價。
 */
public interface ShopItemRepository extends JpaRepository<ShopItem, Long> {

    /** 上架商品，依 sort_order、id 排序（玩家端目錄）。 */
    List<ShopItem> findByActiveTrueOrderBySortOrderAscIdAsc();

    Optional<ShopItem> findByItemCode(String itemCode);
}
