mod backup;
mod calendar_file;
mod database;
mod db;
mod report_file;
mod window_state;
use database::Database;
use tauri::Manager;
#[tauri::command]
fn save_window_state(window: tauri::Window) -> Result<(), String> {
    window_state::persist(&window)
}
#[tauri::command]
async fn load_state(db: tauri::State<'_, Database>) -> Result<Option<db::Envelope>, String> {
    db.with(|conn| db::load(conn))
}
#[tauri::command]
fn commit_state(
    db: tauri::State<'_, Database>,
    expected: i64,
    request_id: String,
    data: serde_json::Value,
) -> Result<db::Envelope, String> {
    db.with(|conn| db::commit(conn, expected, &request_id, data))
}
#[tauri::command]
fn export_backup(db: tauri::State<'_, Database>, path: String) -> Result<(), String> {
    let file = db.with(|conn| backup::packet(conn))?;
    backup::write_file(std::path::Path::new(&path), &file)
}
#[tauri::command]
fn validate_backup(text: String) -> Result<(), String> {
    backup::parse(&text).map(|_| ())
}
#[tauri::command]
async fn export_calendar(path: String, text: String) -> Result<(), String> {
    calendar_file::write(std::path::Path::new(&path), &text)
}
#[tauri::command]
async fn export_markdown(path: String, text: String) -> Result<(), String> {
    report_file::write(std::path::Path::new(&path), &text)
}
#[tauri::command]
fn restore_backup(
    db: tauri::State<'_, Database>,
    expected: i64,
    request_id: String,
    text: String,
) -> Result<db::Envelope, String> {
    let file = backup::parse(&text)?;
    db.with(|conn| db::restore(conn, expected, &request_id, file["data"].clone()))
}
#[tauri::command]
fn load_restore_point(db: tauri::State<'_, Database>) -> Result<Option<serde_json::Value>, String> {
    db.with(|conn| backup::recovery(conn))
}
#[tauri::command]
fn undo_restore(
    db: tauri::State<'_, Database>,
    expected: i64,
    request_id: String,
) -> Result<db::Envelope, String> {
    db.with(|conn| {
        let previous = backup::recovery(conn)?.ok_or("復元前のデータがありません。")?;
        db::restore(conn, expected, &request_id, previous["data"].clone())
    })
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = app.path().app_data_dir().map_err(|e| e.to_string());
            #[cfg(debug_assertions)]
            let dir = std::env::var_os("STUDYPLAN_TEST_DATA_DIR")
                .map(|p| Ok(std::path::PathBuf::from(p)))
                .unwrap_or(dir);
            app.manage(Database::new(dir.map(|dir| dir.join("studyplan.sqlite3"))));
            if let Some(window) = app.get_webview_window("main") {
                if let Err(error) = window_state::initialize(&window.as_ref().window()) {
                    eprintln!("Window restore: {error}");
                }
                window.show()?;
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            let result = match event {
                tauri::WindowEvent::Resized(_) | tauri::WindowEvent::ScaleFactorChanged { .. } => {
                    window_state::capture(window)
                }
                tauri::WindowEvent::CloseRequested { .. } => window_state::persist(window),
                _ => Ok(()),
            };
            if let Err(error) = result {
                eprintln!("Window state: {error}");
            }
        })
        .invoke_handler(tauri::generate_handler![
            load_state,
            save_window_state,
            commit_state,
            export_backup,
            export_calendar,
            export_markdown,
            validate_backup,
            restore_backup,
            load_restore_point,
            undo_restore
        ])
        .run(tauri::generate_context!())
        .expect("StudyPlanを起動できませんでした");
}
