package com.luckystar.admin;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

// 注意：admin-service 使用雙資料庫（MySQL 讀取各服務資料 + PostgreSQL 寫 admin_alerts）
// 雙 DataSource Bean 設定請參考 config/DataSourceConfig.java（T-002 後補）
@SpringBootApplication
public class AdminServiceApplication {

    public static void main(String[] args) {
        SpringApplication.run(AdminServiceApplication.class, args);
    }
}
