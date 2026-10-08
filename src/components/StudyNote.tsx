import { useContext, useState, type FormEvent } from 'react';
import { Field, type Props } from './common';
import { deleteRecordInput, StudyRecordMemory, useRecordInput } from '../hooks/useStudyRecord';
import { currentTerms, parallelMaterialLimit, termItemLabel } from '../domain/terms';

const key = 'study-memo';
export function StudyNote({ state, update }: Props) {
  // Reuse session input memory so a failed save/reload cannot discard typed text.
  const memory = useContext(StudyRecordMemory);
  const saved = state.studyNote ?? { nextTerm: '', memo: '' };
  const [memo, setMemo] = useRecordInput(key, saved.memo);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const changed = memo !== saved.memo;
  // Terms follow the approved plan; unapproved settings must not change today's view.
  const settings = state.plan?.settingsSnapshot ?? state.settings;
  const limit = parallelMaterialLimit(settings);
  const { current, next, parallel } = currentTerms({ ...state, settings });
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const revision = memory?.revisions.get(key);
    setBusy(true); setError('');
    try {
      // The legacy free-text term is kept as saved data only; it is no longer edited here.
      await update(current => ({
        ...current,
        studyNote: { nextTerm: current.studyNote?.nextTerm ?? '', memo },
      }));
      if (memory && memory.revisions.get(key) === revision) deleteRecordInput(memory, key);
    } catch {
      setError('保存できませんでした。入力を保持しています。');
    } finally { setBusy(false); }
  }
  return <form className="card study-note" onSubmit={event => void save(event)} aria-label="ターム・メモ">
    <div className="study-term" role="group" aria-label="ターム">
      {limit ? <>
        {current && <p><span>現在のターム：</span><b>{current.items.map(termItemLabel).join('、')}</b></p>}
        <p><span>次のターム：</span><b>{next ? next.items.map(termItemLabel).join('、') : current ? 'なし（最後のターム）' : 'なし'}</b></p>
        {parallel.length > 0 && <p><span>並行：</span><b>{parallel.map(termItemLabel).join('、')}</b></p>}
      </> : <p className="hint">「設定」→教材の「同時に進める教材数」を指定すると、次のタームを表示します。</p>}
    </div>
    <Field label="メモ"><textarea name="studyMemo" rows={2} maxLength={4000}
      value={memo} onChange={event => setMemo(event.target.value)} /></Field>
    <div className="actions"><button type="submit" disabled={busy}>{busy ? '保存中…' : '保存'}</button>
      {changed && <span className="hint">未保存</span>}</div>
    {error && <p role="alert" className="error">{error}</p>}
  </form>;
}
