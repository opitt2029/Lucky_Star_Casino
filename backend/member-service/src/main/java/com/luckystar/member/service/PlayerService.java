package com.luckystar.member.service;

import com.luckystar.member.dto.ProfileResponse;
import com.luckystar.member.dto.UpdateProfileRequest;
import com.luckystar.member.entity.Member;
import com.luckystar.member.exception.MemberNotFoundException;
import com.luckystar.member.exception.NoUpdateFieldException;
import com.luckystar.member.repository.MemberRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.format.DateTimeFormatter;

@Service
@RequiredArgsConstructor
public class PlayerService {

    private static final DateTimeFormatter FORMATTER = DateTimeFormatter.ISO_LOCAL_DATE_TIME;

    private final MemberRepository memberRepository;

    @Transactional(readOnly = true)
    public ProfileResponse getProfile(Long playerId) {
        Member member = memberRepository.findById(playerId)
                .orElseThrow(() -> new MemberNotFoundException("Member not found: " + playerId));
        return mapToResponse(member);
    }

    @Transactional
    public ProfileResponse updateProfile(Long playerId, UpdateProfileRequest request) {
        if (request.getNickname() == null && request.getAvatar() == null) {
            throw new NoUpdateFieldException(
                    "At least one field (nickname or avatar) must be provided");
        }

        Member member = memberRepository.findById(playerId)
                .orElseThrow(() -> new MemberNotFoundException("Member not found: " + playerId));

        if (request.getNickname() != null) {
            member.setNickname(request.getNickname());
        }
        if (request.getAvatar() != null) {
            member.setAvatar(request.getAvatar());
        }

        memberRepository.save(member);
        return mapToResponse(member);
    }

    /**
     * 更新帳號狀態（內部 API 用，T-051 補完）：enabled=false → DISABLED、true → ACTIVE。
     * DB status 是停用狀態的持久化真相來源（Redis 封鎖標記只負責「即時生效」，
     * 資料清空後靠這裡的 status 讓登入檢查仍能擋住停用玩家）。回傳更新後的狀態字串。
     */
    @Transactional
    public String updateStatus(Long memberId, boolean enabled) {
        Member member = memberRepository.findById(memberId)
                .orElseThrow(() -> new MemberNotFoundException("Member not found: " + memberId));
        member.setStatus(enabled ? "ACTIVE" : "DISABLED");
        memberRepository.save(member);
        return member.getStatus();
    }

    private ProfileResponse mapToResponse(Member member) {
        return new ProfileResponse(
                member.getId(),
                member.getUsername(),
                member.getNickname(),
                member.getAvatar(),
                member.getRole(),
                member.getCreatedAt() != null ? member.getCreatedAt().format(FORMATTER) : null
        );
    }
}
