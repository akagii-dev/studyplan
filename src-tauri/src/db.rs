use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;

#[derive(Debug, Serialize, Deserialize)]
pub struct Envelope {
    pub revision: i64,
    pub data: Value,
}

pub fn open(path: &Path) -> Result<Connection, String> {
    let db = Connection::open(path).map_err(|e| e.to_string())?;
    db.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    let version: i64 = db
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if version != 0 && version != 1 {
        return Err(
            "この保存データは、このバージョンでは開けません。新しいStudyPlanで開いてください。"
                .into(),
        );
    }
    db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)));
      CREATE TABLE IF NOT EXISTS operations (request_id TEXT PRIMARY KEY, revision INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS audit (revision INTEGER PRIMARY KEY, data TEXT NOT NULL, saved_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
      CREATE TABLE IF NOT EXISTS restore_point (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL CHECK(json_valid(data)), saved_at TEXT NOT NULL);
      PRAGMA user_version=1;").map_err(|e|e.to_string())?;
    Ok(db)
}
pub fn load(db: &Connection) -> Result<Option<Envelope>, String> {
    let row: Option<(i64, String)> = db
        .query_row("SELECT revision,data FROM state WHERE id=1", [], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .optional()
        .map_err(|e| e.to_string())?;
    row.map(|(revision, data)| {
        serde_json::from_str(&data)
            .map(|data| Envelope { revision, data })
            .map_err(|e| e.to_string())
    })
    .transpose()
}
fn array<'a>(v: &'a Value, key: &str) -> Result<&'a Vec<Value>, String> {
    v[key]
        .as_array()
        .ok_or_else(|| format!("保存データの形式が不正です: {key}"))
}
pub fn validate(data: &Value) -> Result<(), String> {
    let s = &data["settings"];
    if let Some(commute) = s.get("commute") {
        static COMMUTE_SCHEMA: std::sync::OnceLock<jsonschema::Validator> =
            std::sync::OnceLock::new();
        let schema = COMMUTE_SCHEMA.get_or_init(|| {
            let schema: Value =
                serde_json::from_str(include_str!("../../src/domain/backupSchema.json"))
                    .expect("bundled schema");
            jsonschema::options()
                .should_validate_formats(true)
                .build(
                    &schema["properties"]["data"]["properties"]["settings"]["properties"]
                        ["commute"],
                )
                .expect("commute schema")
        });
        if !schema.is_valid(commute)
            || commute["from"].as_str() > commute["to"].as_str()
            || (commute["enabled"] == true
                && commute["mode"] == "weekdays"
                && commute["weekdays"]
                    .as_array()
                    .is_some_and(|days| days.is_empty()))
        {
            return Err("通学の期間・曜日・時間が不正です。".into());
        }
    }
    let materials = array(s, "materials")?;
    let records = array(data, "records")?;
    array(s, "exams")?;
    array(s, "windows")?;
    array(s, "exceptions")?;
    let mut ids = std::collections::HashSet::new();
    for r in records {
        let id = r["id"].as_str().ok_or("記録IDがありません。")?;
        if !ids.insert(id) {
            return Err("記録IDが重複しています。".into());
        }
        let count = r["count"]
            .as_u64()
            .ok_or("問題数は0以上の整数にしてください。")?;
        let round = r["round"].as_u64().ok_or("周回が不正です。")? as usize;
        let m = materials
            .iter()
            .find(|m| m["id"] == r["materialId"])
            .ok_or("記録の教材がありません。")?;
        if array(m, "rounds")?.get(round).is_none() || count > 1_000_000_000 {
            return Err("記録の問題数または周回が不正です。".into());
        }
    }
    let mut material_ids = std::collections::HashSet::new();
    for m in materials {
        if !material_ids.insert(m["id"].as_str().ok_or("教材IDがありません。")?) {
            return Err("教材IDが重複しています。".into());
        }
        let total = m["total"]
            .as_u64()
            .filter(|n| *n > 0 && *n <= 1_000_000_000)
            .ok_or("総問題数は正の整数にしてください。")?;
        for (i, round) in array(m, "rounds")?.iter().enumerate() {
            let base = round["completed"]
                .as_u64()
                .ok_or("完了数は0以上の整数にしてください。")?;
            let sum: u64 = records
                .iter()
                .filter(|r| {
                    r["cancelled"] != true
                        && r["materialId"] == m["id"]
                        && r["round"].as_u64() == Some(i as u64)
                })
                .map(|r| r["count"].as_u64().unwrap_or(0))
                .sum();
            if base > total || sum > total - base {
                return Err("完了数が総問題数を超えています。".into());
            }
        }
    }
    Ok(())
}
pub fn commit(
    db: &mut Connection,
    expected: i64,
    request_id: &str,
    data: Value,
) -> Result<Envelope, String> {
    commit_inner(db, expected, request_id, data, false)
}
pub fn restore(
    db: &mut Connection,
    expected: i64,
    request_id: &str,
    data: Value,
) -> Result<Envelope, String> {
    commit_inner(db, expected, request_id, data, true)
}
fn commit_inner(
    db: &mut Connection,
    expected: i64,
    request_id: &str,
    data: Value,
    restore: bool,
) -> Result<Envelope, String> {
    let tx = db
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let duplicate: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM operations WHERE request_id=?1)",
            [request_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if duplicate {
        return load(&tx)?.ok_or_else(|| "保存データがありません。".into());
    }
    let previous = load(&tx)?;
    let revision = previous.as_ref().map(|x| x.revision).unwrap_or(0);
    if expected != revision {
        return Err("別の操作でデータが更新されました。再読み込みしてやり直してください。".into());
    }
    validate(&data)?;
    if restore {
        // The previous state and the replacement are committed in the same transaction.
        // Keep this separate from ordinary edits and the onboarding reset snapshot.
        let before = match previous {
            Some(previous) => serde_json::to_string(&previous.data).map_err(|e| e.to_string())?,
            None => include_str!("../../src/domain/initialState.json").to_owned(),
        };
        tx.execute("INSERT INTO restore_point(id,data,saved_at) VALUES(1,?1,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(id) DO UPDATE SET data=excluded.data,saved_at=excluded.saved_at", [before]).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string(&data).map_err(|e| e.to_string())?;
    let next = revision + 1;
    tx.execute("INSERT INTO state(id,revision,data) VALUES(1,?1,?2) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,data=excluded.data",params![next,json]).map_err(|e|e.to_string())?;
    tx.execute(
        "INSERT INTO operations(request_id,revision) VALUES(?1,?2)",
        params![request_id, next],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO audit(revision,data) VALUES(?1,?2)",
        params![next, json],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(Envelope {
        revision: next,
        data,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn state() -> Value {
        serde_json::json!({"settings":{"exams":[],"windows":[],"exceptions":[],"materials":[{"id":"m","total":7,"rounds":[{"completed":0}]}]},"records":[],"draft":{"name":"入力途中"},"plan":{"id":"p","sessions":[]},"history":[]})
    }
    fn record(id: &str, n: u64) -> Value {
        serde_json::json!({"id":id,"materialId":"m","round":0,"count":n,"cancelled":false,"date":"2026-09-20"})
    }
    #[test]
    fn newer_schema_is_not_downgraded_or_modified() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("future.sqlite3");
        let db = Connection::open(&path).unwrap();
        db.execute_batch("PRAGMA user_version=2; CREATE TABLE future_data(value TEXT); INSERT INTO future_data VALUES('keep');").unwrap();
        drop(db);
        let before = std::fs::read(&path).unwrap();
        assert!(open(&path).unwrap_err().contains("新しいStudyPlan"));
        assert_eq!(std::fs::read(&path).unwrap(), before);
    }
    #[test]
    fn restart_persists_settings_draft_plan_progress() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("study.db");
        let mut db = open(&path).unwrap();
        let mut data = state();
        data["records"] = serde_json::json!([record("r", 3)]);
        data["sidebarCollapsed"] = true.into();
        data["outsideTime"] = serde_json::json!({"sleep":{"start":1380,"duration":480},"bath":{"start":1320,"duration":30}});
        data["draft"]["outside-sleep"] = serde_json::json!({"phase":"end","start":"23:00","end":""});
        data["ignoredWarnings"] = serde_json::json!({"notice":{"title":"注意","version":"1","ignoredAt":"2026-09-21T00:00:00Z"}});
        data["settings"]["commute"] = serde_json::json!({"enabled":true,"mode":"classDays","from":"2026-09-21","to":"2026-12-31","weekdays":[1,2],"outboundMinutes":30,"returnMinutes":45,"outboundStart":480,"returnStart":1080});
        commit(&mut db, 0, "one", data.clone()).unwrap();
        drop(db);
        let db = open(&path).unwrap();
        let loaded = load(&db).unwrap().unwrap();
        assert_eq!(loaded.data, data);
        assert_eq!(loaded.revision, 1);
    }
    #[test]
    fn duplicate_and_stale_writes_are_safe() {
        let mut db = open(Path::new(":memory:")).unwrap();
        let a = commit(&mut db, 0, "same", state()).unwrap();
        let b = commit(&mut db, 0, "same", state()).unwrap();
        assert_eq!(a.revision, b.revision);
        assert!(commit(&mut db, 0, "different", state()).is_err());
    }
    #[test]
    fn invalid_commute_is_rejected_without_changing_saved_data() {
        let mut db = open(Path::new(":memory:")).unwrap();
        commit(&mut db, 0, "init", state()).unwrap();
        let mut data = state();
        data["settings"]["commute"] = serde_json::json!({"enabled":true,"mode":"weekdays","from":"2026-09-21","to":"2026-12-31","weekdays":[],"outboundMinutes":30,"returnMinutes":45,"outboundStart":480,"returnStart":1080});
        assert!(commit(&mut db, 1, "empty-days", data.clone()).is_err());
        data["settings"]["commute"]["weekdays"] = serde_json::json!([1]);
        data["settings"]["commute"]["returnMinutes"] = (-1).into();
        assert!(commit(&mut db, 1, "negative", data).is_err());
        assert_eq!(load(&db).unwrap().unwrap().revision, 1);
    }
    #[test]
    fn overrun_rejected_atomically() {
        let mut db = open(Path::new(":memory:")).unwrap();
        commit(&mut db, 0, "init", state()).unwrap();
        let mut s = state();
        s["records"] = serde_json::json!([record("r", 8)]);
        assert!(commit(&mut db, 1, "bad", s).is_err());
        assert_eq!(load(&db).unwrap().unwrap().revision, 1);
    }
    #[test]
    fn correction_cancel_and_zero_survive() {
        let mut db = open(Path::new(":memory:")).unwrap();
        let mut s = state();
        s["records"] = serde_json::json!([record("r", 7), record("zero", 0)]);
        commit(&mut db, 0, "a", s.clone()).unwrap();
        s["records"][0]["count"] = 3.into();
        commit(&mut db, 1, "b", s.clone()).unwrap();
        s["records"][0]["cancelled"] = true.into();
        commit(&mut db, 2, "c", s).unwrap();
        let v = load(&db).unwrap().unwrap().data;
        assert_eq!(v["records"][0]["count"], 3);
        assert_eq!(v["records"][0]["cancelled"], true);
        assert_eq!(v["records"][1]["count"], 0);
        let audits: i64 = db
            .query_row("SELECT COUNT(*) FROM audit", [], |r| r.get(0))
            .unwrap();
        assert_eq!(audits, 3);
    }
}
