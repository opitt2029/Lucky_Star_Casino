package com.luckystar.admin.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.luckystar.admin.dto.CardStatusFilter;
import com.luckystar.admin.dto.DiamondCardView;
import com.luckystar.admin.dto.GenerateCardsResponse;
import com.luckystar.admin.service.DiamondCardService;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

@ExtendWith(MockitoExtension.class)
class AdminDiamondControllerTest {

    @Mock
    DiamondCardService diamondCardService;

    MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.standaloneSetup(new AdminDiamondController(diamondCardService)).build();
    }

    @Test
    void generate_valid_returns201WithCodes() throws Exception {
        when(diamondCardService.generateCards(3, 100L)).thenReturn(
                new GenerateCardsResponse(3, 100L, List.of("AAAA-BBBB-CCCC-DDDD",
                        "1111-2222-3333-4444", "ABCD-EF01-2345-6789")));

        mockMvc.perform(post("/admin/diamond/cards")
                        .contentType("application/json")
                        .content("{\"count\":3,\"faceValue\":100}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.count").value(3))
                .andExpect(jsonPath("$.cardCodes.length()").value(3));
    }

    @Test
    void generate_countOverMax_returns400() throws Exception {
        mockMvc.perform(post("/admin/diamond/cards")
                        .contentType("application/json")
                        .content("{\"count\":1001,\"faceValue\":100}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void generate_nonPositiveFaceValue_returns400() throws Exception {
        mockMvc.perform(post("/admin/diamond/cards")
                        .contentType("application/json")
                        .content("{\"count\":1,\"faceValue\":0}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void list_returnsPagedCards() throws Exception {
        DiamondCardView view = new DiamondCardView("AAAA-BBBB-CCCC-DDDD", 100L, false, null, null, null);
        when(diamondCardService.listCards(eq(CardStatusFilter.UNREDEEMED), any()))
                .thenReturn(new PageImpl<>(List.of(view), PageRequest.of(0, 20), 1));

        mockMvc.perform(get("/admin/diamond/cards?status=unredeemed"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].cardCode").value("AAAA-BBBB-CCCC-DDDD"))
                .andExpect(jsonPath("$.content[0].redeemed").value(false));
    }
}
