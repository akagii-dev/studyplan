import { invoke, isTauri } from '@tauri-apps/api/core';

export interface DesktopLanAddress {
  address: string;
  interface_alias: string;
}

export interface DesktopLanStatus {
  active: boolean;
  addresses: DesktopLanAddress[];
  address: string | null;
  url: string | null;
  key: string | null;
}

export const desktopLanAvailable = () => isTauri();
export const loadDesktopLanStatus = () => invoke<DesktopLanStatus>('lan_host_status');
export const lanAddressLabel = (candidate: DesktopLanAddress) =>
  `${candidate.interface_alias} — ${candidate.address}`;
export const startDesktopLan = (address: string) =>
  invoke<DesktopLanStatus>('lan_host_start', { address });
export const stopDesktopLan = () => invoke<DesktopLanStatus>('lan_host_stop');
