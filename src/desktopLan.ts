import { invoke, isTauri } from '@tauri-apps/api/core';

export interface DesktopLanStatus {
  active: boolean;
  addresses: string[];
  address: string | null;
  url: string | null;
  key: string | null;
}

export const desktopLanAvailable = () => isTauri();
export const loadDesktopLanStatus = () => invoke<DesktopLanStatus>('lan_host_status');
export const loadDesktopNetworkNames = () => invoke<Record<string, string>>('lan_network_names');
export const lanAddressLabel = (address: string, names: Record<string, string>) =>
  `${address}（${names[address] || 'SSID取得不可'}）`;
export const startDesktopLan = (address: string) =>
  invoke<DesktopLanStatus>('lan_host_start', { address });
export const stopDesktopLan = () => invoke<DesktopLanStatus>('lan_host_stop');
