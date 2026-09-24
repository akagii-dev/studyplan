import { useSyncExternalStore } from 'react';
import { pwaMode } from './pwa';

type Status = {
  offline: 'checking' | 'ready' | 'incomplete' | 'unsupported';
  host: 'checking' | 'reachable' | 'unreachable';
  update: boolean;
};
let snapshot: Status = { offline: 'checking', host: 'checking', update: false };
const listeners = new Set<() => void>();
const publish = (next: Partial<Status>) => {
  snapshot = { ...snapshot, ...next };
  listeners.forEach((listener) => listener());
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const usePwaStatus = () =>
  useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  );
let registration: ServiceWorkerRegistration | undefined;
let started = false;
let hostRequest = 0;
const base = import.meta.env.BASE_URL;

async function checkCache(repair = false) {
  if (!isSecureContext || !('serviceWorker' in navigator)) {
    publish({ offline: 'unsupported' });
    return;
  }
  const controller = navigator.serviceWorker?.controller;
  if (!controller) {
    publish({ offline: 'incomplete' });
    return;
  }
  const ready = await new Promise<boolean>((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      channel.port1.close();
      resolve(false);
    }, 10000);
    channel.port1.onmessage = ({ data }) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(data?.type === 'OFFLINE_STATUS' && data.ready === true);
    };
    controller.postMessage({ type: repair ? 'REPAIR_OFFLINE' : 'CHECK_OFFLINE' }, [channel.port2]);
  });
  publish({ offline: ready ? 'ready' : 'incomplete' });
}
async function probeHost() {
  const request = ++hostRequest;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 5000);
  try {
    const response = await fetch(`${base}release-files.json`, {
      cache: 'no-store',
      signal: abort.signal,
    });
    const value = response.ok ? await response.json() : null;
    if (request === hostRequest)
      publish({ host: value?.format === 'StudyPlanPwaRelease' ? 'reachable' : 'unreachable' });
  } catch {
    if (request === hostRequest) publish({ host: 'unreachable' });
  } finally {
    clearTimeout(timer);
  }
}
function watchRegistration(value: ServiceWorkerRegistration) {
  registration = value;
  const watch = () => {
    const worker = value.installing;
    worker?.addEventListener('statechange', () => {
      publish({ update: !!value.waiting });
      if (worker.state === 'redundant') void checkCache();
    });
    publish({ update: !!value.waiting });
  };
  value.addEventListener('updatefound', watch);
  watch();
}
export async function checkPwaStatus() {
  await Promise.all([checkCache(), probeHost()]);
  if (snapshot.host === 'reachable' && isSecureContext && 'serviceWorker' in navigator) {
    try {
      if (snapshot.offline === 'incomplete') await checkCache(true);
      if (!registration)
        void navigator.serviceWorker
          .register(`${base}sw.js`, { scope: base, updateViaCache: 'none' })
          .then(watchRegistration)
          .catch(() => publish({ offline: 'incomplete' }));
      else
        void registration
          .update()
          .then(() => publish({ update: !!registration?.waiting }))
          .catch(() => {});
      publish({ update: !!registration?.waiting });
    } catch {
      /* Failed updates never turn local-data saves into errors. */
    }
  }
}
export function startPwa() {
  if (!pwaMode || started) return;
  started = true;
  if (!isSecureContext || !('serviceWorker' in navigator)) {
    publish({ offline: 'unsupported' });
    void probeHost();
    return;
  }
  navigator.serviceWorker.addEventListener('controllerchange', () => void checkCache());
  window.addEventListener('online', () => void checkPwaStatus());
  window.addEventListener('offline', () => void checkPwaStatus());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkPwaStatus();
  });
  void navigator.serviceWorker
    .register(`${base}sw.js`, { scope: base, updateViaCache: 'none' })
    .then(watchRegistration)
    .catch(() => publish({ offline: 'incomplete' }))
    .finally(() => void checkPwaStatus());
}
