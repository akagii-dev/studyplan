import { useEffect, useRef, useState, type RefObject } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

export function useCloseAfterSave(
  queue: RefObject<Promise<void>>,
  pending: RefObject<number>,
  generation: RefObject<number>,
  unconfirmed: RefObject<boolean>,
  onError: (message: string) => void,
) {
  const [closing, setClosing] = useState(false);
  const inFlight = useRef(false);
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        if (disposed || inFlight.current) {
          event.preventDefault();
          return;
        }
        if (unconfirmed.current) {
          event.preventDefault();
          onError(
            '保存状態を確認できないため終了を中止しました。確認画面から再試行または終了を選んでください。',
          );
          return;
        }
        inFlight.current = true;
        const started = generation.current;
        try {
          await invoke('save_window_state');
          if (!pending.current) return;
          setClosing(true);
          // Wait for every queued edit, including any already-dispatched input handlers.
          while (pending.current) await queue.current;
          if (generation.current !== started) {
            event.preventDefault();
            onError(
              '保存に失敗したため終了を中止しました。保存済みの内容を確認し、最後の変更を入力し直してください。',
            );
          }
        } catch (error) {
          event.preventDefault();
          onError(`保存を確認できないため終了を中止しました。${String(error)}`);
        } finally {
          inFlight.current = false;
          setClosing(false);
        }
        // Tauri destroys the window only after this async handler resolves without preventDefault.
      })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch((error) => {
        if (!disposed)
          onError(
            `終了時の保存確認を開始できませんでした。保存済みを確認してから終了してください。${String(error)}`,
          );
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [queue, pending, generation, unconfirmed, onError]);
  return {
    closing,
    closeWithoutSaving: async () => {
      if (!unconfirmed.current || pending.current)
        throw new Error('保存処理が終わるまでお待ちください。');
      // This bypass is available only after the user explicitly confirms the loss of unsaved input.
      await getCurrentWindow().destroy();
    },
  };
}
