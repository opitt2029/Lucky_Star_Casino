package com.luckystar.admin.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.jdbc.DataSourceBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import javax.sql.DataSource;

/**
 * 雙資料庫設定（ADR-001）
 *
 * - @Primary DataSource（MySQL）由 spring.datasource 自動配置，JPA 使用此庫
 *   用於讀取 members、friendships 等各服務共用資料
 * - postgresDataSource（PostgreSQL）透過 @Qualifier("postgresDataSource") 注入，
 *   專用於寫入 admin_alerts 資料表
 *
 * 使用方式：
 *   @Autowired
 *   @Qualifier("postgresDataSource")
 *   private DataSource postgresDataSource;
 */
@Configuration
public class DataSourceConfig {

    /**
     * PostgreSQL 寫庫 DataSource（admin_alerts）
     * 對應 application.yml 的 spring.datasource-postgres 區塊
     */
    @Bean("postgresDataSource")
    @ConfigurationProperties(prefix = "spring.datasource-postgres")
    public DataSource postgresDataSource() {
        return DataSourceBuilder.create().build();
    }
}
