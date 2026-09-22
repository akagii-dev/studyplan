//! Window geometry belongs to the native window lifecycle, not React render/save timing.
use crate::{database::Database, db};
use rusqlite::{params, Connection, OptionalExtension};
use std::sync::Mutex;
use tauri::{LogicalSize, Manager, Window};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Geometry {
    width: u32,
    height: u32,
    maximized: bool,
}

pub struct WindowState(pub Mutex<Geometry>);

fn load(conn: &Connection) -> Result<Option<Geometry>, String> {
    let saved = conn
        .query_row(
            "SELECT width, height, maximized FROM desktop_window WHERE id=1",
            [],
            |r| {
                Ok(Geometry {
                    width: r.get(0)?,
                    height: r.get(1)?,
                    maximized: r.get(2)?,
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if saved.is_some() {
        return Ok(saved);
    }
    // One-time fallback for 0.4.11. Study data and its revision remain untouched.
    Ok(db::load(conn)?.and_then(|e| {
        let size = &e.data["windowSize"];
        let width = u32::try_from(size["width"].as_u64()?).ok()?;
        let height = u32::try_from(size["height"].as_u64()?).ok()?;
        (width > 0 && height > 0).then_some(Geometry {
            width,
            height,
            maximized: false,
        })
    }))
}

fn save(conn: &Connection, geometry: Geometry) -> Result<(), String> {
    conn.execute(
        "INSERT INTO desktop_window(id,width,height,maximized) VALUES(1,?1,?2,?3)
         ON CONFLICT(id) DO UPDATE SET width=excluded.width,height=excluded.height,maximized=excluded.maximized",
        params![geometry.width, geometry.height, geometry.maximized],
    ).map(|_| ()).map_err(|e| e.to_string())
}

fn fit(mut geometry: Geometry, available: Option<(u32, u32)>) -> Geometry {
    if let Some((width, height)) = available {
        geometry.width = geometry.width.clamp(480.min(width), width.max(1));
        geometry.height = geometry.height.clamp(540.min(height), height.max(1));
    } else {
        geometry.width = geometry.width.max(480);
        geometry.height = geometry.height.max(540);
    }
    geometry
}

pub fn initialize(window: &Window) -> Result<(), String> {
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let inner = window.inner_size().map_err(|e| e.to_string())?;
    let outer = window.outer_size().map_err(|e| e.to_string())?;
    let available = window
        .current_monitor()
        .map_err(|e| e.to_string())?
        .map(|monitor| {
            let area = monitor.work_area().size;
            (
                ((area
                    .width
                    .saturating_sub(outer.width.saturating_sub(inner.width)))
                    as f64
                    / scale)
                    .floor()
                    .max(1.0) as u32,
                ((area
                    .height
                    .saturating_sub(outer.height.saturating_sub(inner.height)))
                    as f64
                    / scale)
                    .floor()
                    .max(1.0) as u32,
            )
        });
    let default = Geometry {
        width: (inner.width as f64 / scale).round() as u32,
        height: (inner.height as f64 / scale).round() as u32,
        maximized: false,
    };
    let saved = window.state::<Database>().with(|conn| load(conn));
    // A storage error must not hide the window (the existing recovery UI handles it).
    if let Err(ref error) = saved {
        eprintln!("Window state: {error}");
    }
    let geometry = fit(saved.unwrap_or(None).unwrap_or(default), available);
    if let Some((width, height)) = available {
        window
            .set_min_size(Some(LogicalSize::new(480.min(width), 540.min(height))))
            .map_err(|e| e.to_string())?;
    }
    window
        .set_size(LogicalSize::new(geometry.width, geometry.height))
        .map_err(|e| e.to_string())?;
    if geometry.maximized {
        window.maximize().map_err(|e| e.to_string())?;
    }
    window.manage(WindowState(Mutex::new(geometry)));
    Ok(())
}

pub fn capture(window: &Window) -> Result<(), String> {
    let Some(state) = window.try_state::<WindowState>() else {
        return Ok(());
    };
    // Minimized dimensions and state must never replace normal/maximized geometry.
    if window.is_minimized().map_err(|e| e.to_string())? {
        return Ok(());
    }
    let maximized = window.is_maximized().map_err(|e| e.to_string())?;
    let mut geometry = state.0.lock().map_err(|e| e.to_string())?;
    geometry.maximized = maximized;
    if !maximized {
        let scale = window.scale_factor().map_err(|e| e.to_string())?;
        let size = window.inner_size().map_err(|e| e.to_string())?;
        if size.width > 0 && size.height > 0 {
            geometry.width = (size.width as f64 / scale).round() as u32;
            geometry.height = (size.height as f64 / scale).round() as u32;
        }
    }
    Ok(())
}

pub fn persist(window: &Window) -> Result<(), String> {
    capture(window)?;
    let Some(state) = window.try_state::<WindowState>() else {
        return Ok(());
    };
    let geometry = *state.0.lock().map_err(|e| e.to_string())?;
    window.state::<Database>().with(|conn| save(conn, geometry))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn geometry_survives_reopen_without_changing_study_data() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("test.sqlite3");
        let mut conn = db::open(&path).unwrap();
        let mut data: serde_json::Value =
            serde_json::from_str(include_str!("../../src/domain/initialState.json")).unwrap();
        data["windowSize"] = serde_json::json!({"width": 910, "height": 680});
        db::commit(&mut conn, 0, "seed", data.clone()).unwrap();
        assert_eq!(
            load(&conn).unwrap(),
            Some(Geometry {
                width: 910,
                height: 680,
                maximized: false
            })
        );
        let geometry = Geometry {
            width: 880,
            height: 620,
            maximized: true,
        };
        save(&conn, geometry).unwrap();
        drop(conn);
        let conn = db::open(&path).unwrap();
        assert_eq!(load(&conn).unwrap(), Some(geometry));
        let study = db::load(&conn).unwrap().unwrap();
        assert_eq!(study.revision, 1);
        assert_eq!(study.data, data);
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM audit", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            1
        );
    }
    #[test]
    fn fit_only_constrains_dimensions_outside_display_or_minimum() {
        let geometry = Geometry {
            width: 910,
            height: 680,
            maximized: true,
        };
        assert_eq!(fit(geometry, Some((1200, 800))), geometry);
        assert_eq!(
            fit(geometry, Some((800, 800))),
            Geometry {
                width: 800,
                ..geometry
            }
        );
        assert_eq!(
            fit(geometry, Some((1200, 600))),
            Geometry {
                height: 600,
                ..geometry
            }
        );
        assert_eq!(
            fit(geometry, Some((400, 400))),
            Geometry {
                width: 400,
                height: 400,
                ..geometry
            }
        );
    }
    #[test]
    fn no_geometry_uses_the_configured_window_default() {
        let conn = db::open(std::path::Path::new(":memory:")).unwrap();
        assert_eq!(load(&conn).unwrap(), None);
    }
}
