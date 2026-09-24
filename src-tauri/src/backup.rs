use crate::db;
use rusqlite::{Connection, OptionalExtension};
use serde_json::{json, Value};
use std::{collections::HashSet, io::Write, path::Path, sync::OnceLock};

const MAX_BYTES: usize = 50 * 1024 * 1024;
static SCHEMA: OnceLock<jsonschema::Validator> = OnceLock::new();

pub fn check(file: &Value) -> Result<(), String> {
    let schema = SCHEMA.get_or_init(|| {
        let schema: Value =
            serde_json::from_str(include_str!("../../src/domain/backupSchema.json"))
                .expect("bundled backup schema");
        jsonschema::options()
            .should_validate_formats(true)
            .build(&schema)
            .expect("valid backup schema")
    });
    if let Some(error) = schema.iter_errors(file).next() {
        return Err(format!("保存形式に合わない値があります（{}）。値を修正してください。現在のデータは変更していません。", error.instance_path()));
    }
    check_state(&file["data"])?;
    if let Some(previous) = file["data"].get("resetBackup") {
        check_state(previous)?;
    }
    Ok(())
}
/// The same accepted state must be writable, exportable and restorable.
pub fn check_data(data: &Value) -> Result<(), String> {
    let file = json!({"format":"StudyPlanBackup","version":1,"createdAt":"2026-09-25T00:00:00Z","appVersion":env!("CARGO_PKG_VERSION"),"data":data});
    check(&file)?;
    if serde_json::to_vec_pretty(&file)
        .map_err(|e| e.to_string())?
        .len()
        > MAX_BYTES - 32
    {
        return Err("保存内容がバックアップの50MB上限を超えています。".into());
    }
    Ok(())
}
/// Old invalid data stays readable. Only editing drafts/display is allowed until repaired.
pub fn check_commit(previous: Option<&Value>, data: &Value) -> Result<(), String> {
    match check_data(data) {
        Ok(()) => Ok(()),
        Err(error) => {
            if let Some(previous) = previous.filter(|old| check_data(old).is_err()) {
                let committed = |value: &Value| {
                    let mut value = value.clone();
                    if let Some(fields) = value.as_object_mut() {
                        for key in [
                            "draft",
                            "step",
                            "theme",
                            "appearance",
                            "sidebarCollapsed",
                            "calendarDensity",
                            "warningExpanded",
                            "ignoredWarnings",
                        ] {
                            fields.remove(key);
                        }
                    }
                    value
                };
                if committed(previous) == committed(data) {
                    return Ok(());
                }
            }
            Err(error)
        }
    }
}
fn unique(items: &Value) -> Result<(), String> {
    let mut ids = HashSet::new();
    for item in items.as_array().ok_or("一覧の形式が不正です。")? {
        let id = item["id"].as_str().ok_or("IDがありません。")?;
        if id.is_empty() || !ids.insert(id) {
            return Err("データのIDが空か重複しています。".into());
        }
    }
    Ok(())
}
fn check_settings(s: &Value) -> Result<(), String> {
    for key in ["exams", "materials", "windows", "exceptions"] {
        unique(&s[key])?;
    }
    for m in s["materials"].as_array().unwrap() {
        if !s["exams"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["id"] == m["examId"])
        {
            return Err("教材に対応する試験がありません。".into());
        }
    }
    Ok(())
}
fn check_plan(plan: &Value, current: &Value) -> Result<(), String> {
    if plan.is_null() {
        return Ok(());
    }
    let settings = plan.get("settingsSnapshot").unwrap_or(current);
    check_settings(settings)?;
    unique(&plan["sessions"])?;
    for session in plan["sessions"].as_array().unwrap() {
        if session["end"].as_f64().unwrap() <= session["start"].as_f64().unwrap() {
            return Err("学習予定の開始・終了時刻が不正です。".into());
        }
        if !settings["exams"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["id"] == session["examId"])
        {
            return Err("学習予定に対応する試験がありません。".into());
        }
        if session["kind"] == "study" {
            let material = settings["materials"]
                .as_array()
                .unwrap()
                .iter()
                .find(|m| m["id"] == session["materialId"])
                .ok_or("学習予定の教材がありません。")?;
            if material["examId"] != session["examId"]
                || material["rounds"]
                    .as_array()
                    .unwrap()
                    .get(session["round"].as_u64().unwrap() as usize)
                    .is_none()
            {
                return Err("学習予定の試験・教材・周回が一致しません。".into());
            }
        }
    }
    Ok(())
}
fn check_state(data: &Value) -> Result<(), String> {
    db::validate(data)?;
    check_settings(&data["settings"])?;
    check_plan(&data["plan"], &data["settings"])?;
    for plan in data["history"].as_array().unwrap() {
        check_plan(plan, &data["settings"])?;
    }
    if !data["proposal"].is_null() {
        check_plan(&data["proposal"]["plan"], &data["settings"])?;
    }
    Ok(())
}
pub fn parse(text: &str) -> Result<Value, String> {
    if text.len() > MAX_BYTES {
        return Err("バックアップは50MB以下のファイルを選んでください。".into());
    }
    let file: Value = serde_json::from_str(text.trim_start_matches('\u{feff}'))
        .map_err(|_| "ファイルを読み取れません。StudyPlanのバックアップを選んでください。")?;
    check(&file)?;
    Ok(file)
}
pub fn packet(db: &Connection) -> Result<Value, String> {
    let data = db::load(db)?
        .ok_or("保存済みの学習データがありません。")?
        .data;
    let created_at: String = db
        .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')", [], |r| {
            r.get(0)
        })
        .map_err(|e| e.to_string())?;
    let file = json!({"format":"StudyPlanBackup","version":1,"createdAt":created_at,"appVersion":env!("CARGO_PKG_VERSION"),"data":data});
    check(&file)?;
    Ok(file)
}
pub fn write_file(path: &Path, file: &Value) -> Result<(), String> {
    if !path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase()
        .ends_with(".studyplan.json")
    {
        return Err("ファイル名の末尾を .studyplan.json にしてください。".into());
    }
    check(file)?;
    let bytes = serde_json::to_vec_pretty(file).map_err(|e| e.to_string())?;
    if bytes.len() > MAX_BYTES {
        return Err("データが50MBを超えるため、バックアップを書き出せません。".into());
    }
    let parent = path.parent().ok_or("保存先を選択してください。")?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)
        .map_err(|e| format!("保存先に書き込めません。{e}"))?;
    temporary
        .write_all(&bytes)
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|e| format!("バックアップを保存できませんでした。{e}"))?;
    temporary.persist(path).map_err(|e| {
        format!("バックアップを保存できませんでした。既存ファイルは変更していません。{e}")
    })?;
    Ok(())
}
pub fn recovery(db: &Connection) -> Result<Option<Value>, String> {
    let row: Option<(String, String)> = db
        .query_row(
            "SELECT data,saved_at FROM restore_point WHERE id=1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    row.map(|(data, saved_at)| {
        serde_json::from_str::<Value>(&data)
            .map(|data| json!({"data":data,"savedAt":saved_at}))
            .map_err(|e| e.to_string())
    })
    .transpose()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn state() -> Value {
        json!({"settings":{"exams":[],"materials":[],"windows":[],"exceptions":[],"block":50,"rest":10,"buffer":0.2,"periods":[540]},"draft":{"numberEdits":{"test":{"text":"","base":"50"}}},"step":0,"records":[],"plan":null,"history":[],"proposal":null})
    }
    fn file() -> Value {
        json!({"format":"StudyPlanBackup","version":1,"createdAt":"2026-09-20T00:00:00.000Z","appVersion":"0.1.0","data":state()})
    }
    #[test]
    fn file_roundtrip_and_atomic_replacement() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("学習.studyplan.json");
        let mut data = file();
        write_file(&path, &data).unwrap();
        assert_eq!(
            parse(&std::fs::read_to_string(&path).unwrap()).unwrap(),
            data
        );
        data["data"]["theme"] = "sky".into();
        write_file(&path, &data).unwrap();
        assert_eq!(
            parse(&std::fs::read_to_string(&path).unwrap()).unwrap(),
            data
        );
        let mut broken = data.clone();
        broken["data"]["plan"] = "broken".into();
        assert!(write_file(&path, &broken).is_err());
        assert_eq!(
            parse(&std::fs::read_to_string(&path).unwrap()).unwrap(),
            data
        );
    }
    #[test]
    fn reject_broken_version_dates_and_references() {
        assert!(parse("{").is_err());
        let mut data = file();
        data["version"] = 2.into();
        assert!(check(&data).is_err());
        let mut data = file();
        data["createdAt"] = "wrong".into();
        assert!(check(&data).is_err());
        let mut data = file();
        data["data"]["settings"]["materials"] = json!([{"id":"m","examId":"missing","name":"教材","total":7,"order":1,"rounds":[{"completed":0,"minutes":2}]}]);
        assert!(check(&data).is_err());
    }
    #[test]
    fn first_restore_can_return_to_the_empty_app() {
        let mut conn = db::open(Path::new(":memory:")).unwrap();
        db::restore(&mut conn, 0, "first-import", state()).unwrap();
        let empty: Value =
            serde_json::from_str(include_str!("../../src/domain/initialState.json")).unwrap();
        assert_eq!(recovery(&conn).unwrap().unwrap()["data"], empty);
        let mut file = file();
        file["data"] = empty.clone();
        check(&file).unwrap();
        db::restore(&mut conn, 1, "undo-first-import", empty.clone()).unwrap();
        assert_eq!(db::load(&conn).unwrap().unwrap().data, empty);
    }
    #[test]
    fn restore_is_atomic_undoable_idempotent_and_persistent() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("study.db");
        let mut conn = db::open(&path).unwrap();
        db::commit(&mut conn, 0, "initial", state()).unwrap();
        let mut imported = state();
        imported["theme"] = "sky".into();
        db::restore(&mut conn, 1, "restore", imported.clone()).unwrap();
        assert_eq!(recovery(&conn).unwrap().unwrap()["data"], state());
        db::restore(&mut conn, 1, "restore", imported.clone()).unwrap();
        assert_eq!(db::load(&conn).unwrap().unwrap().revision, 2);
        assert!(db::restore(&mut conn, 1, "stale", state()).is_err());
        assert_eq!(recovery(&conn).unwrap().unwrap()["data"], state());
        drop(conn);
        let mut conn = db::open(&path).unwrap();
        assert_eq!(db::load(&conn).unwrap().unwrap().data, imported);
        let before = recovery(&conn).unwrap().unwrap()["data"].clone();
        db::restore(&mut conn, 2, "undo", before).unwrap();
        assert_eq!(db::load(&conn).unwrap().unwrap().data, state());
        assert_eq!(recovery(&conn).unwrap().unwrap()["data"], imported);
    }
}
