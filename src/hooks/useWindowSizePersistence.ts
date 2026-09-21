import { isTauri } from '@tauri-apps/api/core';
import { LogicalSize } from '@tauri-apps/api/dpi';
import { currentMonitor, getCurrentWindow } from '@tauri-apps/api/window';
import { RefObject, useEffect, useRef } from 'react';
import { AppState, WindowSize } from '../domain/model';
import { DEFAULT_WINDOW_SIZE, fitWindowSize } from '../domain/windowSize';
import { Update } from '../components/common';

const sameSize = (a: WindowSize | undefined, b: WindowSize) =>
  a?.width === b.width && a.height === b.height;

export function useWindowSizePersistence(
  state: AppState | null,
  update: Update,
  beforeClose: RefObject<() => Promise<void>>,
) {
  const stateRef = useRef(state);
  const updateRef = useRef(update);
  stateRef.current = state;
  updateRef.current = update;
  const ready = state !== null;

  useEffect(() => {
    if (!ready || !isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending: WindowSize | undefined;
    const appWindow = getCurrentWindow();
    const persist = async (size: WindowSize) => {
      if (sameSize(stateRef.current?.windowSize, size)) return;
      await updateRef.current((current) => ({ ...current, windowSize: size }));
    };
    const normalSize = async (): Promise<WindowSize | undefined> => {
      if ((await appWindow.isMaximized()) || (await appWindow.isMinimized())) return undefined;
      const [physical, scale] = await Promise.all([appWindow.innerSize(), appWindow.scaleFactor()]);
      return {
        width: Math.round(physical.width / scale),
        height: Math.round(physical.height / scale),
      };
    };
    const flush = async () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      const size = pending ?? (await normalSize());
      pending = undefined;
      if (size) await persist(size);
    };
    beforeClose.current = flush;

    void (async () => {
      const [monitor, outer, inner, scale] = await Promise.all([
        currentMonitor(),
        appWindow.outerSize(),
        appWindow.innerSize(),
        appWindow.scaleFactor(),
      ]);
      if (disposed) return;
      const frame = {
        width: Math.max(0, (outer.width - inner.width) / scale),
        height: Math.max(0, (outer.height - inner.height) / scale),
      };
      const workArea = monitor?.workArea.size.toLogical(monitor.scaleFactor);
      const available = workArea
        ? {
            width: Math.max(1, Math.floor(workArea.width - frame.width)),
            height: Math.max(1, Math.floor(workArea.height - frame.height)),
          }
        : undefined;
      const savedSize = stateRef.current?.windowSize;
      const requested = savedSize ?? DEFAULT_WINDOW_SIZE;
      const fitted = fitWindowSize(requested, available);
      const current = {
        width: Math.round(inner.width / scale),
        height: Math.round(inner.height / scale),
      };
      let initialSize = savedSize ? undefined : current;
      if ((savedSize || !sameSize(requested, fitted)) && !sameSize(current, fitted)) {
        await appWindow.setSize(new LogicalSize(fitted.width, fitted.height));
      }
      if (!sameSize(requested, fitted)) await persist(fitted);
      if (disposed) return;
      unlisten = await appWindow.onResized(async ({ payload }) => {
        if ((await appWindow.isMaximized()) || (await appWindow.isMinimized())) return;
        const factor = await appWindow.scaleFactor();
        const size = {
          width: Math.round(payload.width / factor),
          height: Math.round(payload.height / factor),
        };
        if (initialSize && sameSize(initialSize, size)) return;
        initialSize = undefined;
        pending = size;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void flush().catch(() => {}), 250);
      });
      if (disposed) unlisten();
    })().catch(() => {});

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      unlisten?.();
      beforeClose.current = async () => {};
    };
  }, [beforeClose, ready]);
}
