package com.luckystar.member.service;

import com.luckystar.member.dto.ProfileResponse;
import com.luckystar.member.dto.UpdateProfileRequest;
import com.luckystar.member.entity.Member;
import com.luckystar.member.exception.MemberNotFoundException;
import com.luckystar.member.exception.NoUpdateFieldException;
import com.luckystar.member.repository.MemberRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.format.DateTimeFormatter;

@Service
@RequiredArgsConstructor
public class PlayerService {

    private static final DateTimeFormatter FORMATTER = DateTimeFormatter.ISO_LOCAL_DATE_TIME;

    private final MemberRepository memberRepository;

    public ProfileResponse getProfile(Long playerId) {
        Member member = memberRepository.findById(playerId)
                .orElseThrow(() -> new MemberNotFoundException("Member not found: " + playerId));
        return mapToResponse(member);
    }

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
