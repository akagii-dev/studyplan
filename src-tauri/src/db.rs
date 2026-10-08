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
      CREATE TABLE IF NOT EXISTS desktop_window (id INTEGER PRIMARY KEY CHECK(id=1), width INTEGER NOT NULL CHECK(width>0), height INTEGER NOT NULL CHECK(height>0), maximized INTEGER NOT NULL CHECK(maximized IN (0,1)));
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
pub fn revision(db: &Connection) -> Result<i64, String> {
    db.query_row("SELECT revision FROM state WHERE id=1", [], |row| {
        row.get(0)
    })
    .optional()
    .map(|value| value.unwrap_or(0))
    .map_err(|e| e.to_string())
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
fn validate_round_retention(
    before: &Value,
    after: &Value,
    date: &str,
    minute: i64,
) -> Result<(), String> {
    for old in array(&before["settings"], "materials")? {
        let Some(new) = array(&after["settings"], "materials")?
            .iter()
            .find(|m| m["id"] == old["id"])
        else {
            continue;
        };
        let count = array(new, "rounds")?.len();
        if count >= array(old, "rounds")?.len() {
            continue;
        }
        let completed = array(old, "rounds")?
            .iter()
            .skip(count)
            .any(|r| r["completed"].as_f64().unwrap_or(0.0) > 0.0);
        // Cancelled records also retain their referenced round for backup compatibility.
        let records = array(before, "records")?.iter().any(|r| {
            r["materialId"] == old["id"] && r["round"].as_u64().unwrap_or(0) >= count as u64
        });
        let sessions = before["plan"]["sessions"]
            .as_array()
            .into_iter()
            .flatten()
            .any(|s| {
                s["kind"] == "study"
                    && s["materialId"] == old["id"]
                    && s["round"].as_u64().unwrap_or(0) >= count as u64
                    && (s["fixed"] == true
                        || s["date"].as_str().unwrap_or("") < date
                        || (s["date"] == date
                            && s["start"].as_f64().unwrap_or(0.0) < minute as f64))
            });
        if completed || records || sessions {
            return Err(format!(
                "{}：初期完了・記録・開始済み予定・固定予定のある周回は減らせません。",
                old["name"].as_str().unwrap_or("教材")
            ));
        }
    }
    Ok(())
}
enum Update {
    Full(Value),
    /// Changed and removed top-level keys, applied to the stored state at `expected`.
    Changes(serde_json::Map<String, Value>, Vec<String>),
}
pub fn commit(
    db: &mut Connection,
    expected: i64,
    request_id: &str,
    data: Value,
) -> Result<Envelope, String> {
    commit_inner(db, expected, request_id, Update::Full(data), false).map(envelope)
}
/// Desktop saves send only changed keys and receive only the new revision.
pub fn commit_changes(
    db: &mut Connection,
    expected: i64,
    request_id: &str,
    changes: serde_json::Map<String, Value>,
    removed: Vec<String>,
) -> Result<i64, String> {
    commit_inner(
        db,
        expected,
        request_id,
        Update::Changes(changes, removed),
        false,
    )
    .map(|(revision, _)| revision)
}
pub fn restore(
    db: &mut Connection,
    expected: i64,
    request_id: &str,
    data: Value,
) -> Result<Envelope, String> {
    commit_inner(db, expected, request_id, Update::Full(data), true).map(envelope)
}
fn envelope((revision, data): (i64, Option<Value>)) -> Envelope {
    Envelope {
        revision,
        data: data.unwrap_or(Value::Null),
    }
}
/// The database file and revision whose history last passed the full schema check.
/// In-memory databases are never cached.
static CHECKED_HISTORY: std::sync::Mutex<Option<(String, i64, usize)>> =
    std::sync::Mutex::new(None);
fn history_key(db: &Connection, revision: i64, data: &Value) -> Option<(String, i64, usize)> {
    let path = db.path().filter(|path| !path.is_empty())?;
    Some((path.to_owned(), revision, data["history"].as_array()?.len()))
}
/// The state this process last stored by a change set, reused while the revision is unchanged.
static STORED_STATE: std::sync::Mutex<Option<(String, i64, Value)>> = std::sync::Mutex::new(None);
fn load_previous(db: &Connection) -> Result<Option<Envelope>, String> {
    let current = revision(db)?;
    if let (Some(path), Ok(mut stored)) = (db.path().filter(|p| !p.is_empty()), STORED_STATE.lock())
    {
        if stored
            .as_ref()
            .is_some_and(|(p, r, _)| p == path && *r == current)
        {
            let (_, revision, data) = stored.take().expect("checked");
            return Ok(Some(Envelope { revision, data }));
        }
        *stored = None;
    }
    load(db)
}
fn commit_inner(
    db: &mut Connection,
    expected: i64,
    request_id: &str,
    update: Update,
    restore: bool,
) -> Result<(i64, Option<Value>), String> {
    let returns_data = matches!(update, Update::Full(_));
    let tx = db
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let duplicate_revision: Option<i64> = tx
        .query_row(
            "SELECT revision FROM operations WHERE request_id=?1",
            [request_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some(revision) = duplicate_revision {
        if !returns_data {
            return Ok((revision, None));
        }
        let original: String = tx
            .query_row(
                "SELECT data FROM audit WHERE revision=?1",
                [revision],
                |r| r.get(0),
            )
            .map_err(|_| "元の保存応答を確認できません。保存済みの内容を読み直してください。")?;
        let data = serde_json::from_str(&original).map_err(|e| e.to_string())?;
        return Ok((revision, Some(data)));
    }
    let previous = load_previous(&tx)?;
    let revision = previous.as_ref().map(|x| x.revision).unwrap_or(0);
    if expected != revision {
        return Err("別の操作でデータが更新されました。再読み込みしてやり直してください。".into());
    }
    // A change set keeps only what later checks read from the previous state;
    // the full previous state is rebuilt only for the rare invalid-data path.
    let (data, previous, replaced, history_unchanged) = match update {
        Update::Full(data) => {
            let unchanged = previous
                .as_ref()
                .is_some_and(|old| old.data["history"] == data["history"]);
            (data, previous.map(|old| old.data), None, unchanged)
        }
        Update::Changes(changes, removed) => {
            // Nothing stored yet: the first change set contains every key.
            let stored = previous.is_some();
            let mut fields = match previous.map(|old| old.data) {
                None => serde_json::Map::new(),
                Some(Value::Object(fields)) => fields,
                Some(_) => {
                    return Err(
                        "保存済みの内容を確認できません。再読み込みしてやり直してください。".into(),
                    )
                }
            };
            let unchanged =
                !changes.contains_key("history") && !removed.iter().any(|key| key == "history");
            let before = stored.then(|| {
                serde_json::json!({
                    "settings": fields.get("settings").cloned().unwrap_or(Value::Null),
                    "records": fields.get("records").cloned().unwrap_or(Value::Null),
                    "plan": fields.get("plan").cloned().unwrap_or(Value::Null),
                })
            });
            let mut replaced = Vec::new();
            for (key, value) in changes {
                replaced.push((key.clone(), fields.insert(key, value)));
            }
            for key in removed {
                let old = fields.remove(&key);
                replaced.push((key, old));
            }
            (
                Value::Object(fields),
                before,
                stored.then_some(replaced),
                unchanged,
            )
        }
    };
    let known_history = history_unchanged
        && history_key(&tx, revision, &data).is_some_and(|key| {
            CHECKED_HISTORY
                .lock()
                .map(|checked| checked.as_ref() == Some(&key))
                .unwrap_or(false)
        });
    validate(&data)?;
    let mut checked = true;
    if restore {
        crate::backup::check_data(&data)?;
    } else {
        if let Some(ref old) = previous {
            let (date, minute): (String, i64) = tx.query_row(
                "SELECT date('now','localtime'), cast(strftime('%H','now','localtime') as integer)*60+cast(strftime('%M','now','localtime') as integer)", [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            ).map_err(|e| e.to_string())?;
            validate_round_retention(old, &data, &date, minute)?;
        }
        if crate::backup::check_data_known(&data, known_history).is_err() {
            checked = false;
            let previous = match replaced {
                None => previous.clone(),
                Some(replaced) => {
                    let mut fields = data.as_object().cloned().unwrap_or_default();
                    for (key, old) in replaced {
                        match old {
                            Some(old) => fields.insert(key, old),
                            None => fields.remove(&key),
                        };
                    }
                    Some(Value::Object(fields))
                }
            };
            crate::backup::check_commit(previous.as_ref(), &data)?;
        }
    }
    if restore {
        // The previous state and the replacement are committed in the same transaction.
        // Keep this separate from ordinary edits and the onboarding reset snapshot.
        let before = match previous {
            Some(previous) => serde_json::to_string(&previous).map_err(|e| e.to_string())?,
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
    let key = if checked {
        history_key(&tx, next, &data)
    } else {
        None
    };
    let path = tx.path().filter(|p| !p.is_empty()).map(str::to_owned);
    tx.commit().map_err(|e| e.to_string())?;
    if let Ok(mut cache) = CHECKED_HISTORY.lock() {
        *cache = key;
    }
    if returns_data {
        return Ok((next, Some(data)));
    }
    if let (Some(path), Ok(mut stored)) = (path, STORED_STATE.lock()) {
        *stored = Some((path, next, data));
    }
    Ok((next, None))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn state() -> Value {
        let mut data: Value =
            serde_json::from_str(include_str!("../../src/domain/initialState.json")).unwrap();
        data["settings"]["exams"] = serde_json::json!([{"id":"e","name":"試験","start":"2026-09-01","target":"2026-12-01","priority":1,"color":"#287569","reviewDays":0}]);
        data["settings"]["materials"] = serde_json::json!([{"id":"m","examId":"e","name":"教材","order":1,"total":7,"rounds":[{"completed":0,"minutes":2}]}]);
        data["draft"] = serde_json::json!({"name":"入力途中"});
        data["plan"] = serde_json::json!({"id":"p","createdAt":"2026-09-20T00:00:00Z","from":"2026-09-20","sessions":[],"capacities":[],"shortfalls":[],"conflicts":[]});
        data
    }
    fn record(id: &str, n: u64) -> Value {
        serde_json::json!({"id":id,"materialId":"m","round":0,"count":n,"cancelled":false,"date":"2026-09-20","createdAt":"2026-09-20T00:00:00Z","updatedAt":"2026-09-20T00:00:00Z"})
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
        data["draft"]["outside-sleep"] =
            serde_json::json!({"phase":"end","start":"23:00","end":""});
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
    fn changes(data: &Value) -> serde_json::Map<String, Value> {
        data.as_object().unwrap().clone()
    }
    #[test]
    fn change_sets_store_the_same_state_as_full_saves() {
        let dir = tempfile::tempdir().unwrap();
        let mut db = open(&dir.path().join("changes.sqlite3")).unwrap();
        let mut data = state();
        data["history"] = serde_json::json!([data["plan"].clone()]);
        data["sidebarCollapsed"] = true.into();
        assert_eq!(
            commit_changes(&mut db, 0, "first", changes(&data), vec![]).unwrap(),
            1
        );
        assert_eq!(load(&db).unwrap().unwrap().data, data);
        // Only the changed and removed keys are sent; the rest comes from the stored state.
        data["records"] = serde_json::json!([record("r", 2)]);
        data.as_object_mut().unwrap().remove("sidebarCollapsed");
        let mut set = serde_json::Map::new();
        set.insert("records".into(), data["records"].clone());
        assert_eq!(
            commit_changes(
                &mut db,
                1,
                "record",
                set.clone(),
                vec!["sidebarCollapsed".into()]
            )
            .unwrap(),
            2
        );
        assert_eq!(load(&db).unwrap().unwrap().data, data);
        // A replayed request keeps its revision; a stale one is rejected without changes.
        assert_eq!(
            commit_changes(&mut db, 1, "record", set.clone(), vec![]).unwrap(),
            2
        );
        assert!(commit_changes(&mut db, 1, "stale", set, vec![]).is_err());
        // Another writer invalidates the in-memory state; later change sets use the database.
        data["draft"] = serde_json::json!({"name":"他の端末"});
        commit(&mut db, 2, "other", data.clone()).unwrap();
        let mut set = serde_json::Map::new();
        set.insert("step".into(), 2.into());
        commit_changes(&mut db, 3, "after-other", set, vec![]).unwrap();
        data["step"] = 2.into();
        assert_eq!(load(&db).unwrap().unwrap().data, data);
    }
    #[test]
    fn change_sets_still_validate_new_history_and_counts() {
        let dir = tempfile::tempdir().unwrap();
        let mut db = open(&dir.path().join("validate.sqlite3")).unwrap();
        commit_changes(&mut db, 0, "first", changes(&state()), vec![]).unwrap();
        let mut set = serde_json::Map::new();
        set.insert("history".into(), serde_json::json!([{"id":"broken"}]));
        assert!(commit_changes(&mut db, 1, "bad-history", set, vec![]).is_err());
        let mut set = serde_json::Map::new();
        set.insert("records".into(), serde_json::json!([record("r", 8)]));
        assert!(commit_changes(&mut db, 1, "too-many", set, vec![]).is_err());
        assert_eq!(load(&db).unwrap().unwrap().revision, 1);
        assert_eq!(load(&db).unwrap().unwrap().data, state());
    }
    #[test]
    fn replay_returns_original_ack_after_another_client_commits() {
        let mut db = open(Path::new(":memory:")).unwrap();
        let original = commit(&mut db, 0, "seed", state()).unwrap();
        let mut a = original.data.clone();
        a["draft"]["name"] = "A".into();
        let a_ack = commit(&mut db, 1, "client-a", a.clone()).unwrap();
        let mut b = a.clone();
        b["draft"]["name"] = "B".into();
        let b_ack = commit(&mut db, 2, "client-b", b.clone()).unwrap();
        let replay = commit(&mut db, 1, "client-a", a.clone()).unwrap();
        assert_eq!(replay.revision, a_ack.revision);
        assert_eq!(replay.data, a_ack.data);
        assert_eq!(load(&db).unwrap().unwrap().revision, b_ack.revision);
        assert_eq!(load(&db).unwrap().unwrap().data, b);
        assert!(commit(&mut db, replay.revision, "client-a-next", a).is_err());
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

    #[test]
    fn round_retention_is_enforced_at_commit_and_survives_reopen() {
        for kind in [
            "initial",
            "record",
            "zero",
            "cancelled",
            "started",
            "fixed",
            "unused",
        ] {
            let folder = tempfile::tempdir().unwrap();
            let path = folder.path().join("rounds.sqlite3");
            let mut db = open(&path).unwrap();
            let mut s = state();
            s["settings"]["materials"][0]["rounds"].as_array_mut().unwrap().push(serde_json::json!({"completed": if kind == "initial" {7} else {0}, "minutes":2}));
            if ["record", "zero", "cancelled"].contains(&kind) {
                let mut r = record("second", if kind == "zero" { 0 } else { 7 });
                r["round"] = 1.into();
                r["cancelled"] = (kind == "cancelled").into();
                s["records"] = serde_json::json!([r]);
            }
            if ["started", "fixed"].contains(&kind) {
                s["plan"]["sessions"] = serde_json::json!([{"id":"session","date":if kind == "started" {"2000-01-01"} else {"2099-01-01"},"start":540,"end":550,"examId":"e","materialId":"m","round":1,"count":5,"fixed":kind == "fixed","kind":"study"}]);
            }
            commit(&mut db, 0, "seed", s.clone()).unwrap();
            let mut candidate = s.clone();
            candidate["settings"]["materials"][0]["rounds"]
                .as_array_mut()
                .unwrap()
                .pop();
            let result = commit(&mut db, 1, "reduce", candidate.clone());
            assert_eq!(result.is_ok(), kind == "unused", "{kind}: {result:?}");
            drop(db);
            let reopened = open(&path).unwrap();
            assert_eq!(
                load(&reopened).unwrap().unwrap().data,
                if kind == "unused" { candidate } else { s }
            );
        }
    }

    #[test]
    fn committed_minutes_have_a_backup_restore_roundtrip() {
        for minutes in [0.0, 0.1, 1440.0, 1440.1, 2000.0] {
            let mut db = open(Path::new(":memory:")).unwrap();
            let mut s = state();
            s["settings"]["materials"][0]["rounds"][0]["minutes"] = minutes.into();
            let saved = commit(&mut db, 0, "save", s.clone());
            if minutes > 0.0 && minutes <= 1440.0 {
                saved.unwrap();
                let folder = tempfile::tempdir().unwrap();
                let path = folder.path().join("roundtrip.studyplan.json");
                let packet = crate::backup::packet(&db).unwrap();
                crate::backup::write_file(&path, &packet).unwrap();
                let decoded =
                    crate::backup::parse(&std::fs::read_to_string(path).unwrap()).unwrap();
                let mut restored = open(Path::new(":memory:")).unwrap();
                restore(&mut restored, 0, "restore", decoded["data"].clone()).unwrap();
                assert_eq!(load(&restored).unwrap().unwrap().data, s);
            } else {
                assert!(saved.is_err());
                assert!(load(&db).unwrap().is_none());
            }
        }
    }

    #[test]
    fn legacy_invalid_value_is_readable_and_repairable_without_truncation() {
        let mut db = open(Path::new(":memory:")).unwrap();
        let mut old = state();
        old["settings"]["materials"][0]["rounds"][0]["minutes"] = 2000.into();
        db.execute(
            "INSERT INTO state(id,revision,data) VALUES(1,1,?1)",
            [old.to_string()],
        )
        .unwrap();
        assert_eq!(load(&db).unwrap().unwrap().data, old);
        assert!(crate::backup::packet(&db).unwrap_err().contains("minutes"));
        let mut edited = old.clone();
        edited["draft"]["material"] = old["settings"]["materials"][0].clone();
        commit(&mut db, 1, "draft", edited.clone()).unwrap();
        assert_eq!(
            load(&db).unwrap().unwrap().data["settings"],
            old["settings"]
        );
        edited["settings"]["materials"][0]["rounds"][0]["minutes"] = 1440.into();
        edited["draft"]["material"]["rounds"][0]["minutes"] = 1440.into();
        commit(&mut db, 2, "repair", edited).unwrap();
        crate::backup::packet(&db).unwrap();
    }

    #[test]
    fn partial_schedule_answers_are_writable_exportable_and_restorable() {
        for answers in [
            serde_json::json!({"class":"registered"}),
            serde_json::json!({"class":"registered","busy":"none"}),
        ] {
            let mut db = open(Path::new(":memory:")).unwrap();
            let mut s = state();
            s["settings"]["scheduleAnswers"] = answers;
            commit(&mut db, 0, "partial", s.clone()).unwrap();
            let file = crate::backup::packet(&db).unwrap();
            let parsed = crate::backup::parse(&file.to_string()).unwrap();
            let mut restored = open(Path::new(":memory:")).unwrap();
            restore(&mut restored, 0, "restore", parsed["data"].clone()).unwrap();
            assert_eq!(load(&restored).unwrap().unwrap().data, s);
        }
    }
}
