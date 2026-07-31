package com.luckystar.member.entity;

import com.fasterxml.jackson.annotation.JsonIgnore;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import lombok.ToString;

import java.time.LocalDate;
import java.time.LocalDateTime;

@Entity
@Table(name = "members")
@Getter
@Setter
@NoArgsConstructor
@ToString(exclude = "passwordHash")
public class Member {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true, length = 50)
    private String username;

    @Column(nullable = false, unique = true, length = 100)
    private String email;

    // ?惜?脩戌嚗ackson 摨?????+ Lombok toString ?
    @JsonIgnore
    @Column(name = "password_hash", length = 255)
    private String passwordHash;

    @Column(nullable = false, length = 50)
    private String nickname;

    @Column(name = "real_name", length = 80)
    private String realName;

    @Column(name = "birth_date")
    private LocalDate birthDate;

    @Column(length = 20)
    private String gender;

    @Column(length = 255)
    private String address;

    @Column(name = "wallet_payment_method", nullable = false, length = 30)
    private String walletPaymentMethod = "STAR_COIN";

    @Column(name = "payment_confirmation_enabled", nullable = false)
    private Boolean paymentConfirmationEnabled = true;

    @Column(columnDefinition = "TEXT")
    private String avatar;

    @Column(nullable = false, length = 20)
    private String role = "PLAYER";

    @Column(nullable = false, length = 20)
    private String status = "ACTIVE";

    @Column(name = "is_new_gift_claimed", nullable = false)
    private Boolean isNewGiftClaimed = false;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
        updatedAt = LocalDateTime.now();
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = LocalDateTime.now();
    }
}
