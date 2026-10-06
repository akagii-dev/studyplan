import { FormEvent, useEffect, useRef, useState } from 'react';
import { ProgressValue } from './ProgressValue';
import { studyInputLabel } from '../domain/studyProgress';
import { Props } from './common';
import { remaining, today } from '../domain/model';
import { StudyRecordForm, StudyCountInput } from './StudyRecordForm';
import { useRecordInput, useStudyRecord } from '../hooks/useStudyRecord';
import { todayStudyRows } from '../domain/todayProgress';
import { latestReceipt } from '../domain/progressReceipt';
import { usePlanningClock } from '../hooks/usePlanningClock';
import { ProgressReceiptView, receiptDetailLabel, receiptOutcome } from './ProgressReceiptView';

export interface RecordTarget {
  materialId: string;
  round: number;
  token: number;
}
export function TodayRecorder({ state, update, target }: Props & { target?: RecordTarget | null }) {
  const rows = todayStudyRows(state);
  usePlanningClock();
  const inputRefs = useRef(new Map<string, HTMLInputElement>());
  const handled = useRef<number | null>(null);
  const outsideRef = useRef<HTMLDetailsElement>(null);
  const date = today();
  const [drafts, setDrafts] = useRecordInput<Record<string, string>>(`today/${date}/inputs`, {});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savedRecord, setSavedRecord] = useState<{ id: string; count: number; unit: string } | null>(null);
  const [outsideMaterial, setOutsideMaterial] = useRecordInput('today/material', state.settings.materials[0]?.id ?? '');
  const [outsideRound, setOutsideRound] = useRecordInput('today/round', 0);
  const { busy, save: record } = useStudyRecord(update, `today/${date}`);
  const key = (materialId: string, round: number) => JSON.stringify([materialId, round]);
  const savedEntry = state.records.find(record => record.id === savedRecord?.id);
  const savedProgress = rows.find(row => row.materialId === savedEntry?.materialId && row.round === savedEntry?.round)?.progress;

  useEffect(() => {
    if (!target || handled.current === target.token) return;
    const row = rows.find((r) => r.materialId === target.materialId && r.round === target.round);
    const id = key(target.materialId, target.round);
    if (row) {
      setDrafts((current) => ({
        ...current,
        [id]: current[id] || String(Math.min(row.progress.prefill, remaining(state, row.materialId, row.round))),
      }));
    } else {
      if (!state.settings.materials.some(material => material.id === target.materialId && material.rounds[target.round])) return;
      setOutsideMaterial(target.materialId);
      setOutsideRound(target.round);
      if (outsideRef.current) outsideRef.current.open = true;
    }
    // AppShell restores its heading in a frame; the explicit recording target wins afterwards.
    const timer = window.setTimeout(() => {
      handled.current = target.token;
      const input = row ? inputRefs.current.get(id) :
        outsideRef.current?.querySelector<HTMLInputElement>('input[inputmode="numeric"]');
      input?.focus();
      input?.scrollIntoView({ block: 'center' });
      input?.select();
    }, 50);
    return () => window.clearTimeout(timer);
  }, [target, state]);

  async function save(event: FormEvent | undefined, materialId: string, round: number) {
    event?.preventDefault();
    const id = key(materialId, round);
    setErrors((current) => ({ ...current, [id]: '' }));
    setSavedRecord(null);
    const text = drafts[id] ?? '';
    try {
      const result = await record({ date, materialId, round, text });
      if (!result) return;
      setDrafts((current) => current[id] === text ? { ...current, [id]: '' } : current);
      setSavedRecord(result);
    } catch (error) {
      setErrors((current) => ({ ...current, [id]: error instanceof Error ? error.message : String(error) }));
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
                    {studyInputLabel(row.unit)}
                    <StudyCountInput
                      ref={(node) => {
                        if (node) inputRefs.current.set(id, node);
                        else inputRefs.current.delete(id);
                      }}
                      type="text"
                      inputMode="numeric"
                      value={drafts[id] ?? ''}
                      disabled={busy}
                      aria-label={`${row.materialName} ${row.round + 1}周目の${studyInputLabel(row.unit)}（${row.unit}）`}
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
      <details className="outside-record" ref={outsideRef}>
        <summary>予定外の学習を記録</summary>
        {state.settings.materials.length ? (
          <StudyRecordForm state={state} reference={date} fixedDate busy={busy}
            value={{ date, materialId: outsideMaterial, round: outsideRound, text: drafts[key(outsideMaterial, outsideRound)] ?? '' }}
            onChange={(value) => {
              setOutsideMaterial(value.materialId); setOutsideRound(value.round);
              setDrafts((current) => ({ ...current, [key(value.materialId, value.round)]: value.text }));
              setErrors((current) => ({ ...current, [key(value.materialId, value.round)]: '' }));
            }}
            onSubmit={() => void save(undefined, outsideMaterial, outsideRound)}
            error={errors[key(outsideMaterial, outsideRound)] ?? ''} />
        ) : (
          <p>先に問題集を登録してください。</p>
        )}
      </details>
      {savedRecord && (
        <div className="daily-record-saved" role="status">
          <p>
            {savedRecord.count}{savedRecord.unit}を記録しました。
            {savedProgress?.text}
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
