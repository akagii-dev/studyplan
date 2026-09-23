import { Check, GraduationCap, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { examColors } from '../../domain/appearance';
import { Exam, addDays, today, uid } from '../../domain/model';
import { validateSettings } from '../../domain/planning';
import { Empty, Field, Props, useDraft } from '../common';
const colors = examColors.map((color) => color.value);
export function Exams({
  state,
  update,
  onAdd,
  onAddMaterial,
}: Props & { onAdd: () => void; onAddMaterial: (examId: string) => void }) {
  const blank: Exam = {
    id: '',
    name: '',
    start: today(),
    target: addDays(today(), 90),
    priority: 2,
    color: colors[0],
    reviewDays: 0,
  };
  const [form, set] = useDraft(state, update, 'exam', blank);
  const [error, err] = useState('');
  async function save() {
    const e = { ...form, id: form.id || uid() };
    const errors = validateSettings({ ...state.settings, exams: [e], materials: [] });
    if (errors.length) {
      err(errors.join(' '));
      return;
    }
    await update((s) => ({
      ...s,
      settings: {
        ...s.settings,
        exams: s.settings.exams.some((item) => item.id === e.id)
          ? s.settings.exams.map((item) => (item.id === e.id ? e : item))
          : [...s.settings.exams, e],
      },
      draft: { ...s.draft, exam: blank },
      proposal: null,
    }));
    err('');
  }
  return (
    <div className={form.id ? 'split' : ''}>
      {form.id && (
        <section className="card">
          <div className="eyebrow">STEP 01 · GOALS</div>
          <h2>どんな試験を目指しますか？</h2>
          <p>目標を一つずつ登録しましょう。あとから変更できます。</p>
          <Field label="試験名">
            <input
              data-settings-edit="exam"
              value={form.name}
              onChange={(e) => set({ ...form, name: e.target.value })}
              placeholder="例：基本情報技術者試験"
            />
          </Field>
          <div className="two">
            <Field label="計画開始日">
              <input
                type="date"
                value={form.start}
                onChange={(e) => set({ ...form, start: e.target.value })}
              />
            </Field>
            <Field label="目標日">
              <input
                type="date"
                value={form.target}
                onChange={(e) => set({ ...form, target: e.target.value })}
              />
            </Field>
          </div>
          <div className="two">
            <Field label="優先度">
              <select
                value={form.priority}
                onChange={(e) => set({ ...form, priority: +e.target.value })}
              >
                <option value={3}>高い</option>
                <option value={2}>ふつう</option>
                <option value={1}>低い</option>
              </select>
            </Field>
            <Field
              label="復習期間（日）"
              hint="通常教材の締切を前倒しし、目標日前に復習枠を確保します。"
            >
              <input
                type="number"
                min="0"
                value={form.reviewDays}
                onChange={(e) => set({ ...form, reviewDays: +e.target.value })}
              />
            </Field>
          </div>
          <Field label="カレンダーの表示色">
            <div className="choices">
              {colors.map((c) => (
                <button
                  key={c}
                  aria-label={`表示色 ${c}`}
                  title={examColors.find((color) => color.value === c)?.name}
                  aria-pressed={form.color === c}
                  className={`swatch ${form.color === c ? 'selected' : ''}`}
                  style={{ background: c }}
                  onClick={() => set({ ...form, color: c })}
                >
                  {form.color === c && <Check size={16} />}
                </button>
              ))}
              <input
                aria-label="その他の表示色"
                type="color"
                value={form.color}
                onChange={(e) => set({ ...form, color: e.target.value })}
              />
            </div>
          </Field>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button data-submit className="primary" onClick={save}>
            <Plus size={17} />
            {form.id ? '試験を更新する' : '試験を追加する'}
          </button>
          {form.id && <button onClick={() => set(blank)}>編集を終了</button>}
        </section>
      )}
      <section>
        <div className="row addition-actions">
          <h3>
            登録した試験 <span className="badge">{state.settings.exams.length}</span>
          </h3>
          <button className="primary" onClick={onAdd}>
            <Plus size={17} />
            {state.draft.addExam &&
            (state.draft.addExam as { step: string }).step !== 'addition.saved'
              ? '試験の追加を再開'
              : '試験を追加'}
          </button>
        </div>
        {!state.settings.exams.length ? (
          <Empty>
            <GraduationCap />
            <p>最初の目標から、始めましょう。</p>
          </Empty>
        ) : (
          state.settings.exams.map((e) => (
            <div className="card compact" key={e.id} style={{ borderLeft: `4px solid ${e.color}` }}>
              <div className="row">
                <h3>{e.name}</h3>
                <button className="icon" aria-label={`${e.name}を編集`} onClick={() => set(e)}>
                  <Pencil size={16} />
                </button>
              </div>
              <p>
                {e.start} → {e.target}
              </p>
              <div className="tags">
                <span>優先度：{['', '低い', 'ふつう', '高い'][e.priority]}</span>
                <span>復習 {e.reviewDays}日</span>
              </div>
              {!state.plan?.settingsSnapshot?.exams.some((x) => x.id === e.id) && (
                <p className="hint">計画に未反映</p>
              )}
              <button onClick={() => onAddMaterial(e.id)}>
                {state.draft.addMaterial &&
                (state.draft.addMaterial as { step: string }).step !== 'addition.saved'
                  ? '入力途中の教材の追加を再開'
                  : 'この試験の教材を追加'}
              </button>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
