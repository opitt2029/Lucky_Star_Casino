package com.luckystar.admin.config;

import jakarta.persistence.EntityManagerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.jdbc.DataSourceBuilder;
import org.springframework.boot.orm.jpa.EntityManagerFactoryBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;
import org.springframework.orm.jpa.JpaTransactionManager;
import org.springframework.orm.jpa.LocalContainerEntityManagerFactoryBean;
import org.springframework.transaction.PlatformTransactionManager;

import javax.sql.DataSource;
import java.util.HashMap;
import java.util.Map;

/**
 * ADR-001 雙資料庫設定。
 *
 * 讀端（@Primary）：MySQL — 讀取 members、friendships、daily_checkins 等跨服務查詢資料
 *   - package: com.luckystar.admin.mysql.{entity,repository}
 *
 * 寫端：PostgreSQL — admin_alerts、admin_action_logs 寫入
 *   - package: com.luckystar.admin.postgres.{entity,repository}
 *   - 透過 @Qualifier("postgresEntityManagerFactory") / "postgresTransactionManager" 注入
 */
@Configuration
@EnableJpaRepositories(
        basePackages = "com.luckystar.admin.mysql.repository",
        entityManagerFactoryRef = "mysqlEntityManagerFactory",
        transactionManagerRef = "mysqlTransactionManager"
)
public class DataSourceConfig {

    // ============================================================
    // MySQL — 讀端（Primary）
    // ============================================================

    @Primary
    @Bean("mysqlDataSource")
    @ConfigurationProperties(prefix = "spring.datasource")
    public DataSource mysqlDataSource() {
        return DataSourceBuilder.create().build();
    }

    @Primary
    @Bean("mysqlEntityManagerFactory")
    public LocalContainerEntityManagerFactoryBean mysqlEntityManagerFactory(
            EntityManagerFactoryBuilder builder,
            @Qualifier("mysqlDataSource") DataSource dataSource) {
        Map<String, Object> props = new HashMap<>();
        // 正式環境用 MySQLDialect；測試可用 system property 改 H2Dialect（H2 不支援 PG/MySQL 方言的
        // insert ... returning 等語法）。預設維持正式方言，prod 不受影響。
        props.put("hibernate.dialect", System.getProperty("jpa.dialect.mysql", "org.hibernate.dialect.MySQLDialect"));
        // Admin 僅讀現成 schema，正式環境固定 validate；測試（surefire jpa.ddl-auto=create）
        // 需在 H2 自動建表，故與寫端共用同一組態來源（system property → env → 預設 validate）。
        props.put("hibernate.hbm2ddl.auto", System.getProperty("jpa.ddl-auto", System.getenv().getOrDefault("JPA_DDL_AUTO", "validate")));
        return builder
                .dataSource(dataSource)
                .packages("com.luckystar.admin.mysql.entity")
                .persistenceUnit("mysql")
                .properties(props)
                .build();
    }

    @Primary
    @Bean("mysqlTransactionManager")
    public PlatformTransactionManager mysqlTransactionManager(
            @Qualifier("mysqlEntityManagerFactory") EntityManagerFactory emf) {
        return new JpaTransactionManager(emf);
    }

    // ============================================================
    // PostgreSQL — 寫端（admin_alerts）
    // ============================================================

    @Bean("postgresDataSource")
    @ConfigurationProperties(prefix = "spring.datasource-postgres")
    public DataSource postgresDataSource() {
        return DataSourceBuilder.create().build();
    }

    @Bean("postgresEntityManagerFactory")
    public LocalContainerEntityManagerFactoryBean postgresEntityManagerFactory(
            EntityManagerFactoryBuilder builder,
            @Qualifier("postgresDataSource") DataSource dataSource) {
        Map<String, Object> props = new HashMap<>();
        // 正式環境用 PostgreSQLDialect；測試可用 system property 改 H2Dialect。
        props.put("hibernate.dialect", System.getProperty("jpa.dialect.postgres", "org.hibernate.dialect.PostgreSQLDialect"));
        props.put("hibernate.hbm2ddl.auto", System.getProperty("jpa.ddl-auto", System.getenv().getOrDefault("JPA_DDL_AUTO", "validate")));
        return builder
                .dataSource(dataSource)
                .packages("com.luckystar.admin.postgres.entity")
                .persistenceUnit("postgres")
                .properties(props)
                .build();
    }

    @Bean("postgresTransactionManager")
    public PlatformTransactionManager postgresTransactionManager(
            @Qualifier("postgresEntityManagerFactory") EntityManagerFactory emf) {
        return new JpaTransactionManager(emf);
    }
}
