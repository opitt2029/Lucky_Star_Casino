package com.luckystar.admin.mysql.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.LocalDateTime;

/**
 * 玩家帳號唯讀視圖（MySQL {@code members}，T-051）。
 * admin 僅讀玩家資料，不寫 member 庫（寫入走 member internal API / Redis 封鎖）。
 * 僅映射後台需要的欄位；正式環境 validate 只校驗這些欄位存在。
 */
@Entity
@Table(name = "members")
public class MemberRead {

    @Id
    private Long id;

    private String username;
    private String nickname;
    private String email;
    private String role;
    private String status;

    @Column(name = "created_at")
    private LocalDateTime createdAt;

    public MemberRead() {
    }

    public Long getId() {
        return id;
    }

    public String getUsername() {
        return username;
    }

    public String getNickname() {
        return nickname;
    }

    public String getEmail() {
        return email;
    }

    public String getRole() {
        return role;
    }

    public String getStatus() {
        return status;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }
}
