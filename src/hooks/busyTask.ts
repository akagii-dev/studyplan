import { useSyncExternalStore } from 'react';

// Planning work runs synchronously on the main thread. Show the indicator and let the
// browser paint it before the work starts, so a long calculation does not look frozen.
let running = 0;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

// Hidden or minimized windows pause animation frames; never wait for one indefinitely.
const nextPaint = () =>
  new Promise<void>((resolve) => {
    const fallback = setTimeout(resolve, 50);
    if (typeof requestAnimationFrame === 'function')
      requestAnimationFrame(() => setTimeout(() => { clearTimeout(fallback); resolve(); }, 0));
  });

/** Runs a heavy planning operation behind the shared progress indicator. */
export async function runBusyTask<T>(task: () => Promise<T>): Promise<T> {
  running += 1;
  notify();
  try {
    await nextPaint();
    return await task();
  } finally {
    running -= 1;
    notify();
  }
}

export function useBusyTask(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => running > 0,
    () => false,
  );
}
