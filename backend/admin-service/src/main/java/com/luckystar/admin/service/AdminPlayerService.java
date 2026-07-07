package com.luckystar.admin.service;

import com.luckystar.admin.client.MemberClient;
import com.luckystar.admin.dto.PlayerDetail;
import com.luckystar.admin.dto.PlayerStatusResponse;
import com.luckystar.admin.dto.PlayerSummary;
import com.luckystar.admin.mysql.entity.MemberRead;
import com.luckystar.admin.mysql.entity.WalletTransactionRead;
import com.luckystar.admin.mysql.repository.MemberReadRepository;
import com.luckystar.admin.mysql.repository.WalletTransactionReadRepository;
import com.luckystar.admin.postgres.entity.GameRoundRead;
import com.luckystar.admin.postgres.entity.WalletRead;
import com.luckystar.admin.postgres.repository.GameRoundReadRepository;
import com.luckystar.admin.postgres.repository.WalletReadRepository;
import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

/**
 * 後台玩家帳號管理（T-051）。
 *
 * 跨庫唯讀彙整：member（MySQL）、wallets / game_rounds（PostgreSQL）、wallet_transactions（MySQL）。
 * 停用/啟用兩路並行：{@link MemberClient} 經 member 內部 API 持久化 members.status（真相來源），
 * {@link PlayerBanService} 寫 Redis 使用者級封鎖（gateway 強制既有 token 即時失效）。
 * admin 不直接寫 member 庫——狀態更新一律走 member-service 內部 API。
 */
@Service
public class AdminPlayerService {

    private final MemberReadRepository memberRepository;
    private final WalletReadRepository walletRepository;
    private final WalletTransactionReadRepository transactionRepository;
    private final GameRoundReadRepository gameRoundRepository;
    private final PlayerBanService playerBanService;
    private final MemberClient memberClient;

    public AdminPlayerService(MemberReadRepository memberRepository,
                              WalletReadRepository walletRepository,
                              WalletTransactionReadRepository transactionRepository,
                              GameRoundReadRepository gameRoundRepository,
                              PlayerBanService playerBanService,
                              MemberClient memberClient) {
        this.memberRepository = memberRepository;
        this.walletRepository = walletRepository;
        this.transactionRepository = transactionRepository;
        this.gameRoundRepository = gameRoundRepository;
        this.playerBanService = playerBanService;
        this.memberClient = memberClient;
    }

    public Page<PlayerSummary> listPlayers(String keyword, Pageable pageable) {
        Page<MemberRead> page = StringUtils.hasText(keyword)
                ? memberRepository.findByUsernameContainingIgnoreCaseOrNicknameContainingIgnoreCase(
                        keyword, keyword, pageable)
                : memberRepository.findAll(pageable);
        return page.map(this::toSummary);
    }

    public Optional<PlayerDetail> getPlayerDetail(Long playerId) {
        return memberRepository.findById(playerId).map(member -> {
            WalletRead wallet = walletRepository.findById(playerId).orElse(null);
            long balance = wallet != null && wallet.getBalance() != null ? wallet.getBalance() : 0L;
            long frozen = wallet != null && wallet.getFrozenAmount() != null ? wallet.getFrozenAmount() : 0L;

            List<PlayerDetail.TransactionView> transactions =
                    transactionRepository.findTop20ByPlayerIdOrderByCreatedAtDesc(playerId).stream()
                            .map(this::toTransactionView)
                            .toList();
            List<PlayerDetail.GameRoundView> rounds =
                    gameRoundRepository.findTop20ByPlayerIdOrderByCreatedAtDesc(playerId).stream()
                            .map(this::toGameRoundView)
                            .toList();

            return new PlayerDetail(
                    member.getId(),
                    member.getUsername(),
                    member.getNickname(),
                    member.getEmail(),
                    member.getRole(),
                    member.getStatus(),
                    playerBanService.isBanned(member.getId()),
                    member.getCreatedAt(),
                    balance,
                    frozen,
                    transactions,
                    rounds);
        });
    }

    /**
     * 停用/啟用玩家：先經 member 內部 API 持久化 members.status（真相來源），
     * 成功後才寫 Redis 封鎖/解封（既有 token 即時失效）。
     * member 呼叫失敗直接拋出（→ 502），避免留下「Redis 已封鎖但 DB 仍 ACTIVE」的半套狀態；
     * 反向（DB 已改、Redis 未寫）由登入時的 DB status 檢查兜底，重按一次即可補齊。
     * 玩家不存在回 {@link Optional#empty()}（→ 404）。
     */
    public Optional<PlayerStatusResponse> setStatus(Long playerId, boolean enabled) {
        if (!memberRepository.existsById(playerId)) {
            return Optional.empty();
        }
        memberClient.updateStatus(playerId, enabled);
        if (enabled) {
            playerBanService.unban(playerId);
        } else {
            playerBanService.ban(playerId);
        }
        return Optional.of(new PlayerStatusResponse(playerId, !enabled));
    }

    private PlayerSummary toSummary(MemberRead member) {
        return new PlayerSummary(
                member.getId(),
                member.getUsername(),
                member.getNickname(),
                member.getRole(),
                member.getStatus(),
                playerBanService.isBanned(member.getId()),
                member.getCreatedAt());
    }

    private PlayerDetail.TransactionView toTransactionView(WalletTransactionRead tx) {
        return new PlayerDetail.TransactionView(
                tx.getId(),
                tx.getType(),
                tx.getSubType(),
                tx.getAmount() != null ? tx.getAmount() : 0L,
                tx.getBalanceAfter(),
                tx.getReferenceId(),
                tx.getCreatedAt());
    }

    private PlayerDetail.GameRoundView toGameRoundView(GameRoundRead round) {
        return new PlayerDetail.GameRoundView(
                round.getRoundId(),
                round.getGameType(),
                round.getBetAmount(),
                round.getWinAmount(),
                round.getStatus(),
                round.getCreatedAt());
    }
}
