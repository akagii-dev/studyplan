import { lanMode } from './lan';

/** HTTPS may cache the static shell; LAN HTTP works without Service Worker. */
export function startLanRuntime(): void {
  if (!lanMode || !window.isSecureContext || !('serviceWorker' in navigator)) return;
  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
    scope: import.meta.env.BASE_URL,
    updateViaCache: 'none',
  }).catch(() => {});
}
