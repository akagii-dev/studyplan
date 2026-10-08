mod backup;
mod calendar_file;
mod database;
mod db;
pub mod lan_bridge;
mod lan_host;
mod lan_interfaces;
mod report_file;
mod window_state;
use database::Database;
use tauri::Manager;
#[tauri::command]
async fn lan_host_status(
    host: tauri::State<'_, lan_host::LanHost>,
) -> Result<lan_host::Status, String> {
    host.status().await
}
#[tauri::command]
async fn lan_host_start(
    host: tauri::State<'_, lan_host::LanHost>,
    db: tauri::State<'_, Database>,
    address: String,
) -> Result<lan_host::Status, String> {
    host.start(address, db.inner().clone()).await
}
#[tauri::command]
async fn lan_host_stop(
    host: tauri::State<'_, lan_host::LanHost>,
) -> Result<lan_host::Status, String> {
    host.stop().await
}
#[tauri::command]
fn save_window_state(window: tauri::Window) -> Result<(), String> {
    window_state::persist(&window)
}
#[tauri::command]
async fn load_state(db: tauri::State<'_, Database>) -> Result<Option<db::Envelope>, String> {
    db.with(|conn| db::load(conn))
}
#[tauri::command]
fn revision(db: tauri::State<'_, Database>) -> Result<i64, String> {
    db.with(|conn| db::revision(conn))
}
// Storage commands are async so large states never block the window's main thread.
#[tauri::command]
async fn commit_state(
    db: tauri::State<'_, Database>,
    expected: i64,
    request_id: String,
    changes: serde_json::Map<String, serde_json::Value>,
    removed: Vec<String>,
) -> Result<i64, String> {
    db.with(|conn| db::commit_changes(conn, expected, &request_id, changes, removed))
}
#[tauri::command]
async fn export_backup(db: tauri::State<'_, Database>, path: String) -> Result<(), String> {
    let file = db.with(|conn| backup::packet(conn))?;
    backup::write_file(std::path::Path::new(&path), &file)
}
#[tauri::command]
async fn validate_backup(text: String) -> Result<(), String> {
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
async fn restore_backup(
    db: tauri::State<'_, Database>,
    expected: i64,
    request_id: String,
    text: String,
) -> Result<db::Envelope, String> {
    let file = backup::parse(&text)?;
    db.with(|conn| db::restore(conn, expected, &request_id, file["data"].clone()))
}
#[tauri::command]
async fn load_restore_point(
    db: tauri::State<'_, Database>,
) -> Result<Option<serde_json::Value>, String> {
    db.with(|conn| backup::recovery(conn))
}
#[tauri::command]
async fn undo_restore(
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
        .manage(lan_host::LanHost::default())
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
            revision,
            save_window_state,
            commit_state,
            export_backup,
            export_calendar,
            export_markdown,
            validate_backup,
            restore_backup,
            load_restore_point,
            undo_restore,
            lan_host_status,
            lan_host_start,
            lan_host_stop
        ])
        .build(tauri::generate_context!())
        .expect("StudyPlanを起動できませんでした")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                // Actual app exit, after the existing save/close decision. No second close veto.
                let _ = tauri::async_runtime::block_on(app.state::<lan_host::LanHost>().stop());
            }
        });
}
