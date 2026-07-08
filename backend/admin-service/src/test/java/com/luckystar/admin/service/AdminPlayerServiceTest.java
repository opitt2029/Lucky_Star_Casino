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
        // member 持久化失敗就整個操作失敗（→ 502），不可留下「Redis 已封鎖但 DB 仍 ACTIVE」的半套狀態
        when(memberRepository.existsById(1L)).thenReturn(true);
        doThrow(new MemberServiceException("down")).when(memberClient).updateStatus(1L, false);

        assertThatThrownBy(() -> service.setStatus("admin1", 1L, false))
                .isInstanceOf(MemberServiceException.class);
        verify(playerBanService, never()).ban(any());
        verify(playerBanService, never()).unban(any());
        // 稽核先於 member 寫入（audit-first），故 save() 已被呼叫；真實 postgres 交易會隨 member 失敗
        // 一起 rollback（mock 不會真的 rollback，rollback 由 @Transactional 保證，此處不對 actionLog 斷言）
    }

    @Test
    void setStatus_redisFails_stillSucceedsAndKeepsAuditAndMemberChange() {
        // Redis 封鎖為 best-effort：走到這步時稽核＋member 已成立（狀態確實變更）。
        // Redis 失敗絕不可反過來 rollback 稽核——否則會留下「已停用卻查不到誰做的」稽核破口。
        // 故 Redis 例外只記 WARN、不外拋；操作仍回成功，稽核與 member 呼叫都保留。
        when(memberRepository.existsById(1L)).thenReturn(true);
        doThrow(new RuntimeException("redis down")).when(playerBanService).ban(1L);

        Optional<PlayerStatusResponse> result = service.setStatus("admin1", 1L, false);

        assertThat(result).contains(new PlayerStatusResponse(1L, true));
        verify(actionLogRepository).save(any(AdminActionLog.class));
        verify(memberClient).updateStatus(1L, false);
        verify(playerBanService).ban(1L);
    }

    @Test
    void setStatus_auditWriteFails_throwsAndSkipsStateChange() {
        // 稽核不再 best-effort：與狀態變更同交易，寫不進去則整筆失敗（→ 500）。
        // 且因 audit-first，member 持久化與 Redis 封鎖都不會發生——沒稽核就不停用。
        when(memberRepository.existsById(1L)).thenReturn(true);
        when(actionLogRepository.save(any())).thenThrow(new RuntimeException("db down"));

        assertThatThrownBy(() -> service.setStatus("admin1", 1L, false))
                .isInstanceOf(RuntimeException.class)
                .hasMessage("db down");
        verify(memberClient, never()).updateStatus(anyLong(), anyBoolean());
        verify(playerBanService, never()).ban(any());
    }
}
