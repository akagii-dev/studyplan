fn main() {
    let mut args = std::env::args().skip(1);
    let result = match (args.next().as_deref(), args.next(), args.next()) {
        (Some("--database"), Some(path), None) => studyplan_lib::lan_bridge::run(path.into()),
        _ => Err("使い方: studyplan_lan_bridge --database <既存SQLiteパス>".into()),
    };
    if let Err(error) = result {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
