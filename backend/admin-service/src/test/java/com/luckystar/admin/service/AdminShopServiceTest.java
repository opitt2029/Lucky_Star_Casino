package com.luckystar.admin.service;

import com.luckystar.admin.dto.ShopItemRequest;
import com.luckystar.admin.dto.ShopItemUpdateRequest;
import com.luckystar.admin.dto.ShopItemView;
import com.luckystar.admin.mysql.entity.ShopItem;
import com.luckystar.admin.mysql.repository.ShopItemRepository;
import com.luckystar.admin.postgres.entity.AdminActionLog;
import com.luckystar.admin.postgres.repository.AdminActionLogRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 後台商城目錄管理單元測試（Mockito）。
 */
@ExtendWith(MockitoExtension.class)
class AdminShopServiceTest {

    @Mock ShopItemRepository shopItemRepository;
    @Mock AdminActionLogRepository actionLogRepository;

    @InjectMocks AdminShopService adminShopService;

    private ShopItemRequest createReq() {
        return new ShopItemRequest("vip-ticket", "VIP 入場券", "說明", 12000L, "shopPrizeA", 1, true);
    }

    @Test
    void create_success_savesItemAndWritesAudit() {
        when(shopItemRepository.existsByItemCode("vip-ticket")).thenReturn(false);
        when(shopItemRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        ShopItemView view = adminShopService.create("admin1", createReq());

        assertThat(view.itemCode()).isEqualTo("vip-ticket");
        assertThat(view.costStar()).isEqualTo(12000L);
        assertThat(view.active()).isTrue();
        verify(shopItemRepository).save(any(ShopItem.class));
        verify(actionLogRepository, times(1)).save(any(AdminActionLog.class));
    }

    @Test
    void create_auditWriteFails_throwsAndRollsBack() {
        // 稽核不再 best-effort：與商品變更強一致，寫不進去則整筆失敗（→ 500）。
        // save 雖已被呼叫，但真實 mysql 交易會隨此例外 rollback（@Transactional 保證，mock 不觀察 rollback）。
        when(shopItemRepository.existsByItemCode("vip-ticket")).thenReturn(false);
        when(shopItemRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));
        when(actionLogRepository.save(any())).thenThrow(new RuntimeException("db down"));

        assertThatThrownBy(() -> adminShopService.create("admin1", createReq()))
                .isInstanceOf(RuntimeException.class)
                .hasMessage("db down");
    }

    @Test
    void create_duplicateCode_throwsConflict() {
        when(shopItemRepository.existsByItemCode("vip-ticket")).thenReturn(true);

        assertThatThrownBy(() -> adminShopService.create("admin1", createReq()))
                .isInstanceOf(ResponseStatusException.class)
                .satisfies(ex -> assertThat(((ResponseStatusException) ex).getStatusCode())
                        .isEqualTo(HttpStatus.CONFLICT));

        verify(shopItemRepository, never()).save(any());
    }

    @Test
    void update_partial_changesOnlyProvidedFields() {
        ShopItem existing = new ShopItem();
        existing.setItemCode("vip-ticket");
        existing.setName("VIP 入場券");
        existing.setCostStar(12000L);
        existing.setSortOrder(1);
        existing.setActive(true);
        when(shopItemRepository.findById(1L)).thenReturn(Optional.of(existing));
        when(shopItemRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        // 只改價並下架，其餘 null 不動
        ShopItemUpdateRequest req =
                new ShopItemUpdateRequest(null, null, 9999L, null, null, false);
        ShopItemView view = adminShopService.update("admin1", 1L, req);

        assertThat(view.costStar()).isEqualTo(9999L);
        assertThat(view.active()).isFalse();
        assertThat(view.name()).isEqualTo("VIP 入場券"); // 未帶 → 不變
        verify(actionLogRepository, times(1)).save(any(AdminActionLog.class));
    }

    @Test
    void update_notFound_throws404() {
        when(shopItemRepository.findById(99L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> adminShopService.update("admin1", 99L,
                new ShopItemUpdateRequest(null, null, 1L, null, null, null)))
                .isInstanceOf(ResponseStatusException.class)
                .satisfies(ex -> assertThat(((ResponseStatusException) ex).getStatusCode())
                        .isEqualTo(HttpStatus.NOT_FOUND));

        verify(shopItemRepository, never()).save(any());
    }
}
