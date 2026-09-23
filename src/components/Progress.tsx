import { NumberInput } from './NumberInput';
import { useRef, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Progress as ProgressRecord, completed, remaining, today, uid } from '../domain/model';
import { correctAndAdjust, recordAndAdjust } from '../domain/planning';
import { currentProgressAdjustment } from '../domain/progressAdjustment';
import { parseNumberInput } from '../domain/numeric';
import { Empty, Field, Props, useDraft } from './common';
export function Progress({
  state,
  update,
  onHistory,
  onReplan,
}: Props & { onHistory?: () => void; onReplan?: () => void }) {
  const initial = {
    date: today(),
    materialId: state.settings.materials[0]?.id ?? '',
    round: 0,
    choice: '',
    custom: '',
  };
  const [form, set] = useDraft(state, update, 'progress', initial);
  const [message, msg] = useState('');
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const request = useRef(uid());
  const numberEdits = (state.draft.numberEdits ?? {}) as Record<
    string,
    { text: string; base: string }
  >;
  const legacyKeys = Object.keys(numberEdits).filter(
    (key) => key.startsWith('progress/') && key.endsWith('/追加問題数（1問単位）'),
  );
  const legacyEdit = legacyKeys
    .map((key) => numberEdits[key])
    .find((edit) => edit.base === form.custom);
  const customText = legacyEdit?.text ?? form.custom;
  const clearLegacyEdit = (draft: typeof state.draft) => ({
    ...draft,
    numberEdits: Object.fromEntries(
      Object.entries((draft.numberEdits ?? {}) as Record<string, unknown>).filter(
        ([key]) => !legacyKeys.includes(key),
      ),
    ),
  });
  const setCustomForm = (progress: typeof form) => {
    void update((s) => ({ ...s, draft: { ...clearLegacyEdit(s.draft), progress } })).catch(
      () => {},
    );
  };
  const material = state.settings.materials.find((m) => m.id === form.materialId);
  const rest = material ? remaining(state, material.id, form.round) : 0;
  const customCount = (() => {
    try {
      return parseNumberInput(customText, 0, rest, 1);
    } catch {
      return NaN;
    }
  })();
  const count =
    form.choice === 'all'
      ? rest
      : form.choice === 'other'
        ? customCount
        : form.choice === ''
          ? NaN
          : Number(form.choice);
  const valid =
    material &&
    material.rounds[form.round] &&
    Number.isInteger(count) &&
    count >= 0 &&
    count <= rest &&
    form.date &&
    form.date <= today();
  async function save() {
    if (sending.current || !valid) return;
    sending.current = true;
    setBusy(true);
    msg('');
    const id = request.current;
    try {
      await update((s) => {
        const now = new Date().toISOString();
        let next = recordAndAdjust(s, {
          id,
          date: form.date,
          materialId: form.materialId,
          round: form.round,
          count,
          cancelled: false,
          createdAt: now,
          updatedAt: now,
        });
        next = {
          ...next,
          draft: { ...clearLegacyEdit(next.draft), progress: { ...form, choice: '', custom: '' } },
        };
        return next;
      });
      request.current = uid();
      msg(`＋${count}問を記録しました。`);
    } catch (e) {
      msg(String(e));
    } finally {
      setBusy(false);
      sending.current = false;
    }
  }
  return (
    <div className="split">
      <section className="card">
        <div className="eyebrow">DAILY CHECK-IN</div>
        <h2>進捗の記録</h2>
        <Field label="① 記録対象日">
          <input
            type="date"
            max={today()}
            value={form.date}
            onChange={(e) => {
              set({ ...form, date: e.target.value });
              msg('');
            }}
          />
        </Field>
        <div className="two">
          <Field label="教材">
            <select
              value={form.materialId}
              onChange={(e) => {
                setCustomForm({
                  ...form,
                  materialId: e.target.value,
                  round: 0,
                  choice: '',
                  custom: '',
                });
                msg('');
              }}
            >
              <option value="" disabled>
                教材を選択
              </option>
              {state.settings.materials.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="周回">
            <select
              value={form.round}
              onChange={(e) => {
                setCustomForm({ ...form, round: +e.target.value, choice: '', custom: '' });
                msg('');
              }}
            >
              {material?.rounds.map((_, i) => (
                <option key={i} value={i}>
                  {i + 1}周目
                </option>
              ))}
            </select>
          </Field>
        </div>
        {material && (
          <div className="progress-summary">
            <span>
              完了 <b>{completed(state, material.id, form.round)}</b>問
            </span>
            <span>
              残り <b>{rest}</b>問
            </span>
            <span>
              {Math.round((completed(state, material.id, form.round) / material.total) * 100)}%
            </span>
          </div>
        )}
        <h3>② 追加で完了した問題数を選んでください。</h3>
        <div className="count-choices">
          {[0, 5, 10, 15, 20].map((n) => (
            <button
              key={n}
              disabled={!material || n > rest}
              className={form.choice === String(n) ? 'selected' : ''}
              onClick={() => set({ ...form, choice: String(n) })}
            >
              {n}
              <small>問</small>
            </button>
          ))}
          <button
            className={form.choice === 'other' ? 'selected' : ''}
            onClick={() => set({ ...form, choice: 'other' })}
          >
            その他
          </button>
          <button
            className={`all ${form.choice === 'all' ? 'selected' : ''}`}
            disabled={!material}
            onClick={() => set({ ...form, choice: 'all' })}
          >
            残りすべて：{rest}問
          </button>
        </div>
        {form.choice === 'other' && (
          <Field label="追加問題数（1問単位）">
            <input
              autoFocus
              type="text"
              inputMode="numeric"
              value={customText}
              onChange={(e) => {
                const custom = e.target.value;
                msg('');
                setCustomForm({ ...form, custom });
              }}
              onKeyDown={(e) => {
                if (
                  e.key !== 'Enter' ||
                  e.repeat ||
                  e.nativeEvent.isComposing ||
                  e.nativeEvent.keyCode === 229
                )
                  return;
                e.preventDefault();
                e.stopPropagation();
                try {
                  parseNumberInput(customText, 0, rest, 1);
                  void save();
                } catch (error) {
                  msg((error as Error).message);
                }
              }}
            />
          </Field>
        )}
        <p className="hint">今回の追加分を記録します。0問も報告済みになります。</p>
        <button data-submit className="primary wide" disabled={!valid || busy} onClick={save}>
          <CheckCircle2 size={18} />
          {busy ? '保存中…' : '記録する'}
        </button>
        {message && (
          <div role="status" className="note progress-result">
            <p>{message}</p>
            {state.plan &&
              (() => {
                const result = currentProgressAdjustment(state);
                if (!result) return null;
                return (
                  <>
                    <p>
                      {result.status === 'review'
                        ? '記録済み・予定の確認が必要です。'
                        : result.status === 'applied'
                          ? '明日以降の予定を調整しました。'
                          : '記録しました。'}
                    </p>
                    {result.detail && <p className="error">{result.detail}</p>}
                    {!!result.unplacedMinutes && <p>未配置 {result.unplacedMinutes}分</p>}
                    <div className="actions">
                      <button onClick={onHistory}>記録を訂正</button>
                      <button onClick={onReplan}>計画全体を見直す</button>
                    </div>
                  </>
                );
              })()}
          </div>
        )}
      </section>
    </div>
  );
}
export function History({ state, update, onReplan, onRecordPast }: Props & { onReplan?: () => void; onRecordPast?: () => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [count, setCount] = useState('');
  const [error, err] = useState('');
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState('');
  async function change(r: ProgressRecord, cancelled: boolean) {
    try {
      let adjusted = 'recorded';
      await update((s) => {
        const next = correctAndAdjust(
          s,
          r.id,
          cancelled ? r.count : Number(count),
          cancelled,
        );
        adjusted = currentProgressAdjustment(next)?.status ?? 'recorded';
        return next;
      });
      setEditing(null);
      setCancelId(null);
      err('');
      setResultMessage(`${cancelled ? '記録を取り消しました' : '記録を訂正しました'}。${adjusted === 'applied' ? '明日以降を調整しました。' : adjusted === 'review' ? '予定の確認が必要です。' : ''}`);
    } catch (e) {
      err(String(e));
    }
  }
  return (
    <section className="card">
      <div className="eyebrow">PROGRESS HISTORY</div>
      <h2>これまでの記録</h2>
      <button onClick={onRecordPast}>過去日の学習を記録</button>
      {resultMessage && <p role="status">{resultMessage}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {currentProgressAdjustment(state)?.status === 'review' && (
        <div className="note">
          記録済み・予定の確認が必要です。
          <button onClick={onReplan}>計画全体を見直す</button>
        </div>
      )}
      {!state.records.length ? (
        <Empty>まだ記録がありません。0問の報告もここに残ります。</Empty>
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
            {[...state.records].reverse().map((r) => (
              <tr key={r.id} className={r.cancelled ? 'cancelled' : ''}>
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
                      ＋{r.count}問 {r.cancelled ? '（取消済）' : ''}
                    </b>
                  )}
                </td>
                <td>
                  {!r.cancelled &&
                    (editing === r.id ? (
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
                    ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
