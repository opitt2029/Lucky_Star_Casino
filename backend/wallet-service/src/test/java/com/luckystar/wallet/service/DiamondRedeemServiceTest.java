package com.luckystar.wallet.service;

import com.luckystar.wallet.dto.DiamondRedeemResponse;
import com.luckystar.wallet.exception.CardAlreadyRedeemedException;
import com.luckystar.wallet.exception.DiamondWalletNotFoundException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class DiamondRedeemServiceTest {

    @Mock
    DiamondCardService diamondCardService;

    @Mock
    DiamondWalletService diamondWalletService;

    @InjectMocks
    DiamondRedeemService diamondRedeemService;

    @Test
    void redeem_success_marksCardThenCreditsAndReturnsBalance() {
        when(diamondCardService.redeemCard("CODE-1", 42L)).thenReturn(500L);
        when(diamondWalletService.creditDiamond(42L, 500L)).thenReturn(1500L);

        DiamondRedeemResponse resp = diamondRedeemService.redeem(42L, "CODE-1");

        assertThat(resp.getPlayerId()).isEqualTo(42L);
        assertThat(resp.getCardCode()).isEqualTo("CODE-1");
        assertThat(resp.getRedeemedDiamonds()).isEqualTo(500L);
        assertThat(resp.getDiamondBalance()).isEqualTo(1500L);
        verify(diamondCardService, never()).revertRedemption(org.mockito.ArgumentMatchers.any());
    }

    @Test
    void redeem_creditFails_compensatesByRevertingCardAndRethrows() {
        when(diamondCardService.redeemCard("CODE-1", 42L)).thenReturn(500L);
        when(diamondWalletService.creditDiamond(42L, 500L))
                .thenThrow(new DiamondWalletNotFoundException("Diamond wallet not found for player: 42"));

        assertThatThrownBy(() -> diamondRedeemService.redeem(42L, "CODE-1"))
                .isInstanceOf(DiamondWalletNotFoundException.class);

        // 入帳失敗 → 補償回滾序號標記
        verify(diamondCardService).revertRedemption("CODE-1");
    }

    @Test
    void redeem_cardMarkFails_doesNotCreditNorCompensate() {
        when(diamondCardService.redeemCard("USED", 42L))
                .thenThrow(new CardAlreadyRedeemedException("Diamond card already redeemed: USED"));

        assertThatThrownBy(() -> diamondRedeemService.redeem(42L, "USED"))
                .isInstanceOf(CardAlreadyRedeemedException.class);

        verify(diamondWalletService, never()).creditDiamond(org.mockito.ArgumentMatchers.anyLong(),
                org.mockito.ArgumentMatchers.anyLong());
        verify(diamondCardService, never()).revertRedemption(org.mockito.ArgumentMatchers.any());
    }
}
