package com.luckystar.admin.service;

import com.luckystar.admin.dto.CardStatusFilter;
import com.luckystar.admin.dto.DiamondCardView;
import com.luckystar.admin.dto.GenerateCardsResponse;
import com.luckystar.admin.mysql.entity.DiamondCard;
import com.luckystar.admin.mysql.repository.DiamondCardRepository;
import com.luckystar.admin.postgres.entity.AdminActionLog;
import com.luckystar.admin.postgres.repository.AdminActionLogRepository;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 鑽石點數卡產生與查詢（T-105 / T-106）。寫入 MySQL {@code diamond_cards}（admin 的 @Primary 源）。
 * 每次生成另落一筆 {@code admin_action_logs}（PostgreSQL）稽核——生成即等同印出可兌換星幣的價值，
 * 不可無痕生成。
 *
 * <p>稽核為<b>強一致</b>（非 best-effort）：卡片（MySQL）與稽核（PostgreSQL）跨資料源、無 2PC，
 * 但稽核在 mysql 交易 commit <b>之前</b>寫入，故稽核寫入失敗會拋出、連同卡片生成一起 rollback
 * ——「稽核寫不進去就不印卡」。殘留邊界：稽核先 commit 後 mysql commit 才失敗的窄窗，會留下
 * 「稽核有、卡片無」的孤兒稽核（過度記錄，安全方向），此為雙資料源無分散式交易的先天限制。
 */
@Service
public class DiamondCardService {

    private final DiamondCardRepository diamondCardRepository;
    private final AdminActionLogRepository actionLogRepository;

    public DiamondCardService(DiamondCardRepository diamondCardRepository,
                               AdminActionLogRepository actionLogRepository) {
        this.diamondCardRepository = diamondCardRepository;
        this.actionLogRepository = actionLogRepository;
    }

    /**
     * 批量生成唯一序號卡。序號格式 {@code XXXX-XXXX-XXXX-XXXX}（16 碼 hex 大寫，UUID 取頭）。
     * 同批內去重，並以 {@code existsByCardCode} 避開既有序號（card_code UNIQUE）。
     */
    @Transactional(transactionManager = "mysqlTransactionManager")
    public GenerateCardsResponse generateCards(String operator, int count, long faceValue) {
        Set<String> codes = new LinkedHashSet<>();
        while (codes.size() < count) {
            String code = generateCode();
            if (!codes.contains(code) && !diamondCardRepository.existsByCardCode(code)) {
                codes.add(code);
            }
        }

        List<DiamondCard> cards = codes.stream()
                .map(code -> new DiamondCard(code, faceValue))
                .toList();
        diamondCardRepository.saveAll(cards);

        // 稽核在 mysql commit 前寫入：寫入失敗會拋出 → mysql 交易 rollback → 卡片不生成（強一致，非 best-effort）
        writeAudit(operator, count, faceValue);
        return new GenerateCardsResponse(count, faceValue, new ArrayList<>(codes));
    }

    /** 稽核：寫一筆 admin_action_logs（PostgreSQL）。與卡片生成強一致，寫入失敗直接拋（觸發 mysql rollback），不再 best-effort。 */
    private void writeAudit(String operator, int count, long faceValue) {
        String idempotencyKey = "diamond-card-generate-" + UUID.randomUUID();
        actionLogRepository.save(new AdminActionLog(
                operator, "DIAMOND_CARD_GENERATE", null, faceValue * count,
                "generate " + count + " card(s) @ " + faceValue, idempotencyKey));
    }

    @Transactional(transactionManager = "mysqlTransactionManager", readOnly = true)
    public Page<DiamondCardView> listCards(CardStatusFilter status, Pageable pageable) {
        Page<DiamondCard> page = switch (status) {
            case REDEEMED -> diamondCardRepository.findByRedeemed(true, pageable);
            case UNREDEEMED -> diamondCardRepository.findByRedeemed(false, pageable);
            case ALL -> diamondCardRepository.findAll(pageable);
        };
        return page.map(this::toView);
    }

    private String generateCode() {
        String hex = UUID.randomUUID().toString().replace("-", "").substring(0, 16).toUpperCase();
        return String.join("-",
                hex.substring(0, 4), hex.substring(4, 8), hex.substring(8, 12), hex.substring(12, 16));
    }

    private DiamondCardView toView(DiamondCard card) {
        return new DiamondCardView(
                card.getCardCode(),
                card.getFaceValue() != null ? card.getFaceValue() : 0L,
                card.isRedeemed(),
                card.getRedeemedBy(),
                card.getRedeemedAt(),
                card.getCreatedAt());
    }
}
