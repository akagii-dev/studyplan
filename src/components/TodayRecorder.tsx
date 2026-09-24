import { FormEvent, useEffect, useRef, useState } from 'react';
import { ProgressValue } from './ProgressValue';
import { Props } from './common';
import { remaining, today, uid } from '../domain/model';
import { parseNumberInput } from '../domain/numeric';
import { recordAndAdjust } from '../domain/planning';
import { todayStudyRows } from '../domain/todayProgress';
import { latestReceipt } from '../domain/progressReceipt';
import { ProgressReceiptView, receiptDetailLabel, receiptOutcome } from './ProgressReceiptView';

export interface RecordTarget {
  materialId: string;
  round: number;
  token: number;
}
export function TodayRecorder({ state, update, target }: Props & { target?: RecordTarget | null }) {
  const rows = todayStudyRows(state);
  const inputRefs = useRef(new Map<string, HTMLInputElement>());
  const handled = useRef<number | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savedRecord, setSavedRecord] = useState<{ id: string; count: number } | null>(null);
  const [outsideMaterial, setOutsideMaterial] = useState(state.settings.materials[0]?.id ?? '');
  const [outsideRound, setOutsideRound] = useState(0);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const request = useRef(uid());
  const date = today();
  const key = (materialId: string, round: number) => JSON.stringify([materialId, round]);
  const outside = state.settings.materials.find((material) => material.id === outsideMaterial);

  useEffect(() => {
    if (!target || handled.current === target.token) return;
    const row = rows.find((r) => r.materialId === target.materialId && r.round === target.round);
    if (!row) return;
    const id = key(row.materialId, row.round);
    setDrafts((current) => ({
      ...current,
      [id]: String(Math.min(row.progress.prefill, remaining(state, row.materialId, row.round))),
    }));
    // AppShell restores its heading in a frame; the explicit recording target wins afterwards.
    const timer = window.setTimeout(() => {
      handled.current = target.token;
      const input = inputRefs.current.get(id);
      input?.focus();
      input?.scrollIntoView({ block: 'center' });
      input?.select();
    }, 50);
    return () => window.clearTimeout(timer);
  }, [target, state]);

  async function save(event: FormEvent, materialId: string, round: number) {
    event.preventDefault();
    if (sending.current) return;
    const id = key(materialId, round);
    let count: number;
    try {
      count = parseNumberInput(drafts[id] ?? '', 0, remaining(state, materialId, round), 1);
    } catch (error) {
      setErrors((current) => ({ ...current, [id]: (error as Error).message }));
      return;
    }
    sending.current = true;
    setBusy(true);
    setErrors((current) => ({ ...current, [id]: '' }));
    setSavedRecord(null);
    const recordId = request.current;
    const now = new Date().toISOString();
    try {
      await update((current) => {
        const next = recordAndAdjust(current, {
          id: recordId,
          date,
          materialId,
          round,
          count,
          cancelled: false,
          createdAt: now,
          updatedAt: now,
        });
        return next;
      });
      request.current = uid();
      setDrafts((current) => ({ ...current, [id]: '' }));
      setSavedRecord({ id: recordId, count });
    } catch (error) {
      setErrors((current) => ({ ...current, [id]: String(error) }));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      {rows.length ? (
        <div className="daily-record-list" role="list">
          {rows.map((row) => {
            const id = key(row.materialId, row.round);
            return (
              <div className="daily-record-row" role="listitem" key={id}>
                <div className="daily-record-name">
                  <strong>{row.materialName}</strong>
                  <span>{row.round + 1}周目</span>
                </div>
                <div className="daily-record-amounts">
                  <ProgressValue value={row.progress} />
                </div>
                <form
                  className="daily-record-form"
                  onSubmit={(event) => void save(event, row.materialId, row.round)}
                >
                  <label>
                    {row.reported ? '追加分' : '実績'}
                    <input
                      ref={(node) => {
                        if (node) inputRefs.current.set(id, node);
                        else inputRefs.current.delete(id);
                      }}
                      type="text"
                      inputMode="numeric"
                      value={drafts[id] ?? ''}
                      aria-label={`${row.materialName} ${row.round + 1}周目の${row.reported ? '追加分' : '実績'}（${row.unit}）`}
                      onChange={(event) => {
                        setDrafts((current) => ({ ...current, [id]: event.target.value }));
                        setErrors((current) => ({ ...current, [id]: '' }));
                      }}
                    />
                  </label>
                  <span>{row.unit}</span>
                  <button data-submit className="primary" type="submit" disabled={busy}>
                    記録
                  </button>
                </form>
                {row.progress.progressRatio !== null && (
                  <span className="daily-progress-ring">
                    <svg viewBox="0 0 40 40" aria-hidden="true">
                      <circle cx="20" cy="20" r="16" className="ring-track" />
                      <circle
                        cx="20"
                        cy="20"
                        r="16"
                        pathLength="100"
                        className="ring-value"
                        strokeDasharray={`${Math.min(1, row.progress.progressRatio) * 100} 100`}
                      />
                    </svg>
                    <span>{Math.round(row.progress.progressRatio * 100)}%</span>
                  </span>
                )}
                {errors[id] && (
                  <p className="daily-record-error" role="alert">
                    {errors[id]}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p>今日の学習予定はありません。</p>
      )}
      <details className="outside-record">
        <summary>予定外の学習を記録</summary>
        {state.settings.materials.length ? (
          <form onSubmit={(event) => void save(event, outsideMaterial, outsideRound)}>
            <label>
              問題集
              <select
                value={outsideMaterial}
                onChange={(event) => {
                  setOutsideMaterial(event.target.value);
                  setOutsideRound(0);
                }}
              >
                {state.settings.materials.map((material) => (
                  <option key={material.id} value={material.id}>
                    {material.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              周回
              <select
                value={outsideRound}
                onChange={(event) => setOutsideRound(Number(event.target.value))}
              >
                {outside?.rounds.map((_, round) => (
                  <option key={round} value={round}>
                    {round + 1}周目
                  </option>
                ))}
              </select>
            </label>
            <label>
              追加問数
              <input
                type="text"
                inputMode="numeric"
                value={drafts[key(outsideMaterial, outsideRound)] ?? ''}
                onChange={(event) =>
                  setDrafts((current) => ({
                    ...current,
                    [key(outsideMaterial, outsideRound)]: event.target.value,
                  }))
                }
              />
            </label>
            <button data-submit className="primary" type="submit" disabled={busy}>
              記録
            </button>
            {errors[key(outsideMaterial, outsideRound)] && (
              <p className="daily-record-error" role="alert">
                {errors[key(outsideMaterial, outsideRound)]}
              </p>
            )}
          </form>
        ) : (
          <p>先に問題集を登録してください。</p>
        )}
      </details>
      {savedRecord && (
        <div className="daily-record-saved" role="status">
          <p>
            {savedRecord.count}問を記録しました。
            {latestReceipt(state, savedRecord.id) &&
              receiptOutcome(latestReceipt(state, savedRecord.id)!)}
          </p>
          {latestReceipt(state, savedRecord.id) && (
            <details>
              <summary>{receiptDetailLabel(latestReceipt(state, savedRecord.id)!)}</summary>
              <ProgressReceiptView state={state} receipt={latestReceipt(state, savedRecord.id)!} />
            </details>
          )}
        </div>
      )}
    </>
  );
}
