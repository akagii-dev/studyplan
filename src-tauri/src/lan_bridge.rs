use crate::{backup, database::Database, db};
use serde_json::{json, Value};
use std::{
    io::{self, BufRead, Write},
    path::PathBuf,
};

const MAX_LINE_BYTES: usize = 102 * 1024 * 1024;

fn expected(params: &Value) -> Result<i64, String> {
    params["expected"]
        .as_i64()
        .filter(|value| *value >= 0)
        .ok_or_else(|| "保存版数が不正です。".into())
}

fn request_id(params: &Value) -> Result<&str, String> {
    params["requestId"]
        .as_str()
        .filter(|value| !value.is_empty() && value.len() <= 200)
        .ok_or_else(|| "操作IDが不正です。".into())
}

fn text(params: &Value) -> Result<&str, String> {
    params["text"]
        .as_str()
        .ok_or_else(|| "バックアップ本文がありません。".into())
}

fn dispatch(database: &Database, method: &str, params: &Value) -> Result<Value, String> {
    match method {
        "load_state" => database.with(|conn| {
            db::load(conn).and_then(|data| serde_json::to_value(data).map_err(|e| e.to_string()))
        }),
        "revision" => database.with(|conn| Ok(json!(db::revision(conn)?))),
        "commit_state" => {
            let data = params.get("data").ok_or("保存内容がありません。")?.clone();
            let result = database
                .with(|conn| db::commit(conn, expected(params)?, request_id(params)?, data))?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "export_backup" => database.with(|conn| backup::packet(conn)),
        "validate_backup" => backup::parse(text(params)?).map(|_| Value::Null),
        "load_restore_point" => database
            .with(|conn| backup::recovery(conn))
            .and_then(|value| serde_json::to_value(value).map_err(|e| e.to_string())),
        "restore_backup" => {
            let file = backup::parse(text(params)?)?;
            let result = database.with(|conn| {
                db::restore(
                    conn,
                    expected(params)?,
                    request_id(params)?,
                    file["data"].clone(),
                )
            })?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        "undo_restore" => {
            let result = database.with(|conn| {
                let previous = backup::recovery(conn)?.ok_or("復元前のデータがありません。")?;
                db::restore(
                    conn,
                    expected(params)?,
                    request_id(params)?,
                    previous["data"].clone(),
                )
            })?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        _ => Err("対応していない保存操作です。".into()),
    }
}

fn reply(output: &mut impl Write, id: u64, result: Result<Value, String>) -> Result<(), String> {
    let response = match result {
        Ok(value) => json!({"id": id, "ok": true, "result": value}),
        Err(error) => json!({"id": id, "ok": false, "error": error}),
    };
    writeln!(output, "{response}")
        .and_then(|_| output.flush())
        .map_err(|e| e.to_string())
}

fn open_existing_database(path: PathBuf) -> Result<Database, String> {
    let metadata = std::fs::metadata(&path).map_err(|_| {
        "既存のStudyPlan保存先が見つかりません。デスクトップ版を先に起動してください。"
    })?;
    if !metadata.is_file() || metadata.len() == 0 {
        return Err("既存のStudyPlan保存先を確認できません。".into());
    }
    let database = Database::new(Ok(path));
    database.with(|conn| db::load(conn))?;
    Ok(database)
}

/// Single owner of the SQLite connection in this process. SQLite transactions arbitrate with Tauri.
pub fn run(path: PathBuf) -> Result<(), String> {
    let database = open_existing_database(path)?;
    let stdin = io::stdin();
    let mut output = io::stdout().lock();
    reply(&mut output, 0, Ok(json!({"ready": true})))?;
    for line in stdin.lock().lines() {
        let line = line.map_err(|e| e.to_string())?;
        if line.len() > MAX_LINE_BYTES {
            return Err("保存要求が大きすぎます。".into());
        }
        let parsed: Value = match serde_json::from_str(&line) {
            Ok(value) => value,
            Err(_) => {
                reply(&mut output, 0, Err("保存要求の形式が不正です。".into()))?;
                continue;
            }
        };
        let id = parsed["id"].as_u64().unwrap_or(0);
        let method = parsed["method"].as_str().unwrap_or("");
        let result = dispatch(&database, method, &parsed["params"]);
        reply(&mut output, id, result)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bridge_uses_existing_commit_backup_and_restore_contracts() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("studyplan.sqlite3");
        let database = Database::new(Ok(path));
        let state: Value =
            serde_json::from_str(include_str!("../../src/domain/initialState.json")).unwrap();
        let params = json!({"expected":0,"requestId":"seed","data":state});
        let first = dispatch(&database, "commit_state", &params).unwrap();
        assert_eq!(first["revision"], 1);
        assert_eq!(dispatch(&database, "revision", &Value::Null).unwrap(), 1);
        assert_eq!(
            dispatch(&database, "load_state", &Value::Null).unwrap(),
            first
        );
        let packet = dispatch(&database, "export_backup", &Value::Null).unwrap();
        dispatch(
            &database,
            "validate_backup",
            &json!({"text":packet.to_string()}),
        )
        .unwrap();
        let restored = dispatch(
            &database,
            "restore_backup",
            &json!({"expected":1,"requestId":"restore","text":packet.to_string()}),
        )
        .unwrap();
        assert_eq!(restored["revision"], 2);
        assert_eq!(
            dispatch(&database, "load_restore_point", &Value::Null).unwrap()["data"],
            first["data"]
        );
        let undone = dispatch(
            &database,
            "undo_restore",
            &json!({"expected":2,"requestId":"undo"}),
        )
        .unwrap();
        assert_eq!(undone["revision"], 3);
        assert_eq!(undone["data"], first["data"]);
    }

    #[test]
    fn empty_existing_database_loads_null_and_accepts_first_commit() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("studyplan.sqlite3");
        let desktop = Database::new(Ok(path.clone()));
        assert!(desktop.with(|conn| db::load(conn)).unwrap().is_none());
        drop(desktop);

        let bridge = open_existing_database(path).unwrap();
        assert!(dispatch(&bridge, "load_state", &Value::Null)
            .unwrap()
            .is_null());
        assert_eq!(dispatch(&bridge, "revision", &Value::Null).unwrap(), 0);
        let state: Value =
            serde_json::from_str(include_str!("../../src/domain/initialState.json")).unwrap();
        let saved = dispatch(
            &bridge,
            "commit_state",
            &json!({"expected":0,"requestId":"first","data":state}),
        )
        .unwrap();
        assert_eq!(saved["revision"], 1);
        assert_eq!(
            dispatch(&bridge, "load_state", &Value::Null).unwrap(),
            saved
        );
    }

    #[test]
    fn unreadable_existing_database_is_not_initialized() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("studyplan.sqlite3");
        let bytes = b"not a sqlite database";
        std::fs::write(&path, bytes).unwrap();
        assert!(open_existing_database(path.clone()).is_err());
        assert_eq!(std::fs::read(path).unwrap(), bytes);
    }
}
