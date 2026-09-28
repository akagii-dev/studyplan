//! Display the connected SSID, never a saved profile or adapter name.
use std::collections::BTreeMap;

fn ssid_label(bytes: &[u8]) -> String {
    if bytes.is_empty() || bytes.len() > 32 {
        return "SSID取得不可".into();
    }
    match std::str::from_utf8(bytes) {
        Ok(text) => text
            .chars()
            .map(|c| {
                if c.is_control() {
                    c.escape_default().to_string()
                } else {
                    c.to_string()
                }
            })
            .collect(),
        Err(_) => format!(
            "SSID: 0x{}",
            bytes.iter().map(|b| format!("{b:02X}")).collect::<String>()
        ),
    }
}

fn labels(
    addresses: Vec<(String, Option<u32>)>,
    wifi: Result<BTreeMap<u32, String>, ()>,
) -> BTreeMap<String, String> {
    addresses
        .into_iter()
        .map(|(ip, index)| {
            let label = match (&wifi, index) {
                (Ok(names), Some(index)) => names
                    .get(&index)
                    .cloned()
                    .unwrap_or_else(|| "SSID取得不可".into()),
                _ => "SSID取得不可".into(),
            };
            (ip, label)
        })
        .collect()
}

pub fn load() -> BTreeMap<String, String> {
    #[cfg(debug_assertions)]
    if std::env::var_os("STUDYPLAN_TEST_DATA_DIR").is_some()
        && std::env::var("STUDYPLAN_LAN_TEST_ADDRESS").as_deref() == Ok("127.0.0.1")
    {
        return BTreeMap::from([("127.0.0.1".into(), "TEST_SSID".into())]);
    }
    let addresses = if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|interface| match interface.ip() {
            std::net::IpAddr::V4(ip) if ip.is_private() => Some((ip.to_string(), interface.index)),
            _ => None,
        })
        .collect();
    labels(addresses, connected_wifi())
}

#[cfg(not(windows))]
fn connected_wifi() -> Result<BTreeMap<u32, String>, ()> {
    Err(())
}

#[cfg(windows)]
fn connected_wifi() -> Result<BTreeMap<u32, String>, ()> {
    use std::{
        ffi::c_void,
        ptr::{null, null_mut},
    };
    use windows_sys::Win32::{
        Foundation::HANDLE,
        NetworkManagement::{
            IpHelper::{
                ConvertInterfaceGuidToLuid, ConvertInterfaceLuidToIndex, GetIfEntry2,
                IF_TYPE_IEEE80211, MIB_IF_ROW2,
            },
            Ndis::NET_LUID_LH,
            WiFi::*,
        },
    };
    struct Client(HANDLE);
    impl Drop for Client {
        fn drop(&mut self) {
            unsafe {
                WlanCloseHandle(self.0, null());
            }
        }
    }
    struct Memory(*mut c_void);
    impl Drop for Memory {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe {
                    WlanFreeMemory(self.0);
                }
            }
        }
    }
    // Native Wifi owns output buffers; guards release them on every return path.
    unsafe {
        let mut names = BTreeMap::new();
        // Identify non-Wi-Fi adapters even when the WLAN service is stopped.
        for interface in if_addrs::get_if_addrs().unwrap_or_default() {
            if let Some(index) = interface.index {
                let mut row: MIB_IF_ROW2 = std::mem::zeroed();
                row.InterfaceIndex = index;
                if GetIfEntry2(&mut row) == 0 && row.Type != IF_TYPE_IEEE80211 {
                    names.insert(index, "Wi-Fi以外".into());
                }
            }
        }
        let mut handle = null_mut();
        let mut version = 0;
        if WlanOpenHandle(2, null(), &mut version, &mut handle) != 0 {
            return Ok(names);
        }
        let client = Client(handle);
        let mut list = null_mut();
        if WlanEnumInterfaces(client.0, null(), &mut list) != 0 || list.is_null() {
            return Ok(names);
        }
        let _list = Memory(list.cast());
        let interfaces = std::slice::from_raw_parts(
            (*list).InterfaceInfo.as_ptr(),
            (*list).dwNumberOfItems as usize,
        );
        for interface in interfaces {
            let mut luid: NET_LUID_LH = std::mem::zeroed();
            let mut index = 0;
            if ConvertInterfaceGuidToLuid(&interface.InterfaceGuid, &mut luid) != 0
                || ConvertInterfaceLuidToIndex(&luid, &mut index) != 0
            {
                return Ok(names);
            }
            if interface.isState != wlan_interface_state_connected {
                names.insert(index, "Wi-Fi未接続".into());
                continue;
            }
            let mut size = 0;
            let mut data = null_mut();
            let result = WlanQueryInterface(
                client.0,
                &interface.InterfaceGuid,
                wlan_intf_opcode_current_connection,
                null(),
                &mut size,
                &mut data,
                null_mut(),
            );
            let _data = Memory(data);
            let label = if result == 0
                && !data.is_null()
                && size as usize >= std::mem::size_of::<WLAN_CONNECTION_ATTRIBUTES>()
            {
                let connection = &*data.cast::<WLAN_CONNECTION_ATTRIBUTES>();
                let ssid = &connection.wlanAssociationAttributes.dot11Ssid;
                ssid.ucSSID
                    .get(..ssid.uSSIDLength as usize)
                    .map(ssid_label)
                    .unwrap_or_else(|| "SSID取得不可".into())
            } else if result == 5 {
                "SSID取得不可・位置情報の許可が必要".into()
            } else {
                "SSID取得不可".into()
            };
            names.insert(index, label);
        }
        Ok(names)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn matches_ssid_by_interface_not_address_order_or_profile() {
        let addresses = vec![
            ("192.168.0.2".into(), Some(9)),
            ("10.0.0.3".into(), Some(4)),
            ("10.0.0.4".into(), Some(7)),
        ];
        let wifi = BTreeMap::from([
            (4, "自宅Wi-Fi".into()),
            (9, "TP_LINK".into()),
            (7, "Wi-Fi以外".into()),
        ]);
        let result = labels(addresses.clone(), Ok(wifi));
        assert_eq!(result["192.168.0.2"], "TP_LINK");
        assert_eq!(result["10.0.0.3"], "自宅Wi-Fi");
        assert_eq!(result["10.0.0.4"], "Wi-Fi以外");
        assert!(labels(addresses, Err(()))
            .values()
            .all(|v| v == "SSID取得不可"));
    }
    #[test]
    fn ssid_bytes_are_not_trimmed_or_replaced_by_profile_names() {
        assert_eq!(ssid_label(b" TP_LINK "), " TP_LINK ");
        assert_eq!(ssid_label("自宅Wi-Fi".as_bytes()), "自宅Wi-Fi");
        assert_eq!(ssid_label(&[0xFF, 0xFE]), "SSID: 0xFFFE");
        assert_eq!(ssid_label(b"a\nb"), "a\\nb");
        assert_eq!(ssid_label(&[]), "SSID取得不可");
        assert_eq!(ssid_label(&[65; 33]), "SSID取得不可");
    }
}
