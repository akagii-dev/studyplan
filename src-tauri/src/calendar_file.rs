use std::{io::Write, path::Path};

pub fn write(path: &Path, text: &str) -> Result<(), String> {
    if path
        .extension()
        .and_then(|v| v.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
        != Some("ics")
    {
        return Err("ファイル名の末尾を .ics にしてください。".into());
    }
    if text.len() > 20 * 1024 * 1024
        || !text.starts_with("BEGIN:VCALENDAR\r\n")
        || !text.ends_with("END:VCALENDAR\r\n")
        || text.contains('\0')
    {
        return Err("カレンダーファイルの形式またはサイズが不正です。".into());
    }
    let parent = path.parent().ok_or("保存先を選択してください。")?;
    let mut file = tempfile::NamedTempFile::new_in(parent)
        .map_err(|e| format!("保存先に書き込めません。{e}"))?;
    file.write_all(text.as_bytes())
        .and_then(|_| file.as_file().sync_all())
        .map_err(|e| format!("カレンダーを保存できませんでした。{e}"))?;
    file.persist(path)
        .map_err(|e| format!("カレンダーを保存できませんでした。{e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn export_replaces_file_atomically_and_rejects_invalid_input() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("授業.ics");
        let content = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n";
        std::fs::write(&path, b"before").unwrap();
        write(&path, content).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), content);
        assert!(write(&path, "invalid").is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), content);
        assert!(write(&dir.path().join("studyplan.sqlite3"), content).is_err());
        assert!(!dir.path().join("studyplan.sqlite3").exists());
        assert!(write(&dir.path().join("missing/授業.ics"), content).is_err());
    }
}
