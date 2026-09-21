import { useCallback, useEffect, useRef, useState } from 'react';
import { Props } from '../components/common';
import { AppState } from '../domain/model';
import { sameSettings } from '../domain/planAudit';
import {
  PlanningInputError,
  planningInputIssues,
  planningInputMessage,
} from '../domain/setupIssues';
import { exportBackup, loadState, restoreBackup, saveState } from '../store';
import { useCloseAfterSave } from './useCloseAfterSave';
import { useWindowSizePersistence } from './useWindowSizePersistence';

export function usePersistentAppState() {
  const [state, setState] = useState<AppState | null>(null);
  const dataRef = useRef<AppState | null>(null);
  const revision = useRef(0);
  const saveGeneration = useRef(0);
  const queue = useRef(Promise.resolve());
  const pendingSaves = useRef(0);
  const [error, setError] = useState('');
  const planningErrorFrom = useRef<string | undefined | null>(null);
  const [startupError, setStartupError] = useState('');
  const [loading, setLoading] = useState(true);
  const loadRequest = useRef<Promise<void> | null>(null);
  const mounted = useRef(false);
  const [saving, setSaving] = useState(0);
  const [saved, setSaved] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const exclusive = useRef(false);
  const unconfirmed = useRef(false);
  const recoveryRequest = useRef<Promise<void> | null>(null);
  const [recovery, setRecovery] = useState<{ checking: boolean; detail: string } | null>(null);
  const beforeClose = useRef<() => Promise<void>>(async () => {});
  const showError = useCallback((message: string) => {
    planningErrorFrom.current = null;
    setError(message);
  }, []);
  const dismissError = useCallback(() => showError(''), [showError]);
  const { closing, closeWithoutSaving } = useCloseAfterSave(
    queue,
    pendingSaves,
    saveGeneration,
    unconfirmed,
    showError,
    beforeClose,
  );
  const initialize = useCallback(() => {
    if (loadRequest.current) return;
    setLoading(true);
    loadRequest.current = loadState()
      .then((e) => {
        if (!mounted.current) return;
        dataRef.current = e.data;
        revision.current = e.revision;
        setState(e.data);
        setSaved(e.revision > 0);
        setStartupError('');
      })
      .catch((e) => {
        if (mounted.current) setStartupError(String(e));
      })
      .finally(() => {
        loadRequest.current = null;
        if (mounted.current) setLoading(false);
      });
  }, []);
  useEffect(() => {
    mounted.current = true;
    initialize();
    return () => {
      mounted.current = false;
    };
  }, [initialize]);
  const readSavedState = () => {
    if (recoveryRequest.current) return recoveryRequest.current;
    setRecovery({ checking: true, detail: '' });
    const request = loadState()
      .then((stored) => {
        revision.current = stored.revision;
        dataRef.current = stored.data;
        setState(stored.data);
        setSaved(stored.revision > 0);
        unconfirmed.current = false;
        setRecovery(null);
        showError(
          '保存済みの内容を読み直しました。最後の変更を確認し、反映されていない場合は入力し直してください。',
        );
      })
      .catch((error) => setRecovery({ checking: false, detail: String(error) }))
      .finally(() => {
        recoveryRequest.current = null;
      });
    recoveryRequest.current = request;
    return request;
  };
  const update: Props['update'] = (fn) => {
    if (unconfirmed.current)
      return Promise.reject(new Error('保存状態を確認できるまで編集できません。'));
    if (exclusive.current) return Promise.reject(new Error('復元が終わるまでお待ちください。'));
    let next: AppState;
    try {
      next = fn(dataRef.current!);
      if (!sameSettings(dataRef.current!.settings, next.settings)) {
        next = {
          ...next,
          settingsUpdatedAt:
            next.settingsUpdatedAt !== dataRef.current!.settingsUpdatedAt
              ? next.settingsUpdatedAt
              : new Date().toISOString(),
          proposal: null,
        };
      }
    } catch (e) {
      if (e instanceof PlanningInputError) {
        planningErrorFrom.current = e.from;
        setError(e.message);
      } else showError(String(e));
      return Promise.reject(e);
    }
    dataRef.current = next;
    setState(next);
    if (planningErrorFrom.current !== null) {
      const remaining = planningInputIssues(next.settings, planningErrorFrom.current);
      if (remaining.length) setError(planningInputMessage(remaining));
      else dismissError();
    }
    pendingSaves.current += 1;
    setSaving((n) => n + 1);
    const generation = saveGeneration.current;
    const task = queue.current
      .then(async () => {
        if (generation !== saveGeneration.current)
          throw new Error(
            '直前の保存に失敗したため、続く変更は保存していません。再入力してください。',
          );
        const result = await saveState(next, revision.current);
        revision.current = result.revision;
        setSaved(true);
      })
      .catch(async (e) => {
        if (generation !== saveGeneration.current) throw e;
        saveGeneration.current += 1;
        unconfirmed.current = true;
        showError(String(e));
        await readSavedState();
        throw e;
      })
      .finally(() => {
        pendingSaves.current -= 1;
        setSaving((n) => n - 1);
      });
    queue.current = task.catch(() => {});
    return task;
  };
  const restore = async (text?: string) => {
    if (unconfirmed.current) throw new Error('保存状態を確認できるまで復元できません。');
    if (exclusive.current) throw new Error('復元が進行中です。');
    exclusive.current = true;
    setRestoring(true);
    pendingSaves.current += 1;
    setSaving((n) => n + 1);
    const generation = saveGeneration.current;
    const task = queue.current
      .then(async () => {
        if (generation !== saveGeneration.current)
          throw new Error('直前の保存に失敗したため復元を中止しました。');
        const result = await restoreBackup(revision.current, text);
        revision.current = result.revision;
        dataRef.current = result.data;
        setState(result.data);
        setSaved(true);
        dismissError();
      })
      .catch(async (e) => {
        saveGeneration.current += 1;
        unconfirmed.current = true;
        showError(String(e));
        await readSavedState();
        throw e;
      })
      .finally(() => {
        exclusive.current = false;
        setRestoring(false);
        pendingSaves.current -= 1;
        setSaving((n) => n - 1);
      });
    queue.current = task.catch(() => {});
    return task;
  };

  const readSaved = async () => {
    await queue.current;
    if (unconfirmed.current) throw new Error('保存状態を確認してから書き出してください。');
    return (await loadState()).data;
  };
  const exportSaved = async (path: string) => {
    await queue.current;
    await exportBackup(path);
  };
  useWindowSizePersistence(state, update, beforeClose);
  return {
    state,
    update,
    error,
    setError: showError,
    startupError,
    loading,
    initialize,
    saving,
    saved,
    restoring,
    recovery,
    closing,
    closeWithoutSaving,
    readSavedState,
    restore,
    readSaved,
    exportSaved,
  };
}
