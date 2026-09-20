use crate::db;
use rusqlite::Connection;
use std::{path::PathBuf, sync::Mutex};

// Open on the first command so storage failures can be shown in the application.
// Failed connections are released; Retry can reopen a temporarily unavailable file.
pub struct Database {
    path: Result<PathBuf, String>,
    connection: Mutex<Option<Connection>>,
}
impl Database {
    pub fn new(path: Result<PathBuf, String>) -> Self {
        Self {
            path,
            connection: Mutex::new(None),
        }
    }
    pub fn with<T>(
        &self,
        action: impl FnOnce(&mut Connection) -> Result<T, String>,
    ) -> Result<T, String> {
        let path = self
            .path
            .as_ref()
            .map_err(|e| format!("保存先を確認できません。{e}"))?;
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| "保存処理を再開できません。アプリを起動し直してください。")?;
        let result = (|| {
            if connection.is_none() {
                let parent = path.parent().ok_or("保存先が不正です。")?;
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("保存フォルダーを開けません。{e}"))?;
                *connection = Some(db::open(path)?);
            }
            action(connection.as_mut().ok_or("保存データを開けません。")?)
        })();
        if result.is_err() {
            *connection = None;
        }
        result.map_err(|e| format!("{e}\n保存先：{}", path.display()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unavailable_storage_can_be_retried_without_restarting() {
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().join("temporarily-blocked");
        std::fs::write(&folder, b"unrelated file").unwrap();
        let database = Database::new(Ok(folder.join("studyplan.sqlite3")));
        assert!(database
            .with(|db| db::load(db))
            .unwrap_err()
            .contains("保存フォルダー"));
        assert_eq!(std::fs::read(&folder).unwrap(), b"unrelated file");
        std::fs::remove_file(&folder).unwrap();
        let data: serde_json::Value =
            serde_json::from_str(include_str!("../../src/domain/initialState.json")).unwrap();
        database
            .with(|conn| db::commit(conn, 0, "initial", data.clone()))
            .unwrap();
        // A rejected write releases the connection, but cannot replace the saved data.
        assert!(database
            .with(|conn| db::commit(conn, 0, "stale", data.clone()))
            .is_err());
        let loaded = database.with(|conn| db::load(conn)).unwrap().unwrap();
        assert_eq!(loaded.data, data);
        assert_eq!(loaded.revision, 1);
    }
    #[test]
    fn damaged_database_is_preserved_on_repeated_read() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("studyplan.sqlite3");
        let bytes = b"not a sqlite database";
        std::fs::write(&path, bytes).unwrap();
        let database = Database::new(Ok(path.clone()));
        for _ in 0..2 {
            assert!(database.with(|conn| db::load(conn)).is_err());
            assert_eq!(std::fs::read(&path).unwrap(), bytes);
        }
    }
}
