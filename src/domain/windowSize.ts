import { WindowSize } from './model';

export const DEFAULT_WINDOW_SIZE: WindowSize = { width: 1320, height: 900 };

export function fitWindowSize(saved: WindowSize | undefined, available?: WindowSize): WindowSize {
  const requested = saved ?? DEFAULT_WINDOW_SIZE;
  return {
    width: Math.max(1, Math.round(Math.min(requested.width, available?.width ?? Infinity))),
    height: Math.max(1, Math.round(Math.min(requested.height, available?.height ?? Infinity))),
  };
}
