import { BookOpen, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { Material, completed, uid } from '../../domain/model';
import { validateSettings } from '../../domain/planning';
import { AnimatedProgress } from '../AnimatedProgress';
import { Empty, Field, Props, useDraft } from '../common';
export function Materials({ state, update, onAdd }: Props & { onAdd: () => void }) {
  const blank: Material = {
    id: '',
    examId: state.settings.exams[0]?.id ?? '',
    name: '',
    total: 100,
    order: 1,
    rounds: [{ completed: 0, minutes: 2 }],
  };
  const [form, set] = useDraft(state, update, 'material', blank);
  const [error, err] = useState('');
  async function save() {
    const m = { ...form, id: form.id || uid() };
    const errors = validateSettings({ ...state.settings, materials: [m] });
    if (errors.length) {
      err(errors.join(' '));
      return;
    }
    if (
      m.rounds.some(
        (r, i) =>
          r.completed +
            state.records
              .filter((x) => !x.cancelled && x.materialId === m.id && x.round === i)
              .reduce((n, x) => n + x.count, 0) >
          m.total,
      )
    ) {
      err('初期完了数と記録の合計が総問題数を超えています。');
      return;
    }
    await update((s) => ({
      ...s,
      settings: {
        ...s.settings,
        materials: s.settings.materials.some((item) => item.id === m.id)
          ? s.settings.materials.map((item) => (item.id === m.id ? m : item))
          : [...s.settings.materials, m],
      },
      draft: { ...s.draft, material: blank },
      proposal: null,
    }));
    err('');
  }
  return (
    <div className={form.id ? 'split' : ''}>
      {form.id && (
        <section className="card">
          <div className="eyebrow">STEP 04 · MATERIALS</div>
          <h2>何を、どのくらい学びますか？</h2>
          <p>周回ごとに残りの学習量を計算します。</p>
          <Field label="対象の試験">
            <select value={form.examId} onChange={(e) => set({ ...form, examId: e.target.value })}>
              <option value="" disabled>
                試験を選択
              </option>
              {state.settings.exams.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="教材名">
            <input
              value={form.name}
              placeholder="例：過去問題集"
              onChange={(e) => set({ ...form, name: e.target.value })}
            />
          </Field>
          <div className="two">
            <Field label="総問題数">
              <input
                type="number"
                min="1"
                max="1000000000"
                value={form.total}
                onChange={(e) => set({ ...form, total: +e.target.value })}
              />
            </Field>
            <Field label="取り組む順序" hint="同じ試験の中で小さい番号を先に学習">
              <input
                type="number"
                min="1"
                value={form.order}
                onChange={(e) => set({ ...form, order: +e.target.value })}
              />
            </Field>
          </div>
          <Field label="周回数">
            <input
              type="number"
              min="1"
              max="20"
              value={form.rounds.length}
              onChange={(e) => {
                const n = Math.max(1, Math.min(20, +e.target.value));
                if (
                  form.id &&
                  state.records.some((r) => r.materialId === form.id && r.round >= n)
                ) {
                  err('記録のある周回は削除できません。');
                  return;
                }
                set({
                  ...form,
                  rounds: Array.from(
                    { length: n },
                    (_, i) => form.rounds[i] ?? { completed: 0, minutes: form.rounds[0].minutes },
                  ),
                });
              }}
            />
          </Field>
          {form.rounds.map((r, i) => (
            <div className="round-form" key={i}>
              <b>{i + 1}周目</b>
              <Field
                draftKey={`completed-${form.id}-${i}`}
                label="初期完了数"
                hint="記録画面から追加した数は含めません"
              >
                <input
                  type="number"
                  min="0"
                  max={form.total}
                  value={r.completed}
                  onChange={(e) =>
                    set({
                      ...form,
                      rounds: form.rounds.map((x, j) =>
                        i === j ? { ...x, completed: +e.target.value } : x,
                      ),
                    })
                  }
                />
              </Field>
              <Field draftKey={`minutes-${form.id}-${i}`} label="1問あたり（分）">
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={r.minutes}
                  onChange={(e) =>
                    set({
                      ...form,
                      rounds: form.rounds.map((x, j) =>
                        i === j ? { ...x, minutes: +e.target.value } : x,
                      ),
                    })
                  }
                />
              </Field>
            </div>
          ))}
          <p className="hint">
            新しい周回は1周目と同じ推定時間で追加します。必要に応じて変更してください。
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button data-submit className="primary" onClick={save}>
            <Plus size={16} />
            {form.id ? '教材を更新する' : '教材を追加する'}
          </button>
          {form.id && <button onClick={() => set(blank)}>編集を終了</button>}
        </section>
      )}
      <section>
        <div className="row addition-actions">
          <h3>
            教材と進捗 <span className="badge">{state.settings.materials.length}</span>
          </h3>
          <button className="primary" onClick={onAdd}>
            <Plus size={17} />
            {state.draft.addMaterial &&
            (state.draft.addMaterial as { step: string }).step !== 'addition.saved'
              ? '教材の追加を再開'
              : '教材を追加'}
          </button>
        </div>
        {!state.settings.materials.length ? (
          <Empty>
            <BookOpen />
            <p>使う教材を登録してください。</p>
          </Empty>
        ) : (
          state.settings.materials.map((m) => {
            const done = m.rounds.reduce((n, _, i) => n + completed(state, m.id, i), 0);
            return (
              <div className="card compact" key={m.id}>
                <div className="row">
                  <span className="eyebrow">
                    {state.settings.exams.find((e) => e.id === m.examId)?.name}
                  </span>
                  <button className="icon" aria-label={`${m.name}を編集`} onClick={() => set(m)}>
                    <Pencil size={16} />
                  </button>
                </div>
                <h3>{m.name}</h3>
                {!state.plan?.settingsSnapshot?.materials.some((x) => x.id === m.id) && (
                  <p className="hint">計画に未反映</p>
                )}
                <AnimatedProgress
                  label={`${m.name}の進捗`}
                  max={m.total * m.rounds.length}
                  value={done}
                />
                <div className="row">
                  <span>
                    {done} / {m.total * m.rounds.length}問
                  </span>
                  <b>{Math.round((done / (m.total * m.rounds.length)) * 100)}%</b>
                </div>
                {m.rounds.map((r, i) => (
                  <p className="hint" key={i}>
                    {i + 1}周目：完了 {completed(state, m.id, i)}問 · 残り{' '}
                    {m.total - completed(state, m.id, i)}問 · 1問 {r.minutes}分
                  </p>
                ))}
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}
