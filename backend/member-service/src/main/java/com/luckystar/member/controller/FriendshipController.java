package com.luckystar.member.controller;

import com.luckystar.member.dto.ApiResponse;
import com.luckystar.member.dto.FriendListResponse;
import com.luckystar.member.dto.FriendRequestDto;
import com.luckystar.member.dto.FriendRequestView;
import com.luckystar.member.dto.FriendshipResponse;
import com.luckystar.member.service.FriendshipService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/v1/friends")
@RequiredArgsConstructor
public class FriendshipController {

    private final FriendshipService friendshipService;

    @PostMapping("/request")
    public ResponseEntity<ApiResponse<FriendshipResponse>> sendFriendRequest(
            @Valid @RequestBody FriendRequestDto dto) {
        Long currentPlayerId = getCurrentPlayerId();
        FriendshipResponse response = friendshipService.sendFriendRequest(currentPlayerId, dto.receiverId());
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.success(response, "Friend request sent"));
    }

    @PutMapping("/{friendshipId}/accept")
    public ResponseEntity<ApiResponse<FriendshipResponse>> acceptFriendRequest(
            @PathVariable Long friendshipId) {
        Long currentPlayerId = getCurrentPlayerId();
        FriendshipResponse response = friendshipService.acceptFriendRequest(friendshipId, currentPlayerId);
        return ResponseEntity.ok(ApiResponse.success(response, "Friend request accepted"));
    }

    @PutMapping("/{friendshipId}/reject")
    public ResponseEntity<ApiResponse<FriendshipResponse>> rejectFriendRequest(
            @PathVariable Long friendshipId) {
        Long currentPlayerId = getCurrentPlayerId();
        FriendshipResponse response = friendshipService.rejectFriendRequest(friendshipId, currentPlayerId);
        return ResponseEntity.ok(ApiResponse.success(response, "Friend request rejected"));
    }

    @GetMapping
    public ResponseEntity<ApiResponse<List<FriendListResponse>>> listFriends() {
        Long currentPlayerId = getCurrentPlayerId();
        List<FriendListResponse> friends = friendshipService.listFriends(currentPlayerId);
        return ResponseEntity.ok(ApiResponse.success(friends, "Friends retrieved"));
    }

    @GetMapping("/requests")
    public ResponseEntity<ApiResponse<List<FriendRequestView>>> listPendingRequests() {
        Long currentPlayerId = getCurrentPlayerId();
        List<FriendRequestView> requests = friendshipService.listPendingRequests(currentPlayerId);
        return ResponseEntity.ok(ApiResponse.success(requests, "Friend requests retrieved"));
    }
    @DeleteMapping("/{friendshipId}")
    public ResponseEntity<ApiResponse<Void>> deleteFriend(@PathVariable Long friendshipId) {
        Long currentPlayerId = getCurrentPlayerId();
        friendshipService.deleteFriend(friendshipId, currentPlayerId);
        return ResponseEntity.ok(ApiResponse.success(null, "Friend removed"));
    }

    private Long getCurrentPlayerId() {
        return Long.parseLong(
                SecurityContextHolder.getContext().getAuthentication().getName());
    }
}
