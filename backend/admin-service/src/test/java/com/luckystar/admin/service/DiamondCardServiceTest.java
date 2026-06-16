package com.luckystar.admin.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.luckystar.admin.dto.CardStatusFilter;
import com.luckystar.admin.dto.GenerateCardsResponse;
import com.luckystar.admin.mysql.entity.DiamondCard;
import com.luckystar.admin.mysql.repository.DiamondCardRepository;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;

@ExtendWith(MockitoExtension.class)
class DiamondCardServiceTest {

    @Mock
    DiamondCardRepository diamondCardRepository;

    DiamondCardService service;

    @BeforeEach
    void setUp() {
        service = new DiamondCardService(diamondCardRepository);
    }

    @Test
    @SuppressWarnings({"rawtypes", "unchecked"})
    void generateCards_producesRequestedCountOfUniqueFormattedCodes() {
        when(diamondCardRepository.existsByCardCode(any())).thenReturn(false);

        GenerateCardsResponse response = service.generateCards(5, 100L);

        assertThat(response.count()).isEqualTo(5);
        assertThat(response.faceValue()).isEqualTo(100L);
        assertThat(response.cardCodes()).hasSize(5).doesNotHaveDuplicates();
        assertThat(response.cardCodes())
                .allMatch(code -> code.matches("^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$"));

        ArgumentCaptor<List> captor = ArgumentCaptor.forClass(List.class);
        verify(diamondCardRepository).saveAll(captor.capture());
        assertThat((List<DiamondCard>) captor.getValue()).hasSize(5)
                .allSatisfy(card -> assertThat(card.getFaceValue()).isEqualTo(100L));
    }

    @Test
    void generateCards_regeneratesOnCollision() {
        // 第一個候選碼撞號（已存在）→ 應重產，最終仍得 1 張
        when(diamondCardRepository.existsByCardCode(any())).thenReturn(true, false);

        GenerateCardsResponse response = service.generateCards(1, 50L);

        assertThat(response.cardCodes()).hasSize(1);
    }

    @Test
    void listCards_redeemed_usesRedeemedTrueQuery() {
        Pageable pageable = PageRequest.of(0, 20);
        Page<DiamondCard> empty = new PageImpl<>(List.of(), pageable, 0);
        when(diamondCardRepository.findByRedeemed(true, pageable)).thenReturn(empty);

        service.listCards(CardStatusFilter.REDEEMED, pageable);

        verify(diamondCardRepository).findByRedeemed(true, pageable);
        verify(diamondCardRepository, never()).findAll(any(Pageable.class));
    }

    @Test
    void listCards_unredeemed_usesRedeemedFalseQuery() {
        Pageable pageable = PageRequest.of(0, 20);
        when(diamondCardRepository.findByRedeemed(false, pageable))
                .thenReturn(new PageImpl<>(List.of(), pageable, 0));

        service.listCards(CardStatusFilter.UNREDEEMED, pageable);

        verify(diamondCardRepository).findByRedeemed(false, pageable);
    }

    @Test
    void listCards_all_usesFindAll() {
        Pageable pageable = PageRequest.of(0, 20);
        when(diamondCardRepository.findAll(pageable)).thenReturn(new PageImpl<>(List.of(), pageable, 0));

        service.listCards(CardStatusFilter.ALL, pageable);

        verify(diamondCardRepository).findAll(pageable);
        verify(diamondCardRepository, never()).findByRedeemed(any(Boolean.class), any());
    }
}
