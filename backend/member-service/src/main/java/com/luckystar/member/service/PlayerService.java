package com.luckystar.member.service;

import com.luckystar.member.dto.ProfileResponse;
import com.luckystar.member.dto.UpdateProfileRequest;
import com.luckystar.member.entity.Member;
import com.luckystar.member.exception.MemberNotFoundException;
import com.luckystar.member.exception.NoUpdateFieldException;
import com.luckystar.member.repository.MemberRepository;
import org.springframework.stereotype.Service;

@Service
public class PlayerService {

    private final MemberRepository memberRepository;

    public PlayerService(MemberRepository memberRepository) {
        this.memberRepository = memberRepository;
    }

    public ProfileResponse getProfile(Long memberId) {
        Member member = memberRepository.findByIdAndIsActiveTrue(memberId)
                .orElseThrow(() -> new MemberNotFoundException("Member not found"));
        return mapToResponse(member);
    }

    public ProfileResponse updateProfile(Long memberId, UpdateProfileRequest request) {
        Member member = memberRepository.findByIdAndIsActiveTrue(memberId)
                .orElseThrow(() -> new MemberNotFoundException("Member not found"));

        if (request.getNickname() == null && request.getAvatarUrl() == null) {
            throw new NoUpdateFieldException("At least one field must be provided for update");
        }

        if (request.getNickname() != null) {
            member.setNickname(request.getNickname());
        }
        if (request.getAvatarUrl() != null) {
            member.setAvatarUrl(request.getAvatarUrl());
        }

        Member saved = memberRepository.save(member);
        return mapToResponse(saved);
    }

    // passwordHash 有意排除，不進入 ProfileResponse
    private ProfileResponse mapToResponse(Member m) {
        return new ProfileResponse(
                m.getId(),
                m.getUsername(),
                m.getEmail(),
                m.getNickname(),
                m.getAvatarUrl(),
                m.getCreatedAt(),
                m.getUpdatedAt()
        );
    }
}
