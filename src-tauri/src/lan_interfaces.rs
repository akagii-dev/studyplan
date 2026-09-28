//! Discover and rank local bind addresses; never open a listener or change OS settings.
use if_addrs::{IfAddr, Interface};
use serde::Serialize;
use std::{
    collections::{BTreeMap, BTreeSet},
    net::Ipv4Addr,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LanAddress {
    pub address: String,
    pub interface_alias: String,
}

#[derive(Default)]
struct InterfaceInfo {
    interface_alias: String,
    physical_lan: bool,
    virtual_interface: bool,
}

fn virtual_name(name: &str) -> bool {
    let name = name.to_lowercase();
    [
        "vethernet",
        "hyper-v",
        "wsl",
        "vpn",
        "tailscale",
        "fortinet",
        "forticlient",
        "wireguard",
        "wintun",
        "tap-windows",
        "virtual",
        "vmware",
        "zerotier",
    ]
    .iter()
    .any(|part| name.contains(part))
}

fn usable_ipv4(ip: Ipv4Addr) -> bool {
    !ip.is_loopback()
        && !ip.is_link_local()
        && !ip.is_unspecified()
        && !ip.is_broadcast()
        && !ip.is_multicast()
}

fn select_addresses(
    interfaces: Vec<Interface>,
    information: BTreeMap<u32, InterfaceInfo>,
    gateways: BTreeSet<u32>,
) -> Vec<LanAddress> {
    let mut candidates = Vec::new();
    for interface in interfaces {
        if !interface.is_oper_up() {
            continue;
        }
        let IfAddr::V4(ip) = &interface.addr else {
            continue;
        };
        // /31 and /32 point-to-point addresses have no directed broadcast address.
        let directed_broadcast =
            ip.prefixlen < 31 && u32::from(ip.ip) | (u32::MAX >> ip.prefixlen) == u32::from(ip.ip);
        if !usable_ipv4(ip.ip) || directed_broadcast {
            continue;
        }
        let info = interface.index.and_then(|index| information.get(&index));
        let alias = info
            .filter(|info| !info.interface_alias.is_empty())
            .map(|info| info.interface_alias.clone())
            .unwrap_or_else(|| interface.name.clone());
        let virtual_interface = interface.is_p2p()
            || virtual_name(&alias)
            || info.is_some_and(|info| info.virtual_interface);
        let physical_lan = info.is_some_and(|info| info.physical_lan);
        let gateway = interface
            .index
            .is_some_and(|index| gateways.contains(&index));
        // Real Wi-Fi/Ethernet with a default gateway comes first. Virtual/VPN NICs
        // remain selectable even when they are the only connected interfaces.
        let priority = (
            virtual_interface,
            !(physical_lan && gateway),
            !gateway,
            !physical_lan,
        );
        candidates.push((priority, alias, ip.ip));
    }
    candidates.sort_by(|a, b| (&a.0, &a.1, a.2).cmp(&(&b.0, &b.1, b.2)));
    let mut seen = BTreeSet::new();
    candidates
        .into_iter()
        .filter_map(|(_, interface_alias, ip)| {
            // The existing start command selects an IP, so show each bind address once.
            seen.insert(ip).then(|| LanAddress {
                address: ip.to_string(),
                interface_alias,
            })
        })
        .collect()
}

pub fn load() -> Result<Vec<LanAddress>, String> {
    let interfaces = if_addrs::get_if_addrs()
        .map_err(|_| "LANの接続先を取得できません。Wi-Fiまたは有線LANの接続を確認してください。")?;
    let (information, gateways) = metadata(&interfaces);
    Ok(select_addresses(interfaces, information, gateways))
}

#[cfg(not(windows))]
fn metadata(_: &[Interface]) -> (BTreeMap<u32, InterfaceInfo>, BTreeSet<u32>) {
    (BTreeMap::new(), BTreeSet::new())
}

#[cfg(windows)]
fn metadata(interfaces: &[Interface]) -> (BTreeMap<u32, InterfaceInfo>, BTreeSet<u32>) {
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        GetIfEntry2, IF_TYPE_ETHERNET_CSMACD, IF_TYPE_IEEE80211, MIB_IF_ROW2,
    };
    fn text(value: &[u16]) -> String {
        let end = value.iter().position(|c| *c == 0).unwrap_or(value.len());
        String::from_utf16_lossy(&value[..end])
    }
    let mut information = BTreeMap::new();
    for index in interfaces
        .iter()
        .filter_map(|interface| interface.index)
        .collect::<BTreeSet<_>>()
    {
        let mut row = MIB_IF_ROW2 {
            InterfaceIndex: index,
            ..Default::default()
        };
        // GetIfEntry2 writes only this initialized row. Alias is Windows InterfaceAlias.
        if unsafe { GetIfEntry2(&mut row) } == 0 {
            let alias = text(&row.Alias);
            let hardware = row.InterfaceAndOperStatusFlags._bitfield & 1 != 0;
            information.insert(
                index,
                InterfaceInfo {
                    physical_lan: hardware
                        && matches!(row.Type, IF_TYPE_ETHERNET_CSMACD | IF_TYPE_IEEE80211),
                    virtual_interface: !hardware
                        || virtual_name(&alias)
                        || virtual_name(&text(&row.Description)),
                    interface_alias: alias,
                },
            );
        }
    }
    (information, default_gateways())
}

#[cfg(windows)]
fn default_gateways() -> BTreeSet<u32> {
    use windows_sys::Win32::{
        NetworkManagement::IpHelper::{FreeMibTable, GetIpForwardTable2, MIB_IPFORWARD_TABLE2},
        Networking::WinSock::AF_INET,
    };
    struct Table(*mut MIB_IPFORWARD_TABLE2);
    impl Drop for Table {
        fn drop(&mut self) {
            unsafe {
                FreeMibTable(self.0.cast());
            }
        }
    }
    let mut pointer = std::ptr::null_mut();
    // The OS allocates the variable-length table; the guard frees it on all success paths.
    unsafe {
        if GetIpForwardTable2(AF_INET, &mut pointer) != 0 || pointer.is_null() {
            // Missing ranking metadata must not hide otherwise usable local addresses.
            return BTreeSet::new();
        }
        let table = Table(pointer);
        let rows =
            std::slice::from_raw_parts((*table.0).Table.as_ptr(), (*table.0).NumEntries as usize);
        gateway_indices(rows)
    }
}

#[cfg(windows)]
fn gateway_indices(
    rows: &[windows_sys::Win32::NetworkManagement::IpHelper::MIB_IPFORWARD_ROW2],
) -> BTreeSet<u32> {
    use windows_sys::Win32::Networking::WinSock::AF_INET;
    rows.iter()
        .filter(|row| {
            // Inspect the IPv4 union member only after validating its address family.
            row.DestinationPrefix.PrefixLength == 0
                && unsafe { row.NextHop.si_family == AF_INET }
                && (row.Immortal || row.ValidLifetime > 0)
                && !row.Loopback
                && !unsafe { Ipv4Addr::from(row.NextHop.Ipv4.sin_addr.S_un.S_addr.to_ne_bytes()) }
                    .is_unspecified()
        })
        .map(|row| row.InterfaceIndex)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use if_addrs::{IfOperStatus, Ifv4Addr};

    fn interface(index: u32, alias: &str, address: &str) -> Interface {
        Interface {
            name: alias.into(),
            index: Some(index),
            oper_status: IfOperStatus::Up,
            is_p2p: false,
            addr: IfAddr::V4(Ifv4Addr {
                ip: address.parse().unwrap(),
                netmask: Ipv4Addr::new(255, 255, 255, 0),
                prefixlen: 24,
                broadcast: None,
            }),
            #[cfg(windows)]
            adapter_name: format!("adapter-{index}"),
        }
    }
    fn physical(alias: &str) -> InterfaceInfo {
        InterfaceInfo {
            interface_alias: alias.into(),
            physical_lan: true,
            virtual_interface: false,
        }
    }
    #[test]
    fn global_wifi_precedes_wsl_and_vpn_and_apipa_is_excluded() {
        let wifi = interface(7, "old alias", "133.26.237.171");
        let wsl = interface(9, "vEthernet (WSL (Hyper-V firewall))", "172.28.224.1");
        let mut vpn = interface(11, "Tailscale", "100.96.0.5");
        vpn.is_p2p = true;
        let fortinet = interface(12, "Fortinet", "10.0.0.2");
        let apipa = interface(15, "Ethernet", "169.254.12.34");
        let ethernet = interface(16, "Ethernet", "192.168.1.2");
        let mut input = vec![wsl, vpn.clone(), apipa, fortinet, wifi, ethernet];
        let choose = |input| {
            select_addresses(
                input,
                BTreeMap::from([(7, physical("Wi-Fi 2")), (16, physical("Ethernet"))]),
                BTreeSet::from([7, 11, 12]),
            )
        };
        let result = choose(input.clone());
        assert_eq!(
            result[0],
            LanAddress {
                address: "133.26.237.171".into(),
                interface_alias: "Wi-Fi 2".into()
            }
        );
        assert_eq!(result.len(), 5);
        for ip in ["172.28.224.1", "100.96.0.5", "10.0.0.2"] {
            assert!(result
                .iter()
                .skip(1)
                .any(|candidate| candidate.address == ip));
        }
        input.reverse();
        assert_eq!(choose(input.clone()), result);
        let wired = select_addresses(
            input,
            BTreeMap::from([(7, physical("Wi-Fi 2")), (16, physical("Ethernet"))]),
            BTreeSet::from([16, 11, 12]),
        );
        assert_eq!(wired[0].address, "192.168.1.2");
        assert_eq!(
            select_addresses(vec![vpn], BTreeMap::new(), BTreeSet::new()).len(),
            1
        );
    }
    #[test]
    fn excludes_unusable_and_disconnected_addresses_but_keeps_global_and_private() {
        let mut input = [
            "127.0.0.1",
            "127.2.3.4",
            "169.254.0.1",
            "169.254.255.254",
            "0.0.0.0",
            "255.255.255.255",
            "224.0.0.1",
            "239.255.255.250",
            "192.168.1.3",
            "133.26.237.171",
        ]
        .iter()
        .enumerate()
        .map(|(i, ip)| interface(i as u32, "Ethernet", ip))
        .collect::<Vec<_>>();
        let mut down = interface(99, "Disconnected", "192.168.2.3");
        down.oper_status = IfOperStatus::Down;
        input.push(down);
        let result = select_addresses(input, BTreeMap::new(), BTreeSet::new());
        assert_eq!(
            result
                .iter()
                .map(|v| v.address.as_str())
                .collect::<Vec<_>>(),
            ["133.26.237.171", "192.168.1.3"]
        );
        for (prefixlen, expected) in [(24, 0), (31, 1), (32, 1)] {
            let mut candidate = interface(prefixlen as u32, "VPN", "10.0.0.255");
            if let IfAddr::V4(ip) = &mut candidate.addr {
                ip.prefixlen = prefixlen;
                ip.broadcast = Some(ip.ip);
            }
            assert_eq!(
                select_addresses(vec![candidate], BTreeMap::new(), BTreeSet::new()).len(),
                expected,
                "prefix /{prefixlen}"
            );
        }
    }
    #[cfg(windows)]
    #[test]
    fn only_live_ipv4_default_gateways_prioritize_the_matching_interface() {
        use windows_sys::Win32::{
            NetworkManagement::IpHelper::MIB_IPFORWARD_ROW2,
            Networking::WinSock::{
                AF_INET, AF_INET6, IN_ADDR, IN_ADDR_0, SOCKADDR_IN, SOCKADDR_INET,
            },
        };
        let route = |index, prefix, next_hop: [u8; 4]| MIB_IPFORWARD_ROW2 {
            InterfaceIndex: index,
            ValidLifetime: 60,
            DestinationPrefix: windows_sys::Win32::NetworkManagement::IpHelper::IP_ADDRESS_PREFIX {
                PrefixLength: prefix,
                ..Default::default()
            },
            NextHop: SOCKADDR_INET {
                Ipv4: SOCKADDR_IN {
                    sin_family: AF_INET,
                    sin_addr: IN_ADDR {
                        S_un: IN_ADDR_0 {
                            S_addr: u32::from_ne_bytes(next_hop),
                        },
                    },
                    ..Default::default()
                },
            },
            ..Default::default()
        };
        let expired = MIB_IPFORWARD_ROW2 {
            ValidLifetime: 0,
            ..route(5, 0, [10, 0, 0, 1])
        };
        let immortal = MIB_IPFORWARD_ROW2 {
            Immortal: true,
            ValidLifetime: 0,
            ..route(6, 0, [10, 0, 0, 1])
        };
        let ipv6 = MIB_IPFORWARD_ROW2 {
            NextHop: SOCKADDR_INET {
                si_family: AF_INET6,
            },
            ..route(7, 0, [10, 0, 0, 1])
        };
        assert_eq!(
            gateway_indices(&[
                route(24, 0, [133, 26, 237, 1]),
                route(9, 0, [0, 0, 0, 0]),
                route(12, 24, [172, 28, 224, 1]),
                expired,
                immortal,
                ipv6
            ]),
            BTreeSet::from([6, 24])
        );
    }
}
