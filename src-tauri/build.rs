fn main() {
    embed_lan();
    tauri_build::build()
}

fn embed_lan() {
    use sha2::{Digest, Sha256};
    use std::{collections::HashSet, fs, path::Path};
    let root = Path::new("../dist-lan");
    let manifest_path = root.join("release-files.json");
    println!("cargo:rerun-if-changed={}", manifest_path.display());
    assert!(!fs::symlink_metadata(&manifest_path)
        .expect("Run pnpm lan:assets before building Desktop")
        .file_type()
        .is_symlink());
    let raw = fs::read(&manifest_path).expect("Run pnpm lan:assets before building Desktop");
    let manifest: serde_json::Value = serde_json::from_slice(&raw).expect("Invalid LAN manifest");
    assert_eq!(manifest["format"], "StudyPlanLanRelease");
    assert_eq!(manifest["version"], 1);
    assert_eq!(manifest["base"], "/studyplan-lan/");
    let files = manifest["files"].as_array().expect("LAN files missing");
    assert!((2..=1000).contains(&files.len()));
    assert!(!fs::symlink_metadata(root).unwrap().file_type().is_symlink());
    let mut seen = HashSet::new();
    let mut total_bytes = 0u64;
    let mut source = String::from("pub static ASSETS: &[(&str, &[u8])] = &[\n");
    for item in files {
        let name = item["path"].as_str().expect("LAN path missing");
        let fixed = [
            "index.html",
            "manifest.webmanifest",
            "sw.js",
            "icon-192.png",
            "icon-512.png",
            "apple-touch-icon.png",
        ]
        .contains(&name);
        let hashed = name
            .strip_prefix("assets/")
            .and_then(|s| s.rsplit_once('.'))
            .map(|(stem, ext)| {
                ["js", "css", "svg", "png", "webp", "woff", "woff2"].contains(&ext)
                    && stem.char_indices().any(|(index, c)| {
                        c == '-'
                            && stem[index + 1..].len() >= 8
                            && stem[index + 1..]
                                .bytes()
                                .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
                    })
                    && stem
                        .bytes()
                        .all(|c| c.is_ascii_alphanumeric() || b"_.-".contains(&c))
            })
            .unwrap_or(false);
        assert!(
            (fixed || hashed) && !name.contains("..") && seen.insert(name.to_ascii_lowercase()),
            "Disallowed LAN file: {name}"
        );
        let mut file = root.to_path_buf();
        for part in name.split('/') {
            file.push(part);
            assert!(
                !fs::symlink_metadata(&file)
                    .unwrap()
                    .file_type()
                    .is_symlink(),
                "LAN symlink rejected"
            );
        }
        assert!(file.is_file());
        let size = fs::metadata(&file).unwrap().len();
        total_bytes += size;
        assert!(
            size <= 20 * 1024 * 1024 && total_bytes <= 50 * 1024 * 1024,
            "LAN assets exceed release size limit"
        );
        let bytes = fs::read(&file).expect("LAN asset unavailable");
        assert_eq!(
            format!("{:x}", Sha256::digest(&bytes)),
            item["sha256"].as_str().unwrap_or(""),
            "LAN hash mismatch: {name}"
        );
        println!("cargo:rerun-if-changed={}", file.display());
        source.push_str(&format!(
            "({name:?}, include_bytes!({:?})),\n",
            fs::canonicalize(&file).unwrap().to_str().unwrap()
        ));
    }
    assert!(seen.contains("index.html"));
    source.push_str("];\n");
    fs::write(
        Path::new(&std::env::var("OUT_DIR").unwrap()).join("lan_assets.rs"),
        source,
    )
    .unwrap();
}
