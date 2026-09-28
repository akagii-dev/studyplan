//! Display-only Windows connection names. Failure must not prevent LAN sharing.
use std::collections::BTreeMap;

fn parse_names(bytes: &[u8]) -> BTreeMap<String, String> {
    let Ok(rows) = serde_json::from_slice::<Vec<serde_json::Value>>(bytes) else {
        return BTreeMap::new();
    };
    let mut names: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for row in rows {
        let (Some(address), Some(name)) = (row["address"].as_str(), row["name"].as_str()) else {
            continue;
        };
        let Ok(ip) = address.parse::<std::net::Ipv4Addr>() else {
            continue;
        };
        if !ip.is_private() || name.trim().is_empty() {
            continue;
        }
        names
            .entry(address.into())
            .or_default()
            .push(name.trim().into());
    }
    names
        .into_iter()
        .map(|(address, mut values)| {
            values.sort();
            values.dedup();
            (address, values.join(" / "))
        })
        .collect()
}

pub fn load() -> BTreeMap<String, String> {
    #[cfg(debug_assertions)]
    if std::env::var_os("STUDYPLAN_TEST_DATA_DIR").is_some()
        && std::env::var("STUDYPLAN_LAN_TEST_ADDRESS").as_deref() == Ok("127.0.0.1")
    {
        return BTreeMap::from([("127.0.0.1".into(), "検証用ネットワーク".into())]);
    }
    #[cfg(windows)]
    {
        use std::{
            os::windows::process::CommandExt,
            process::{Command, Stdio},
            time::{Duration, Instant},
        };
        let Some(root) = std::env::var_os("SystemRoot") else {
            return BTreeMap::new();
        };
        let executable =
            std::path::PathBuf::from(root).join("System32/WindowsPowerShell/v1.0/powershell.exe");
        // Fixed script: no IP, credential or user-supplied text is interpolated.
        let script = r#"[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $ErrorActionPreference='Stop'; $rows=@(Get-NetConnectionProfile | ForEach-Object { $profile=$_; Get-NetIPAddress -InterfaceIndex $profile.InterfaceIndex -AddressFamily IPv4 | ForEach-Object { @{address=$_.IPAddress;name=$profile.Name} } }); ConvertTo-Json -InputObject $rows -Compress"#;
        let Ok(mut child) = Command::new(executable)
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .creation_flags(0x08000000)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
        else {
            return BTreeMap::new();
        };
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            match child.try_wait() {
                Ok(Some(status)) if status.success() => {
                    return child
                        .wait_with_output()
                        .ok()
                        .map(|output| parse_names(&output.stdout))
                        .unwrap_or_default()
                }
                Ok(Some(_)) => return BTreeMap::new(),
                Ok(None) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(25))
                }
                _ => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return BTreeMap::new();
                }
            }
        }
    }
    #[cfg(not(windows))]
    BTreeMap::new()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn matches_each_address_without_guessing_and_preserves_unicode() {
        let names = parse_names(r#"[{"address":"192.168.0.2","name":"TP_LINK"},{"address":"10.0.0.3","name":"自宅 Wi-Fi"},{"address":"192.168.0.2","name":"TP_LINK"}]"#.as_bytes());
        assert_eq!(names.len(), 2);
        assert_eq!(names["192.168.0.2"], "TP_LINK");
        assert_eq!(names["10.0.0.3"], "自宅 Wi-Fi");
    }
    #[test]
    fn invalid_or_missing_names_are_not_invented() {
        for input in [
            "not json",
            "null",
            r#"[{"address":"192.168.0.2","name":" "},{"address":"bad","name":"TP_LINK"}]"#,
        ] {
            assert!(parse_names(input.as_bytes()).is_empty());
        }
    }
}
