import { NumberInput } from './NumberInput';
import { materialUnit } from '../domain/calendarQuantity';
import { useState } from 'react';
import { Progress as ProgressRecord, remaining } from '../domain/model';
import { correctAndAdjust } from '../domain/planning';
import { currentProgressAdjustment } from '../domain/progressAdjustment';
import { latestReceipt, progressReceipts } from '../domain/progressReceipt';
import {
  ProgressReceiptView,
  receiptDetailLabel,
  receiptLabel,
  receiptOutcome,
} from './ProgressReceiptView';
import { StudyRecordForm, type StudyRecordFields } from './StudyRecordForm';
import { useRecordInput, useStudyRecord } from '../hooks/useStudyRecord';
import { usePlanningClock } from '../hooks/usePlanningClock';
import { Empty, Props } from './common';
export function Progress({ state, update, onHistory, onReplan }: Props & { onHistory?: () => void; onReplan?: () => void }) {
  const { date: reference } = usePlanningClock();
  const initial = { date: reference, materialId: state.settings.materials[0]?.id ?? '', round: 0, choice: '', custom: '' };
  const form = (state.draft.progress as typeof initial | undefined) ?? initial;
  const [local, setLocal, completeLocal] = useRecordInput<StudyRecordFields | null>('progress/input', null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [savedRecordId, setSavedRecordId] = useState<string | null>(null);
  const { busy, save: record } = useStudyRecord(update, 'progress');
  const numberEdits = (state.draft.numberEdits ?? {}) as Record<string, { text: string; base: string }>;
  const legacyKeys = Object.keys(numberEdits).filter((key) => key.startsWith('progress/') && key.endsWith('/追加問題数（1問単位）'));
  const legacyEdit = legacyKeys.map((key) => numberEdits[key]).find((edit) => edit.base === form.custom);
  const rest = state.settings.materials.some((item) => item.id === form.materialId && item.rounds[form.round]) ? remaining(state, form.materialId, form.round) : 0;
  const value = local ?? { date: form.date, materialId: form.materialId, round: form.round,
    text: form.choice === 'all' ? String(rest) : form.choice && form.choice !== 'other' ? form.choice : legacyEdit?.text ?? form.custom };
  const clearLegacy = (draft: typeof state.draft) => ({ ...draft, numberEdits: Object.fromEntries(
    Object.entries((draft.numberEdits ?? {}) as Record<string, unknown>).filter(([key]) => !legacyKeys.includes(key)),
  ) });
  const change = (next: StudyRecordFields) => {
    setLocal(next); setError(''); setMessage(''); setSavedRecordId(null);
    void update((current) => ({ ...current, draft: { ...clearLegacy(current.draft), progress: {
      date: next.date, materialId: next.materialId, round: next.round, choice: 'other', custom: next.text,
    } } })).catch(() => {});
  };
  async function save() {
    setError(''); setMessage(''); setSavedRecordId(null);
    try {
      const result = await record(value, (next) => ({ ...next, draft: { ...clearLegacy(next.draft), progress: {
        date: value.date, materialId: value.materialId, round: value.round, choice: '', custom: '',
      } } }));
      if (!result) return;
      completeLocal({ ...value, text: '' });
      setMessage('＋' + result.count + result.unit + 'を記録しました。');
      setSavedRecordId(result.id);
    } catch (failure) {
      completeLocal(value);
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }
  return <div className="split"><section className="card">
    <div className="eyebrow">DAILY CHECK-IN</div>
    <h2>進捗の記録</h2>
    <StudyRecordForm state={state} value={value} onChange={change} onSubmit={() => void save()} reference={reference} busy={busy} error={error} />
    {message && <div role="status" className="note progress-result">
      <p>{message}</p>
      {savedRecordId && latestReceipt(state, savedRecordId) && <details>
        <summary>{receiptLabel(latestReceipt(state, savedRecordId)!)} · {receiptDetailLabel(latestReceipt(state, savedRecordId)!)}</summary>
        <ProgressReceiptView state={state} receipt={latestReceipt(state, savedRecordId)!} />
      </details>}
      <div className="actions">
        <button onClick={onHistory}>記録を訂正</button>
        <button onClick={onReplan}>{currentProgressAdjustment(state)?.status === 'failed' ? '今後の予定を確認' : '計画全体を見直す'}</button>
      </div>
    </div>}
  </section></div>;
}
export function History({
  state,
  update,
  onReplan,
  onRecordPast,
}: Props & { onReplan?: () => void; onRecordPast?: () => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [count, setCount] = useState('');
  const [error, err] = useState('');
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState('');
  const [savedReceiptId, setSavedReceiptId] = useState<string | null>(null);
  const activeRecords = state.records.filter((record) => !record.cancelled);
  const receipts = progressReceipts(state);
  async function change(r: ProgressRecord, cancelled: boolean) {
    setResultMessage('');
    setSavedReceiptId(null);
    err('');
    try {
      let receiptId: string | null = null;
      await update((s) => {
        const next = correctAndAdjust(s, r.id, cancelled ? r.count : Number(count), cancelled);
        receiptId = latestReceipt(next, r.id)?.id ?? null;
        return next;
      });
      setEditing(null);
      setCancelId(null);
      err('');
      setSavedReceiptId(receiptId);
      setResultMessage(cancelled ? '記録を取り消しました。' : '記録を訂正しました。');
    } catch (e) {
      err(String(e));
    }
  }
  return (
    <section className="card">
      <div className="eyebrow">PROGRESS HISTORY</div>
      <h2>これまでの記録</h2>
      <button onClick={onRecordPast}>過去日の学習を記録</button>
      {resultMessage && (
        <div className="history-result" role="status">
          <p>
            {resultMessage}{' '}
            {receipts.find((receipt) => receipt.id === savedReceiptId) &&
              receiptOutcome(receipts.find((receipt) => receipt.id === savedReceiptId)!)}
          </p>
          {receipts.find((receipt) => receipt.id === savedReceiptId) && (
            <details>
              <summary>
                {receiptDetailLabel(receipts.find((receipt) => receipt.id === savedReceiptId)!)}
              </summary>
              <ProgressReceiptView
                state={state}
                receipt={receipts.find((receipt) => receipt.id === savedReceiptId)!}
              />
            </details>
          )}
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {['review', 'failed'].includes(currentProgressAdjustment(state)?.status ?? '') && (
        <div className="note">
          {currentProgressAdjustment(state)?.status === 'failed'
            ? '記録は保存済みです。予定調整に失敗しました。'
            : '記録済み・予定の確認が必要です。'}
          <button onClick={onReplan}>
            {currentProgressAdjustment(state)?.status === 'failed'
              ? '今後の予定を確認'
              : '計画全体を見直す'}
          </button>
        </div>
      )}
      {!activeRecords.length ? (
        <Empty>有効な記録はありません。0問の報告も記録するとここに残ります。</Empty>
      ) : (
        <table>
          <thead>
            <tr>
              <th>記録日</th>
              <th>教材 / 周回</th>
              <th>追加完了数</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {[...activeRecords].reverse().map((r) => (
              <tr key={r.id}>
                <td>
                  {r.date}
                  <small className="block">{r.updatedAt !== r.createdAt ? '訂正あり' : ''}</small>
                </td>
                <td>
                  {state.settings.materials.find((m) => m.id === r.materialId)?.name}
                  <small className="block">{r.round + 1}周目</small>
                </td>
                <td>
                  {editing === r.id ? (
                    <NumberInput
                      fieldKey={`correction-${r.id}`}
                      aria-label="訂正後の問題数"
                      type="number"
                      min="0"
                      step="1"
                      value={count}
                      onChange={(e) => setCount(e.target.value)}
                    />
                  ) : (
                    <b>
                      ＋{r.count}
                      {materialUnit(
                        state.settings.materials.find((m) => m.id === r.materialId)?.unit,
                      )}
                    </b>
                  )}
                </td>
                <td>
                  {editing === r.id ? (
                    <div className="actions">
                      <button
                        data-submit
                        className="primary small"
                        disabled={count === ''}
                        onClick={() => change(r, false)}
                      >
                        訂正を保存
                      </button>
                      <button onClick={() => setEditing(null)}>やめる</button>
                    </div>
                  ) : cancelId === r.id ? (
                    <div className="actions">
                      <span>取り消しますか？</span>
                      <button className="text-danger" onClick={() => change(r, true)}>
                        取消を確定
                      </button>
                      <button onClick={() => setCancelId(null)}>やめる</button>
                    </div>
                  ) : (
                    <div className="actions">
                      <button
                        onClick={() => {
                          setEditing(r.id);
                          setCount(String(r.count));
                        }}
                      >
                        訂正
                      </button>
                      <button className="text-danger" onClick={() => setCancelId(r.id)}>
                        取消
                      </button>
                    </div>
                  )}
                  {receipts.some((receipt) => receipt.recordId === r.id) && (
                    <details className="record-receipts">
                      <summary>予定調整の履歴</summary>
                      {[...receipts]
                        .filter((receipt) => receipt.recordId === r.id)
                        .reverse()
                        .map((receipt) => (
                          <details key={receipt.id}>
                            <summary>{receiptLabel(receipt)}</summary>
                            <ProgressReceiptView state={state} receipt={receipt} />
                          </details>
                        ))}
                    </details>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
