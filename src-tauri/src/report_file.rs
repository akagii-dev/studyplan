use std::{io::Write, path::Path};

pub fn write(path: &Path, text: &str) -> Result<(), String> {
    if path
        .extension()
        .and_then(|s| s.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
        != Some("md")
    {
        return Err("ファイル名の末尾を .md にしてください。".into());
    }
    if text.len() > 20 * 1024 * 1024
        || !text.starts_with("# StudyPlan 週間レポート\n")
        || text.contains('\0')
    {
        return Err("レポートの内容またはサイズが不正です。".into());
    }
    let parent = path.parent().ok_or("保存先を選択してください。")?;
    let mut file = tempfile::NamedTempFile::new_in(parent)
        .map_err(|e| format!("保存先に書き込めません。{e}"))?;
    file.write_all(text.as_bytes())
        .and_then(|_| file.as_file().sync_all())
        .map_err(|e| format!("レポートを保存できませんでした。{e}"))?;
    file.persist(path)
        .map_err(|e| format!("レポートを保存できませんでした。{e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn markdown_export_preserves_unicode_and_existing_files_on_failure() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("週間レポート.MD");
        std::fs::write(&path, "before").unwrap();
        let text = "# StudyPlan 週間レポート\n\n追加7問・0問報告📘\n";
        write(&path, text).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), text);
        for invalid in ["", "invalid", "# StudyPlan 週間レポート\n\0"] {
            assert!(write(&path, invalid).is_err());
            assert_eq!(std::fs::read_to_string(&path).unwrap(), text);
        }
        assert!(write(&dir.path().join("studyplan.sqlite3"), text).is_err());
        assert!(!dir.path().join("studyplan.sqlite3").exists());
        assert!(write(&dir.path().join("missing/report.md"), text).is_err());
    }
}
