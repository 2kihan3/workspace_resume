//! 数据库初始化：SQLite + WAL + foreign_keys（spec §5.2）。

use sqlx::{
    migrate::Migrator,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous},
    SqlitePool,
};
use std::{path::Path, str::FromStr, sync::Arc, time::Duration};

async fn migrator() -> Result<Migrator, sqlx::Error> {
    Migrator::new(Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/migrations")))
        .await
        .map_err(|e| sqlx::Error::Configuration(Box::new(e)))
}

pub async fn init_db(db_path: &Path) -> Result<SqlitePool, sqlx::Error> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let opts = SqliteConnectOptions::from_str(&format!("sqlite://{}", db_path.display()))?
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal)
        .foreign_keys(true)
        .busy_timeout(Duration::from_secs(5))
        .create_if_missing(true);

    let pool = SqlitePoolOptions::new()
        .max_connections(4)
        .connect_with(opts)
        .await?;

    migrator().await?.run(&pool).await?;
    Ok(pool)
}

/// 测试/备份恢复用的内存库 + migrations。
pub async fn init_in_memory() -> Result<SqlitePool, sqlx::Error> {
    let opts = SqliteConnectOptions::from_str("sqlite::memory:")?
        .foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(opts)
        .await?;
    migrator().await?.run(&pool).await?;
    Ok(pool)
}

/// 持有连接池的共享状态。
#[derive(Clone)]
pub struct Db(pub Arc<SqlitePool>);

impl std::ops::Deref for Db {
    type Target = SqlitePool;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn migrations_run_and_are_idempotent() {
        let pool = init_in_memory().await.unwrap();
        // 重复执行不报错
        migrator().await.unwrap().run(&pool).await.unwrap();
        let row: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM jobs")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(row.0, 0);
    }

    #[tokio::test]
    async fn check_constraints_enforced() {
        let pool = init_in_memory().await.unwrap();
        let err = sqlx::query(
            "INSERT INTO jobs (id, company_name, status, jd_path, created_at, updated_at)
             VALUES ('x', 'acme', 'bogus_status', 'p', 't', 't')",
        )
        .execute(&pool)
        .await;
        assert!(err.is_err());
    }
}
