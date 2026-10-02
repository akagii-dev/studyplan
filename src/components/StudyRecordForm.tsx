import { useConfirmedRecordRetry } from '../hooks/useStudyRecord';
import type { ComponentPropsWithRef } from 'react';
import { completed, remaining, type AppState } from '../domain/model';
import { materialUnit } from '../domain/calendarQuantity';
import { parseNumberInput } from '../domain/numeric';
import { Field } from './common';

/** One Enter submits one record; composition and held keys never submit. */
export function StudyCountInput(props: ComponentPropsWithRef<'input'>) {
  return <input {...props} type="text" inputMode="numeric" onKeyDown={(event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    event.currentTarget.form?.requestSubmit();
  }} />;
}

export interface StudyRecordFields {
  date: string;
  materialId: string;
  round: number;
  text: string;
}

export function StudyRecordForm({ state, value, onChange, onSubmit, reference, fixedDate = false, busy = false, error = '' }: {
  state: AppState;
  value: StudyRecordFields;
  onChange: (value: StudyRecordFields) => void;
  onSubmit: () => void;
  reference: string;
  fixedDate?: boolean;
  busy?: boolean;
  error?: string;
}) {
  const material = state.settings.materials.find((item) => item.id === value.materialId);
  const unit = materialUnit(material?.unit);
  const left = material?.rounds[value.round] ? remaining(state, material.id, value.round) : 0;
  const confirmedRetry = useConfirmedRecordRetry(state, value);
  let valid = !!material?.rounds[value.round] && !!value.date && value.date <= reference;
  try { parseNumberInput(value.text, 0, left, 1); } catch { valid = valid && confirmedRetry; }
  return <form className="study-record-form" noValidate onSubmit={(event) => { event.preventDefault(); if (!busy) onSubmit(); }}>
    <Field label="記録対象日">
      <input type="date" max={reference} value={value.date} readOnly={fixedDate} disabled={busy}
        onChange={(event) => onChange({ ...value, date: event.target.value })} />
    </Field>
    <div className="two">
      <Field label="教材">
        <select value={value.materialId} disabled={busy} onChange={(event) => onChange({ ...value, materialId: event.target.value, round: 0, text: '' })}>
          <option value="" disabled>教材を選択</option>
          {state.settings.materials.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </Field>
      <Field label="周回">
        <select value={value.round} disabled={busy} onChange={(event) => onChange({ ...value, round: Number(event.target.value), text: '' })}>
          {material?.rounds.map((_, round) => <option key={round} value={round}>{round + 1}周目</option>)}
        </select>
      </Field>
    </div>
    {material?.rounds[value.round] && <div className="progress-summary">
      <span>完了 <b>{completed(state, material.id, value.round)}</b>{unit}</span>
      <span>残り <b>{left}</b>{unit}</span>
    </div>}
    <label className="field">
      {unit === '問' ? '追加問題数（1問単位）' : `追加量（1${unit}単位）`}
      <StudyCountInput value={value.text} disabled={busy} aria-invalid={!!error || undefined}
        onChange={(event) => onChange({ ...value, text: event.target.value })} />
    </label>
    <p>今回の追加分を記録します。0{unit}も報告済みになります。</p>
    {error && <p className="error" role="alert">{error}</p>}
    <button data-submit className="primary" type="submit" disabled={!valid || busy}>{busy ? '保存中…' : '記録する'}</button>
  </form>;
}
