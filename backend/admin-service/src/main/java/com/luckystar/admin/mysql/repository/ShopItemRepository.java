package com.luckystar.admin.mysql.repository;

import com.luckystar.admin.mysql.entity.ShopItem;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * 商城目錄後台 CRUD（MySQL，admin 的 @Primary 源）。
 */
public interface ShopItemRepository extends JpaRepository<ShopItem, Long> {

    boolean existsByItemCode(String itemCode);
}
