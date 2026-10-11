import { useBusyTask } from '../hooks/busyTask';

/** A small spinning ring at the bottom right while a planning calculation runs. */
export function BusyIndicator() {
  const busy = useBusyTask();
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-50 max-[700px]:bottom-[calc(76px+env(safe-area-inset-bottom,0px))]">
      {busy && (
        <>
          <span
            aria-hidden="true"
            className="block size-6 rounded-full border-[3px] border-line border-t-accent motion-safe:animate-spin"
          />
          <span className="sr-only">計算しています</span>
        </>
      )}
    </div>
  );
}
