package com.luckystar.admin.service;

import com.luckystar.admin.client.MemberClient;
import com.luckystar.admin.dto.PlayerDetail;
import com.luckystar.admin.dto.PlayerStatusResponse;
import com.luckystar.admin.dto.PlayerSummary;
import com.luckystar.admin.dto.PlayerVipLevelResponse;
import com.luckystar.admin.mysql.entity.MemberRead;
import com.luckystar.admin.mysql.entity.WalletTransactionRead;
import com.luckystar.admin.mysql.repository.MemberReadRepository;
import com.luckystar.admin.mysql.repository.WalletTransactionReadRepository;
import com.luckystar.admin.postgres.entity.AdminActionLog;
import com.luckystar.admin.postgres.entity.GameRoundRead;
import com.luckystar.admin.postgres.entity.WalletRead;
import com.luckystar.admin.postgres.repository.AdminActionLogRepository;
import com.luckystar.admin.postgres.repository.GameRoundReadRepository;
import com.luckystar.admin.postgres.repository.WalletReadRepository;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
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

    private static final Logger log = LoggerFactory.getLogger(AdminPlayerService.class);

    private final MemberReadRepository memberRepository;
    private final WalletReadRepository walletRepository;
    private final WalletTransactionReadRepository transactionRepository;
    private final GameRoundReadRepository gameRoundRepository;
    private final PlayerBanService playerBanService;
    private final MemberClient memberClient;
    private final AdminActionLogRepository actionLogRepository;

    public AdminPlayerService(MemberReadRepository memberRepository,
                              WalletReadRepository walletRepository,
                              WalletTransactionReadRepository transactionRepository,
                              GameRoundReadRepository gameRoundRepository,
                              PlayerBanService playerBanService,
                              MemberClient memberClient,
                              AdminActionLogRepository actionLogRepository) {
        this.memberRepository = memberRepository;
        this.walletRepository = walletRepository;
        this.transactionRepository = transactionRepository;
        this.gameRoundRepository = gameRoundRepository;
        this.playerBanService = playerBanService;
        this.memberClient = memberClient;
        this.actionLogRepository = actionLogRepository;
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
                    member.getVipLevel(),
                    playerBanService.isBanned(member.getId()),
                    member.getCreatedAt(),
                    balance,
                    frozen,
                    transactions,
                    rounds);
        });
    }

    /**
     * 停用/啟用玩家：稽核（{@code admin_action_logs}，PostgreSQL）與 member 狀態變更放進<b>同一個
     * postgres 交易</b>，比照 {@link GmRewardService} 的 audit-first——稽核寫不進去則整筆失敗、
     * 什麼都不動（<b>不再</b> best-effort）。順序：<b>稽核 → member 內部 API 持久化 members.status
     * （真相來源）→ Redis 封鎖/解封</b>。稽核先寫（交易內尚未 commit），後續 member 呼叫失敗（→ 502）
     * 會連同稽核一起 rollback，保證「沒實際停用就不留稽核、稽核寫不進去就不停用」。
     *
     * <p>跨系統的先天限制：member（HTTP）與 Redis 無法真的加入 postgres 交易，故無法做到三者
     * 原子一致。第 3 步 Redis 封鎖/解封為 <b>best-effort</b>：走到這步時稽核＋member 已成立（狀態
     * 確實變更），Redis 失敗<b>絕不可</b>反過來 rollback 稽核——否則會留下「玩家已停用卻查不到誰做的」
     * 稽核破口。故 Redis 例外只記 WARN 不外拋。殘留的反向半套——member 已改、Redis 未寫——由登入時的
     * DB status 檢查兜底、重按一次即補齊（沿用既有設計，可接受）。玩家不存在回 {@link Optional#empty()}（→ 404）。
     */
    @Transactional("postgresTransactionManager")
    public Optional<PlayerStatusResponse> setStatus(String operator, Long playerId, boolean enabled) {
        if (!memberRepository.existsById(playerId)) {
            return Optional.empty();
        }
        // 1) 先落稽核（交易內；後續任一步失敗則連同稽核 rollback）
        writeAudit(operator, enabled ? "PLAYER_UNBAN" : "PLAYER_BAN", playerId, "player-status");
        // 2) member 內部 API 持久化 status（真相來源）；失敗直接拋 → rollback 稽核、Redis 不動
        memberClient.updateStatus(playerId, enabled);
        // 3) Redis 即時封鎖/解封：best-effort。此時稽核＋member 已成立（狀態確實變更），
        //    Redis 失敗絕不可反過來 rollback 稽核（否則變成「停用了卻查不到誰做的」稽核破口）。
        //    失敗僅記 WARN，遺漏的 Redis 封鎖由登入時的 DB status 檢查兜底、重按一次即補齊。
        try {
            if (enabled) {
                playerBanService.unban(playerId);
            } else {
                playerBanService.ban(playerId);
            }
        } catch (RuntimeException e) {
            log.warn("玩家狀態已變更（playerId={}, enabled={}）且稽核已記錄，但 Redis 封鎖/解封失敗：{}。"
                    + "依賴登入時 DB status 兜底，重按一次即補齊。", playerId, enabled, e.getMessage());
        }
        return Optional.of(new PlayerStatusResponse(playerId, !enabled));
    }

    /**
     * 設定/撤銷玩家 VIP 等級。比照 {@link #setStatus} 的 audit-first：稽核與 member 狀態變更放進
     * <b>同一個 postgres 交易</b>，稽核先寫，member 內部 API 失敗會連同稽核一起 rollback——
     * 「誰在什麼時候把誰升成 VIP」是這個功能唯一的風險控制點，絕不可留下沒有稽核的升級。
     *
     * <p>與 setStatus 的差異：等級不涉及 Redis（沒有「即時生效」的需求，也沒有安全含意），
     * 故沒有第三步 best-effort。生效時機由 JWT 效期決定：等級簽在 token 的 tier claim 裡，
     * 玩家需重新登入或換發 token 才會帶上新等級（降級同理，最長延遲一個 access token 效期）。
     * 玩家不存在回 {@link Optional#empty()}（→ 404）。</p>
     */
    @Transactional("postgresTransactionManager")
    public Optional<PlayerVipLevelResponse> setVipLevel(String operator, Long playerId, String vipLevel) {
        if (!memberRepository.existsById(playerId)) {
            return Optional.empty();
        }
        writeAudit(operator, "VIP".equals(vipLevel) ? "PLAYER_VIP_GRANT" : "PLAYER_VIP_REVOKE",
                playerId, "player-vip");
        memberClient.updateVipLevel(playerId, vipLevel);
        return Optional.of(new PlayerVipLevelResponse(playerId, vipLevel));
    }

    /**
     * 稽核：寫一筆 admin_action_logs（PostgreSQL）。與狀態變更同交易，寫入失敗直接拋（rollback），不再 best-effort。
     * {@code keyPrefix} 只影響冪等鍵的可讀前綴（後接 actionType 與 UUID，唯一性來自 UUID）。
     */
    private void writeAudit(String operator, String actionType, Long playerId, String keyPrefix) {
        String idempotencyKey = keyPrefix + "-" + actionType + "-" + UUID.randomUUID();
        actionLogRepository.save(new AdminActionLog(
                operator, actionType, playerId, null, null, idempotencyKey));
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
