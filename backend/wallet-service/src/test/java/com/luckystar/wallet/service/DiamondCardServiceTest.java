package com.luckystar.wallet.service;

import com.luckystar.wallet.exception.CardAlreadyRedeemedException;
import com.luckystar.wallet.exception.CardNotFoundException;
import com.luckystar.wallet.mysql.entity.DiamondCard;
import com.luckystar.wallet.mysql.repository.DiamondCardRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDateTime;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class DiamondCardServiceTest {

    @Mock
    DiamondCardRepository diamondCardRepository;

    @InjectMocks
    DiamondCardService diamondCardService;

    private static DiamondCard card(String code, long faceValue, boolean redeemed) {
        return DiamondCard.builder()
                .id(1L)
                .cardCode(code)
                .faceValue(faceValue)
                .isRedeemed(redeemed)
                .build();
    }

    @Test
    void redeemCard_validUnredeemed_marksAndReturnsFaceValue() {
        when(diamondCardRepository.findByCardCode("CODE-1"))
                .thenReturn(Optional.of(card("CODE-1", 500L, false)));
        when(diamondCardRepository.markRedeemed(eq("CODE-1"), eq(42L), any(LocalDateTime.class)))
                .thenReturn(1);

        long faceValue = diamondCardService.redeemCard("CODE-1", 42L);

        assertThat(faceValue).isEqualTo(500L);
        verify(diamondCardRepository).markRedeemed(eq("CODE-1"), eq(42L), any(LocalDateTime.class));
    }

    @Test
    void redeemCard_notFound_throwsCardNotFoundAndDoesNotMark() {
        when(diamondCardRepository.findByCardCode("NOPE")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> diamondCardService.redeemCard("NOPE", 42L))
                .isInstanceOf(CardNotFoundException.class);

        verify(diamondCardRepository, never()).markRedeemed(any(), any(), any());
    }

    @Test
    void redeemCard_alreadyRedeemedFlag_throwsAndDoesNotMark() {
        when(diamondCardRepository.findByCardCode("USED"))
                .thenReturn(Optional.of(card("USED", 500L, true)));

        assertThatThrownBy(() -> diamondCardService.redeemCard("USED", 42L))
                .isInstanceOf(CardAlreadyRedeemedException.class);

        verify(diamondCardRepository, never()).markRedeemed(any(), any(), any());
    }

    @Test
    void redeemCard_concurrentCasLoses_throwsCardAlreadyRedeemed() {
        // SELECT 看到未兌換，但 CAS UPDATE 落敗（另一並發兌換搶先 flip）→ 回傳 0 列
        when(diamondCardRepository.findByCardCode("RACE"))
                .thenReturn(Optional.of(card("RACE", 500L, false)));
        when(diamondCardRepository.markRedeemed(eq("RACE"), eq(42L), any(LocalDateTime.class)))
                .thenReturn(0);

        assertThatThrownBy(() -> diamondCardService.redeemCard("RACE", 42L))
                .isInstanceOf(CardAlreadyRedeemedException.class);
    }

    @Test
    void revertRedemption_swallowsExceptions() {
        when(diamondCardRepository.revertRedemption("BOOM"))
                .thenThrow(new RuntimeException("mysql down"));

        // 補償 best-effort：不得往外拋，以免遮蔽原始入帳失敗例外
        diamondCardService.revertRedemption("BOOM");

        verify(diamondCardRepository).revertRedemption("BOOM");
    }
}
