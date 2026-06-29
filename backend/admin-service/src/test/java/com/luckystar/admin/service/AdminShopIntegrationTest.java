package com.luckystar.admin.service;

import com.luckystar.admin.dto.ShopItemRequest;
import com.luckystar.admin.dto.ShopItemUpdateRequest;
import com.luckystar.admin.dto.ShopItemView;
import com.luckystar.admin.mysql.entity.ShopItem;
import com.luckystar.admin.mysql.repository.ShopItemRepository;
import com.luckystar.admin.postgres.entity.AdminActionLog;
import com.luckystar.admin.postgres.repository.AdminActionLogRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 後台商城目錄「真實雙資料源」整合測試（@SpringBootTest + H2 雙庫）。
 *
 * <p>驗證 {@link AdminShopService} 實際把 {@code shop_items} 寫入 MySQL（@Primary）、
 * 並把稽核寫入 PostgreSQL 的 {@code admin_action_logs}（跨資料源、不同 transaction manager）。
 * 補足 {@link AdminShopServiceTest}（Mockito）未涵蓋的實體 DDL 與跨庫稽核接線。
 */
@SpringBootTest
class AdminShopIntegrationTest {

    @Autowired AdminShopService adminShopService;
    @Autowired ShopItemRepository shopItemRepository;          // MySQL
    @Autowired AdminActionLogRepository actionLogRepository;   // PostgreSQL

    @BeforeEach
    void setUp() {
        shopItemRepository.deleteAll();
        actionLogRepository.deleteAll();
    }

    private ShopItemRequest req() {
        return new ShopItemRequest("vip-ticket", "VIP 入場券", "說明", 12000L, "shopPrizeA", 1, true);
    }

    @Test
    void create_persistsItemToMysqlAndAuditToPostgres() {
        ShopItemView view = adminShopService.create("admin1", req());

        assertThat(view.itemCode()).isEqualTo("vip-ticket");

        // 商品真的寫進 MySQL
        List<ShopItem> items = shopItemRepository.findAll();
        assertThat(items).hasSize(1);
        assertThat(items.get(0).getCostStar()).isEqualTo(12000L);
        assertThat(items.get(0).isActive()).isTrue();
        assertThat(items.get(0).getCreatedAt()).isNotNull();

        // 稽核真的寫進 PostgreSQL（跨資料源）
        List<AdminActionLog> logs = actionLogRepository.findAll();
        assertThat(logs).hasSize(1);
        assertThat(logs.get(0).getActionType()).isEqualTo("SHOP_ITEM_CREATE");
        assertThat(logs.get(0).getOperator()).isEqualTo("admin1");
    }

    @Test
    void update_changesPriceAndStatus() {
        adminShopService.create("admin1", req());
        Long id = shopItemRepository.findAll().get(0).getId();

        adminShopService.update("admin1", id,
                new ShopItemUpdateRequest(null, null, 9999L, null, null, false));

        ShopItem updated = shopItemRepository.findById(id).orElseThrow();
        assertThat(updated.getCostStar()).isEqualTo(9999L);
        assertThat(updated.isActive()).isFalse();
        assertThat(updated.getName()).isEqualTo("VIP 入場券"); // 未帶 → 不變

        // 建立 + 更新各一筆稽核
        assertThat(actionLogRepository.findAll()).hasSize(2);
    }

    @Test
    void create_duplicateCode_throwsConflict() {
        adminShopService.create("admin1", req());

        assertThatThrownBy(() -> adminShopService.create("admin1", req()))
                .isInstanceOf(ResponseStatusException.class)
                .satisfies(ex -> assertThat(((ResponseStatusException) ex).getStatusCode())
                        .isEqualTo(HttpStatus.CONFLICT));

        assertThat(shopItemRepository.findAll()).hasSize(1);
    }
}
