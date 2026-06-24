package com.luckystar.game.service;

import com.luckystar.game.dto.GameHistoryResponse;
import com.luckystar.game.dto.GameRecordView;
import com.luckystar.game.entity.GameRound;
import com.luckystar.game.repository.GameRoundRepository;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

/**
 * 玩家「遊戲紀錄」查詢（注單列表）。回傳每筆對局的完整稽核欄位
 * （流水號/注單號、局號、毫秒下注/派彩時間、餘額變化、損益），供前端「遊戲紀錄」頁分頁呈現。
 */
@Service
@RequiredArgsConstructor
public class GameHistoryService {

    /** 單頁筆數上限，避免一次撈太多。 */
    private static final int MAX_PAGE_SIZE = 50;

    private final GameRoundRepository roundRepository;

    /**
     * 分頁查詢玩家遊戲紀錄。
     *
     * @param playerId 玩家 ID
     * @param gameType 遊戲類型過濾（null / 空白 / {@code ALL} 表示全部）
     * @param page     頁碼（1-based；小於 1 時視為 1）
     * @param pageSize 每頁筆數（夾在 1..{@value #MAX_PAGE_SIZE}）
     */
    public GameHistoryResponse history(long playerId, String gameType, int page, int pageSize) {
        int safePage = Math.max(page, 1);
        int safeSize = Math.min(Math.max(pageSize, 1), MAX_PAGE_SIZE);
        Pageable pageable = PageRequest.of(safePage - 1, safeSize);

        boolean allTypes = !StringUtils.hasText(gameType) || "ALL".equalsIgnoreCase(gameType);
        Page<GameRound> result = allTypes
                ? roundRepository.findByPlayerIdOrderByCreatedAtDesc(playerId, pageable)
                : roundRepository.findByPlayerIdAndGameTypeOrderByCreatedAtDesc(
                        playerId, gameType.trim().toUpperCase(), pageable);

        List<GameRecordView> items = result.getContent().stream().map(this::toView).toList();
        return GameHistoryResponse.builder()
                .items(items)
                .total(result.getTotalElements())
                .page(safePage)
                .pageSize(safeSize)
                .build();
    }

    private GameRecordView toView(GameRound r) {
        Long profit = (r.getWinAmount() != null && r.getBetAmount() != null)
                ? r.getWinAmount() - r.getBetAmount()
                : null;
        return GameRecordView.builder()
                .roundId(r.getRoundId())
                .gameType(r.getGameType())
                .nonce(r.getNonce())
                .betAmount(r.getBetAmount())
                .winAmount(r.getWinAmount())
                .profit(profit)
                .balanceBefore(r.getBalanceBefore())
                .balanceAfter(r.getBalanceAfter())
                .betAt(r.getBetAt())
                .settledAt(r.getSettledAt())
                .status(r.getStatus())
                .serverSeedHash(r.getServerSeedHash())
                .clientSeed(r.getClientSeed())
                .resultData(r.getResultData())
                .build();
    }
}
