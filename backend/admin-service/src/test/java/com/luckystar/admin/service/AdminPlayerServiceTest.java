package com.luckystar.admin.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.luckystar.admin.client.MemberClient;
import com.luckystar.admin.client.MemberServiceException;
import com.luckystar.admin.dto.PlayerDetail;
import com.luckystar.admin.dto.PlayerStatusResponse;
import com.luckystar.admin.dto.PlayerSummary;
import com.luckystar.admin.mysql.entity.MemberRead;
import com.luckystar.admin.mysql.repository.MemberReadRepository;
import com.luckystar.admin.mysql.repository.WalletTransactionReadRepository;
import com.luckystar.admin.postgres.entity.AdminActionLog;
import com.luckystar.admin.postgres.repository.AdminActionLogRepository;
import com.luckystar.admin.postgres.repository.GameRoundReadRepository;
import com.luckystar.admin.postgres.repository.WalletReadRepository;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.test.util.ReflectionTestUtils;

@ExtendWith(MockitoExtension.class)
class AdminPlayerServiceTest {

    @Mock MemberReadRepository memberRepository;
    @Mock WalletReadRepository walletRepository;
    @Mock WalletTransactionReadRepository transactionRepository;
    @Mock GameRoundReadRepository gameRoundRepository;
    @Mock PlayerBanService playerBanService;
    @Mock MemberClient memberClient;
    @Mock AdminActionLogRepository actionLogRepository;

    AdminPlayerService service;

    @BeforeEach
    void setUp() {
        service = new AdminPlayerService(memberRepository, walletRepository,
                transactionRepository, gameRoundRepository, playerBanService, memberClient,
                actionLogRepository);
    }

    private MemberRead member(long id, String username, String nickname) {
        MemberRead m = new MemberRead();
        ReflectionTestUtils.setField(m, "id", id);
        ReflectionTestUtils.setField(m, "username", username);
        ReflectionTestUtils.setField(m, "nickname", nickname);
        ReflectionTestUtils.setField(m, "role", "PLAYER");
        ReflectionTestUtils.setField(m, "status", "ACTIVE");
        return m;
    }

    @Test
    void listPlayers_blankKeyword_usesFindAll() {
        Pageable pageable = PageRequest.of(0, 20);
        Page<MemberRead> page = new PageImpl<>(List.of(member(1L, "alice", "Alice")), pageable, 1);
        when(memberRepository.findAll(pageable)).thenReturn(page);

        Page<PlayerSummary> result = service.listPlayers("  ", pageable);

        assertThat(result.getContent()).singleElement()
                .satisfies(s -> assertThat(s.username()).isEqualTo("alice"));
        verify(memberRepository).findAll(pageable);
        verify(memberRepository, never())
                .findByUsernameContainingIgnoreCaseOrNicknameContainingIgnoreCase(any(), any(), any());
    }

    @Test
    void listPlayers_withKeyword_usesSearch() {
        Pageable pageable = PageRequest.of(0, 20);
        Page<MemberRead> page = new PageImpl<>(List.of(member(2L, "bob", "Bob")), pageable, 1);
        when(memberRepository.findByUsernameContainingIgnoreCaseOrNicknameContainingIgnoreCase(
                "bob", "bob", pageable)).thenReturn(page);

        Page<PlayerSummary> result = service.listPlayers("bob", pageable);

        assertThat(result.getContent()).singleElement()
                .satisfies(s -> assertThat(s.playerId()).isEqualTo(2L));
        verify(memberRepository, never()).findAll(any(Pageable.class));
    }

    @Test
    void getPlayerDetail_found_assemblesCrossDbData() {
        when(memberRepository.findById(1L)).thenReturn(Optional.of(member(1L, "alice", "Alice")));
        when(walletRepository.findById(1L)).thenReturn(Optional.empty());
        when(transactionRepository.findTop20ByPlayerIdOrderByCreatedAtDesc(1L)).thenReturn(List.of());
        when(gameRoundRepository.findTop20ByPlayerIdOrderByCreatedAtDesc(1L)).thenReturn(List.of());
        when(playerBanService.isBanned(1L)).thenReturn(true);

        Optional<PlayerDetail> detail = service.getPlayerDetail(1L);

        assertThat(detail).isPresent();
        assertThat(detail.get().balance()).isZero();
        assertThat(detail.get().disabled()).isTrue();
        assertThat(detail.get().recentTransactions()).isEmpty();
    }

    @Test
    void getPlayerDetail_notFound_returnsEmpty() {
        when(memberRepository.findById(99L)).thenReturn(Optional.empty());

        assertThat(service.getPlayerDetail(99L)).isEmpty();
    }

    @Test
    void setStatus_disable_persistsThenBans() {
        when(memberRepository.existsById(1L)).thenReturn(true);

        Optional<PlayerStatusResponse> result = service.setStatus("admin1", 1L, false);

        assertThat(result).contains(new PlayerStatusResponse(1L, true));
        verify(memberClient).updateStatus(1L, false);
        verify(playerBanService).ban(1L);
        verify(playerBanService, never()).unban(eq(1L));
        verify(actionLogRepository).save(any(AdminActionLog.class));
    }

    @Test
    void setStatus_enable_persistsThenUnbans() {
        when(memberRepository.existsById(1L)).thenReturn(true);

        Optional<PlayerStatusResponse> result = service.setStatus("admin1", 1L, true);

        assertThat(result).contains(new PlayerStatusResponse(1L, false));
        verify(memberClient).updateStatus(1L, true);
        verify(playerBanService).unban(1L);
        verify(actionLogRepository).save(any(AdminActionLog.class));
    }

    @Test
    void setStatus_unknownPlayer_returnsEmpty() {
        when(memberRepository.existsById(99L)).thenReturn(false);

        assertThat(service.setStatus("admin1", 99L, false)).isEmpty();
        verify(memberClient, never()).updateStatus(anyLong(), anyBoolean());
        verify(playerBanService, never()).ban(any());
        verify(actionLogRepository, never()).save(any());
    }

    @Test
    void setStatus_memberServiceDown_throwsAndSkipsRedis() {
        // DB 持久化失敗就整個操作失敗（→ 502），不可留下「Redis 已封鎖但 DB 仍 ACTIVE」的半套狀態
        when(memberRepository.existsById(1L)).thenReturn(true);
        doThrow(new MemberServiceException("down")).when(memberClient).updateStatus(1L, false);

        assertThatThrownBy(() -> service.setStatus("admin1", 1L, false))
                .isInstanceOf(MemberServiceException.class);
        verify(playerBanService, never()).ban(any());
        verify(playerBanService, never()).unban(any());
        verify(actionLogRepository, never()).save(any());
    }

    @Test
    void setStatus_auditWriteFails_stillReturnsSuccessResponse() {
        // 稽核寫入為 best-effort：失敗不可讓停用/啟用本身跟著失敗
        when(memberRepository.existsById(1L)).thenReturn(true);
        when(actionLogRepository.save(any())).thenThrow(new RuntimeException("db down"));

        Optional<PlayerStatusResponse> result = service.setStatus("admin1", 1L, false);

        assertThat(result).contains(new PlayerStatusResponse(1L, true));
        verify(playerBanService).ban(1L);
    }
}
