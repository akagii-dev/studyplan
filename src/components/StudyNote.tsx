import { useContext, useState, type FormEvent } from 'react';
import { Field, type Props } from './common';
import { deleteRecordInput, StudyRecordMemory, useRecordInput } from '../hooks/useStudyRecord';

const key = 'study-note';
const empty = { nextTerm: '', memo: '' };
export function StudyNote({ state, update }: Props) {
  // Reuse session input memory so a failed save/reload cannot discard typed text.
  const memory = useContext(StudyRecordMemory);
  const [value, setValue] = useRecordInput(key, state.studyNote ?? empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const saved = state.studyNote ?? empty;
  const changed = value.nextTerm !== saved.nextTerm || value.memo !== saved.memo;
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const revision = memory?.revisions.get(key);
    setBusy(true); setError('');
    try {
      await update(current => ({ ...current, studyNote: value }));
      if (memory && memory.revisions.get(key) === revision) deleteRecordInput(memory, key);
    } catch {
      setError('保存できませんでした。入力を保持しています。');
    } finally { setBusy(false); }
  }
  return <form className="card study-note" onSubmit={event => void save(event)} aria-label="ターム・メモ">
    <Field label="次のターム："><input type="text" name="nextTerm" autoComplete="off" maxLength={200}
      value={value.nextTerm} onChange={event => setValue({ ...value, nextTerm: event.target.value })} /></Field>
    <Field label="メモ"><textarea name="studyMemo" rows={2} maxLength={4000}
      value={value.memo} onChange={event => setValue({ ...value, memo: event.target.value })} /></Field>
    <div className="actions"><button type="submit" disabled={busy}>{busy ? '保存中…' : '保存'}</button>
      {changed && <span className="hint">未保存</span>}</div>
    {error && <p role="alert" className="error">{error}</p>}
  </form>;
}
