package com.luckystar.member.service;

import com.luckystar.member.dto.ProfileResponse;
import com.luckystar.member.dto.UpdateProfileRequest;
import com.luckystar.member.entity.Member;
import com.luckystar.member.exception.MemberNotFoundException;
import com.luckystar.member.exception.NoUpdateFieldException;
import com.luckystar.member.repository.MemberRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDateTime;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class PlayerServiceTest {

    @Mock
    private MemberRepository memberRepository;

    @InjectMocks
    private PlayerService playerService;

    private Member member;

    @BeforeEach
    void setUp() {
        member = new Member();
        member.setId(1L);
        member.setUsername("alice");
        member.setEmail("alice@example.com");
        member.setNickname("Alice");
        member.setAvatarUrl(null);
        member.setActive(true);
        member.setCreatedAt(LocalDateTime.of(2026, 1, 1, 0, 0));
        member.setUpdatedAt(LocalDateTime.of(2026, 1, 1, 0, 0));
    }

    // ── getProfile ─────────────────────────────────────────────────────────────

    @Test
    void getProfile_success() {
        when(memberRepository.findByIdAndIsActiveTrue(1L)).thenReturn(Optional.of(member));

        ProfileResponse response = playerService.getProfile(1L);

        assertEquals(1L, response.getId());
        assertEquals("alice", response.getUsername());
        assertEquals("alice@example.com", response.getEmail());
        assertEquals("Alice", response.getNickname());
        // ProfileResponse 有意不含 passwordHash 欄位（編譯期保證）
        assertDoesNotThrow(() -> ProfileResponse.class.getDeclaredMethod("getId"));
        assertThrows(NoSuchMethodException.class,
                () -> ProfileResponse.class.getDeclaredMethod("getPasswordHash"));
    }

    @Test
    void getProfile_memberNotFound() {
        when(memberRepository.findByIdAndIsActiveTrue(1L)).thenReturn(Optional.empty());

        assertThrows(MemberNotFoundException.class, () -> playerService.getProfile(1L));
    }

    // ── updateProfile ──────────────────────────────────────────────────────────

    @Test
    void updateProfile_nicknameOnly() {
        when(memberRepository.findByIdAndIsActiveTrue(1L)).thenReturn(Optional.of(member));
        when(memberRepository.save(any(Member.class))).thenAnswer(inv -> inv.getArgument(0));

        UpdateProfileRequest request = new UpdateProfileRequest();
        request.setNickname("NewAlice");

        ProfileResponse response = playerService.updateProfile(1L, request);

        verify(memberRepository, times(1)).save(any(Member.class));
        assertEquals("NewAlice", response.getNickname());
    }

    @Test
    void updateProfile_avatarUrlOnly() {
        when(memberRepository.findByIdAndIsActiveTrue(1L)).thenReturn(Optional.of(member));
        when(memberRepository.save(any(Member.class))).thenAnswer(inv -> inv.getArgument(0));

        UpdateProfileRequest request = new UpdateProfileRequest();
        request.setAvatarUrl("https://cdn.example.com/avatar.png");

        ProfileResponse response = playerService.updateProfile(1L, request);

        verify(memberRepository, times(1)).save(any(Member.class));
        assertEquals("https://cdn.example.com/avatar.png", response.getAvatarUrl());
    }

    @Test
    void updateProfile_bothFields() {
        when(memberRepository.findByIdAndIsActiveTrue(1L)).thenReturn(Optional.of(member));
        when(memberRepository.save(any(Member.class))).thenAnswer(inv -> inv.getArgument(0));

        UpdateProfileRequest request = new UpdateProfileRequest();
        request.setNickname("NewAlice");
        request.setAvatarUrl("https://cdn.example.com/avatar.png");

        ProfileResponse response = playerService.updateProfile(1L, request);

        verify(memberRepository, times(1)).save(any(Member.class));
        assertEquals("NewAlice", response.getNickname());
        assertEquals("https://cdn.example.com/avatar.png", response.getAvatarUrl());
    }

    @Test
    void updateProfile_noFieldsProvided() {
        when(memberRepository.findByIdAndIsActiveTrue(1L)).thenReturn(Optional.of(member));

        UpdateProfileRequest request = new UpdateProfileRequest();
        // nickname=null, avatarUrl=null

        assertThrows(NoUpdateFieldException.class,
                () -> playerService.updateProfile(1L, request));
        verify(memberRepository, never()).save(any());
    }

    @Test
    void updateProfile_memberNotFound() {
        when(memberRepository.findByIdAndIsActiveTrue(1L)).thenReturn(Optional.empty());

        UpdateProfileRequest request = new UpdateProfileRequest();
        request.setNickname("NewAlice");

        assertThrows(MemberNotFoundException.class,
                () -> playerService.updateProfile(1L, request));
        verify(memberRepository, never()).save(any());
    }
}
