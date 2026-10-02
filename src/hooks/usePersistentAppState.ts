import { useCallback, useEffect, useRef, useState } from 'react';
import { Props } from '../components/common';
import { AppState, today } from '../domain/model';
import { reconcilePlanning } from '../domain/planning';
import { validateMaterialChanges } from '../domain/materialConstraints';
import { currentPresentation, samePlanningSettings, sameSettings } from '../domain/planAudit';
import {
  PlanningInputError,
  planningInputIssues,
  planningInputMessage,
} from '../domain/setupIssues';
import { exportBackup, isRevisionConflict, loadRevision, loadState, restoreBackup, saveState } from '../store';
import { lanMode } from '../lan';
import { useCloseAfterSave } from './useCloseAfterSave';

export function usePersistentAppState() {
  const [state, setState] = useState<AppState | null>(null);
  const dataRef = useRef<AppState | null>(null);
  const revision = useRef(0);
  const saveGeneration = useRef(0);
  const queue = useRef(Promise.resolve());
  const pendingSaves = useRef(0);
  const [error, setError] = useState('');
  const planningErrorFrom = useRef<string | undefined | null>(null);
  const failedRecordSave = useRef<{ message: string; records: AppState['records'] } | null>(null);
  const confirmSavedRecord = useCallback((id: string) => {
    const failure = failedRecordSave.current;
    if (!failure?.records.some(record => record.id === id)) return;
    // A retry may only dismiss its own save failure after all affected records are confirmed.
    const matches = failure.records.every(expected => dataRef.current?.records.some(record =>
      record.id === expected.id && record.date === expected.date && record.materialId === expected.materialId &&
      record.round === expected.round && record.count === expected.count && record.cancelled === expected.cancelled));
    if (!matches) return;
    setError(current => current === failure.message ? '' : current);
    failedRecordSave.current = null;
  }, []);
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
  const autoReconcileSuppressed = useRef(false);
  const [boundarySignal, setBoundarySignal] = useState(0);
  const [reloadEpoch, setReloadEpoch] = useState(0);
  const [recovery, setRecovery] = useState<{ checking: boolean; detail: string; preserveInput?: boolean; conflict?: boolean } | null>(null);
  const [externalRevision, setExternalRevision] = useState<number | null>(null);
  const externalRef = useRef<number | null>(null);
  const [connectionError, setConnectionError] = useState('');
  const checkingRevision = useRef(false);
  const pollRevision = useRef<() => Promise<void>>(async () => {});
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
        setConnectionError('');
        externalRef.current = null;
        setExternalRevision(null);
        autoReconcileSuppressed.current = false;
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
  const readSavedState = (retryReconcile = true) => {
    if (recoveryRequest.current) return recoveryRequest.current;
    setRecovery((previous) => ({ ...previous, checking: true, detail: '' }));
    const request = loadState()
      .then((stored) => {
        revision.current = stored.revision;
        dataRef.current = stored.data;
        setState(stored.data);
        setReloadEpoch((epoch) => epoch + 1);
        setSaved(stored.revision > 0);
        externalRef.current = null;
        setExternalRevision(null);
        setConnectionError('');
        unconfirmed.current = false;
        if (retryReconcile) autoReconcileSuppressed.current = false;
        setRecovery(null);
        if (retryReconcile)
          showError(
            '保存済みの内容を読み直しました。最後の変更を確認し、反映されていない場合は入力し直してください。',
          );
      })
      .catch((error) => setRecovery((previous) => ({ ...previous, checking: false, detail: String(error) })))
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
    if (externalRef.current !== null && externalRef.current > revision.current) {
      showError('別の端末で更新されました。入力は保持しています。最新の内容を読み込んでから変更してください。');
      return Promise.reject(new Error('別の端末で更新されました。'));
    }
    const previousRecords = dataRef.current!.records;
    let next: AppState;
    try {
      next = fn(dataRef.current!);
      if (next === dataRef.current) return Promise.resolve();
      if (!sameSettings(dataRef.current!.settings, next.settings)) {
        const now = new Date();
        validateMaterialChanges(
          dataRef.current!,
          next.settings,
          today(),
          now.getHours() * 60 + now.getMinutes(),
        );
        const planningChanged = !samePlanningSettings(dataRef.current!.settings, next.settings);
        const presentationProposal = next.proposal ?? dataRef.current!.proposal;
        const syncPlanPresentation =
          !planningChanged &&
          !!next.plan?.settingsSnapshot &&
          samePlanningSettings(next.plan.settingsSnapshot, dataRef.current!.settings);
        const syncProposalPresentation =
          !planningChanged &&
          !!presentationProposal?.plan.settingsSnapshot &&
          samePlanningSettings(
            presentationProposal.plan.settingsSnapshot,
            dataRef.current!.settings,
          );
        next = {
          ...next,
          settingsUpdatedAt:
            next.settingsUpdatedAt !== dataRef.current!.settingsUpdatedAt
              ? next.settingsUpdatedAt
              : new Date().toISOString(),
          plan:
            syncPlanPresentation && next.plan?.settingsSnapshot
              ? {
                  ...next.plan,
                  settingsSnapshot: currentPresentation(next.plan.settingsSnapshot, next.settings),
                }
              : next.plan,
          proposal:
            planningChanged ||
            !syncProposalPresentation ||
            !presentationProposal?.plan.settingsSnapshot
              ? planningChanged
                ? null
                : presentationProposal
              : {
                  ...presentationProposal,
                  plan: {
                    ...presentationProposal.plan,
                    settingsSnapshot: currentPresentation(
                      presentationProposal.plan.settingsSnapshot,
                      next.settings,
                    ),
                  },
                },
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
        autoReconcileSuppressed.current = true;
        setSaved(false);
        failedRecordSave.current = { message: String(e), records: next.records.filter(record =>
          !previousRecords.some(previous => JSON.stringify(previous) === JSON.stringify(record))) };
        showError(String(e));
        if (lanMode || isRevisionConflict(e))
          setRecovery({ checking: false, detail: String(e), preserveInput: true, conflict: isRevisionConflict(e) });
        else await readSavedState(false);
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
        autoReconcileSuppressed.current = false;
      })
      .catch(async (e) => {
        saveGeneration.current += 1;
        unconfirmed.current = true;
        autoReconcileSuppressed.current = true;
        setSaved(false);
        showError(String(e));
        if (lanMode || isRevisionConflict(e))
          setRecovery({ checking: false, detail: String(e), preserveInput: true, conflict: isRevisionConflict(e) });
        else await readSavedState(false);
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
  const reloadLatest = async () => {
    if (exclusive.current) return;
    exclusive.current = true;
    try { await queue.current; await readSavedState(); }
    finally { exclusive.current = false; }
  };
  pollRevision.current = async () => {
    if (checkingRevision.current || !dataRef.current || pendingSaves.current || exclusive.current || unconfirmed.current) return;
    checkingRevision.current = true;
    const before = revision.current;
    try {
      const current = await loadRevision();
      if (!mounted.current) return;
      setConnectionError('');
      // Never adopt a revision without its data, or replace an in-flight/local form.
      if (current !== null && current > revision.current && before === revision.current) {
        externalRef.current = current;
        setExternalRevision(current);
      }
    } catch (error) {
      if (mounted.current && lanMode) setConnectionError(String(error));
    } finally { checkingRevision.current = false; }
  };
  useEffect(() => {
    const check = () => { if (document.visibilityState === 'visible') void pollRevision.current(); };
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    const timer = window.setInterval(check, 15_000);
    const leaving = (event: BeforeUnloadEvent) => {
      if (pendingSaves.current || unconfirmed.current) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', leaving);
    return () => {
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('beforeunload', leaving);
      window.clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    const onBoundary = () => setBoundarySignal((n) => n + 1);
    const onVisible = () => {
      if (document.visibilityState === 'visible') onBoundary();
    };
    window.addEventListener('focus', onBoundary);
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(onBoundary, 60_000);
    return () => {
      window.removeEventListener('focus', onBoundary);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (loading || restoring || !state || !dataRef.current || pendingSaves.current ||
      exclusive.current || unconfirmed.current || autoReconcileSuppressed.current || externalRef.current !== null) return;
    const next = reconcilePlanning(dataRef.current);
    if (next !== dataRef.current) void update(() => next).catch(() => {});
  // This is an explicit load/save-completion/visibility/date boundary, not a render calculation.
  }, [state, loading, saving, restoring, boundarySignal]);
  const exportSaved = async (path: string) => {
    await queue.current;
    await exportBackup(path);
  };
  return {
    state,
    update,
    error,
    setError: showError,
    confirmSavedRecord,
    startupError,
    loading,
    initialize,
    saving,
    saved,
    restoring,
    recovery,
    closing,
    closeWithoutSaving,
    readSavedState: reloadLatest,
    restore,
    readSaved,
    exportSaved,
    externalRevision,
    connectionError,
    checkConnection: () => void pollRevision.current(),
    reloadEpoch,
  };
}
