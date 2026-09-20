import { todayProgress } from '../domain/todayProgress';
import { ProgressRing } from './AnimatedProgress';
import { NumberInput } from './NumberInput';
import { useRef, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Progress as ProgressRecord, completed, remaining, today, uid } from '../domain/model';
import { correctProgress, recordProgress } from '../domain/progress';
import { proposalAfterRecord } from '../domain/planner';
import { parseNumberInput } from '../domain/numeric';
import { Empty, Field, Props, useDraft } from './common';
export function Progress({ state, update }: Props) {
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
  const [chartScope, setChartScope] = useState<'today' | 'round'>('today');
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
  const daily = todayProgress(state);
  const isToday = chartScope === 'today';
  const chartProgress = isToday
    ? { total: daily.planned, done: daily.matched }
    : {
        total: material?.total ?? 0,
        done: material ? completed(state, material.id, form.round) : 0,
      };
  const chartLabel = isToday
    ? today() + 'の予定'
    : material
      ? `${material.name} · ${form.round + 1}周目`
      : '教材を選択してください';
  const chartPercent = chartProgress.total ? (chartProgress.done / chartProgress.total) * 100 : 0;
  const displayPercent = chartPercent.toLocaleString('ja-JP', { maximumFractionDigits: 1 });
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
        let next = recordProgress(s, {
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
        next = proposalAfterRecord(
          next,
          '進捗の記録によって残り問題数が変わったため、今後の課題を再配分します。',
          s.proposal,
        );
        return next;
      });
      request.current = uid();
      msg(
        `＋${count}問を記録しました。${state.plan ? '再計画の確認画面で変更案を確認できます。' : ''}`,
      );
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
          <div role="status" className="note">
            {message}
          </div>
        )}
      </section>
      <section className="card progress-chart-card" aria-labelledby="progress-chart-heading">
        <h2 id="progress-chart-heading">{isToday ? '今日の進捗' : '教材の進捗'}</h2>
        <div className="actions" role="group" aria-label="進捗グラフの対象">
          <button
            aria-pressed={chartScope === 'today'}
            className={chartScope === 'today' ? 'selected' : ''}
            onClick={() => setChartScope('today')}
          >
            今日
          </button>
          <button
            aria-pressed={chartScope === 'round'}
            className={chartScope === 'round' ? 'selected' : ''}
            onClick={() => setChartScope('round')}
            disabled={!material}
          >
            選択中の周回
          </button>
        </div>
        <p className="progress-chart-scope">{chartLabel}</p>
        {isToday && (
          <p className="today-actual">
            {daily.reported ? `今日の記録：${daily.actual}問` : '今日は未報告です'}
            {daily.actual > daily.matched
              ? `（予定外・超過 ${daily.actual - daily.matched}問）`
              : ''}
          </p>
        )}
        {chartProgress.total > 0 ? (
          <>
            <ProgressRing
              percent={chartPercent}
              label={`${chartLabel}：完了${chartProgress.done}問、残り${chartProgress.total - chartProgress.done}問、進捗率${displayPercent}%`}
            />
            <dl className="progress-chart-counts" aria-live="polite">
              <div>
                <dt>
                  <span className="progress-dot done" />
                  完了
                </dt>
                <dd>
                  {chartProgress.done.toLocaleString('ja-JP')}
                  <small>問</small>
                </dd>
              </div>
              <div>
                <dt>
                  <span className="progress-dot" />
                  残り
                </dt>
                <dd>
                  {(chartProgress.total - chartProgress.done).toLocaleString('ja-JP')}
                  <small>問</small>
                </dd>
              </div>
            </dl>
            <p className="hint">全{chartProgress.total.toLocaleString('ja-JP')}問 · 問題数ベース</p>
          </>
        ) : (
          <Empty>
            {isToday ? '今日の学習予定はありません。' : '教材を登録すると進捗を表示します。'}
          </Empty>
        )}
      </section>
    </div>
  );
}
export function History({ state, update }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [count, setCount] = useState('');
  const [error, err] = useState('');
  const [cancelId, setCancelId] = useState<string | null>(null);
  async function change(r: ProgressRecord, cancelled: boolean) {
    try {
      await update((s) => {
        let next = correctProgress(s, r.id, cancelled ? r.count : Number(count), cancelled);
        next = proposalAfterRecord(
          next,
          cancelled
            ? '記録の取消によって残数が増えたため再配分します。'
            : '記録の訂正に合わせて残りの課題を再配分します。',
          s.proposal,
        );
        return next;
      });
      setEditing(null);
      setCancelId(null);
      err('');
    } catch (e) {
      err(String(e));
    }
  }
  return (
    <section className="card">
      <div className="eyebrow">PROGRESS HISTORY</div>
      <h2>これまでの記録</h2>
      <p>記録を訂正・取消できます。</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
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
