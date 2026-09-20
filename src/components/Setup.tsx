import { useState } from 'react';
import { ScheduleReview } from './SetupImpact';
import { Plus, Pencil, Check, BookOpen, GraduationCap } from 'lucide-react';
import {
  AppState,
  Exam,
  Material,
  WindowRule,
  addDays,
  clock,
  completed,
  minutes,
  today,
  uid,
} from '../domain/model';
import { validateSettings } from '../domain/planner';
import { Empty, Field, Props, useDraft, weekdays } from './common';
import { ClassNames } from './ClassNames';
import { TimetablePreview } from './TimetablePreview';
import { sessionPolicy } from '../domain/sessionPolicy';
import { examColors } from '../domain/appearance';
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
      settings: { ...s.settings, exams: [...s.settings.exams.filter((x) => x.id !== e.id), e] },
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
        materials: [...s.settings.materials.filter((x) => x.id !== m.id), m],
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
                <progress
                  aria-label={`${m.name}の進捗`}
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
export function Availability({ state, update }: Props) {
  const blank: WindowRule = {
    id: '',
    kind: 'study',
    name: '学習可能枠',
    from: today(),
    to: addDays(today(), 180),
    weekdays: [1, 2, 3, 4, 5],
    start: 1080,
    end: 1260,
  };
  const [form, set] = useDraft(state, update, 'window', blank);
  const [error, err] = useState('');
  const exBlank = { id: '', name: '予定', date: today(), start: 0, end: 1440 };
  const [exception, setException] = useDraft(state, update, 'exception', exBlank);
  const [period, setPeriod] = useDraft(state, update, 'classPeriod', {
    from: today(),
    to: addDays(today(), 90),
  });
  async function saveRule() {
    const errors = validateSettings({ ...state.settings, windows: [form] });
    if (errors.length) {
      err(errors.join(' '));
      return;
    }
    await update((s) => ({
      ...s,
      settings: {
        ...s.settings,
        windows: [
          ...s.settings.windows.filter((w) => w.id !== form.id),
          { ...form, id: form.id || uid() },
        ],
      },
      draft: { ...s.draft, window: blank },
      proposal: null,
    }));
    err('');
  }
  const toggleClass = (day: number, start: number) => {
    void update((s) => {
      const existing = s.settings.windows.find(
        (w) =>
          w.kind === 'class' &&
          w.weekdays[0] === day &&
          w.start === start &&
          w.from === period.from &&
          w.to === period.to,
      );
      return {
        ...s,
        settings: {
          ...s.settings,
          windows: existing
            ? s.settings.windows.filter((w) => w.id !== existing.id)
            : [
                ...s.settings.windows,
                {
                  id: uid(),
                  name: '大学の授業',
                  kind: 'class',
                  from: period.from,
                  to: period.to,
                  weekdays: [day],
                  start,
                  end: Math.min(1440, start + 100),
                },
              ],
        },
        proposal: null,
      };
    });
  };
  return (
    <>
      <ScheduleReview state={state} update={update} />
      <div className="split">
        <section className="card">
          <div className="eyebrow">STEP 02 · AVAILABILITY</div>
          <h2>いつ、勉強できそうですか？</h2>
          <p>
            「勉強できる時間」は学習予定を置いてよい範囲です。開始から終了までずっと勉強する指定ではありません。授業・予定を除き、連続学習の長さと休憩・余裕率を適用して予定を作ります。
          </p>
          <Field label="枠の種類">
            <select
              value={form.kind}
              onChange={(e) =>
                set({
                  ...form,
                  kind: e.target.value as WindowRule['kind'],
                  name: e.target.value === 'study' ? '学習可能枠' : '定期予定',
                })
              }
            >
              <option value="study">勉強できる時間</option>
              <option value="busy">授業以外の定期予定</option>
              <option value="class">授業（時間を直接指定）</option>
            </select>
          </Field>
          <Field label="枠の名前">
            <input value={form.name} onChange={(e) => set({ ...form, name: e.target.value })} />
          </Field>
          <div className="two">
            <Field label="適用開始日">
              <input
                type="date"
                value={form.from}
                onChange={(e) => set({ ...form, from: e.target.value })}
              />
            </Field>
            <Field label="適用終了日">
              <input
                type="date"
                value={form.to}
                onChange={(e) => set({ ...form, to: e.target.value })}
              />
            </Field>
          </div>
          <Field label="曜日">
            <div className="choices">
              {weekdays.map((w, i) => (
                <button
                  key={i}
                  aria-pressed={form.weekdays.includes(i)}
                  className={form.weekdays.includes(i) ? 'selected' : ''}
                  onClick={() =>
                    set({
                      ...form,
                      weekdays: form.weekdays.includes(i)
                        ? form.weekdays.filter((d) => d !== i)
                        : [...form.weekdays, i],
                    })
                  }
                >
                  {w}
                </button>
              ))}
            </div>
          </Field>
          <div className="two">
            <Field
              label={form.kind === 'study' ? '勉強できる開始時刻' : '授業・予定の開始時刻'}
              hint={
                form.kind === 'study'
                  ? 'この時刻より前には学習を入れません。'
                  : 'この時刻から学習不可です。'
              }
            >
              <input
                type="time"
                value={clock(form.start)}
                onChange={(e) => set({ ...form, start: minutes(e.target.value) })}
              />
            </Field>
            <Field
              label={form.kind === 'study' ? '勉強できる終了時刻' : '授業・予定の終了時刻'}
              hint={
                form.kind === 'study'
                  ? 'この時刻より後には学習を入れません。'
                  : 'この時刻まで学習不可です。'
              }
            >
              <input
                type="time"
                value={clock(form.end)}
                onChange={(e) => set({ ...form, end: minutes(e.target.value) })}
              />
            </Field>
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button data-submit className="primary" onClick={saveRule}>
            <Plus size={16} />
            {form.id ? '時間枠を更新する' : '時間枠を追加する'}
          </button>
        </section>
        <section>
          <h3>登録した時間枠</h3>
          {state.settings.windows.filter((w) => w.kind !== 'class').length === 0 && (
            <Empty>平日・休日・休暇など、期間を分けて登録できます。</Empty>
          )}
          {state.settings.windows
            .filter((w) => w.kind !== 'class')
            .map((w) => (
              <div className="card compact" key={w.id}>
                <div className="row">
                  <b>{w.name}</b>
                  <span className="badge">{w.kind === 'study' ? '学習可' : '予定'}</span>
                </div>
                <p>
                  {w.weekdays.map((d) => weekdays[d]).join('・')}　{clock(w.start)}–{clock(w.end)}
                </p>
                <small>
                  {w.from}〜{w.to}
                </small>
                <div className="row actions">
                  <button onClick={() => set(w)}>編集</button>
                  <button
                    className="text-danger"
                    onClick={() =>
                      void update((s) => ({
                        ...s,
                        settings: {
                          ...s.settings,
                          windows: s.settings.windows.filter((x) => x.id !== w.id),
                        },
                        proposal: null,
                      }))
                    }
                  >
                    削除
                  </button>
                </div>
              </div>
            ))}
        </section>
      </div>
      <section className="card">
        <div className="eyebrow">WEEKLY TIMETABLE</div>
        <h2>大学の授業を選んでください</h2>
        <p>
          1コマ100分。開始時刻は各行で設定できます。時間割の適用期間を切り替えて、授業期間と休暇を区別します。
        </p>
        <div className="two">
          <Field label="時間割の適用開始">
            <input
              type="date"
              value={period.from}
              onChange={(e) => setPeriod({ ...period, from: e.target.value })}
            />
          </Field>
          <Field label="時間割の適用終了">
            <input
              type="date"
              value={period.to}
              min={period.from}
              onChange={(e) => setPeriod({ ...period, to: e.target.value })}
            />
          </Field>
        </div>
        <div className="timetable">
          <div>時限 / 開始</div>
          {[1, 2, 3, 4, 5].map((d) => (
            <b key={d}>{weekdays[d]}</b>
          ))}
          {state.settings.periods.map((start, i) => (
            <div className="timetable-row" key={i}>
              <label>
                {i + 1}限
                <input
                  aria-label={`${i + 1}限の開始`}
                  type="time"
                  value={clock(start)}
                  onChange={(e) => {
                    const v = minutes(e.target.value);
                    if (!Number.isFinite(v) || v + 100 > 1440) return;
                    void update((s) => ({
                      ...s,
                      settings: {
                        ...s.settings,
                        periods: s.settings.periods.map((p, j) => (i === j ? v : p)),
                        windows: s.settings.windows.map((w) =>
                          w.kind === 'class' &&
                          w.start === start &&
                          w.from === period.from &&
                          w.to === period.to
                            ? { ...w, start: v, end: v + 100 }
                            : w,
                        ),
                      },
                      proposal: null,
                    }));
                  }}
                />
              </label>
              {[1, 2, 3, 4, 5].map((day) => {
                const selected = state.settings.windows.some(
                  (w) =>
                    w.kind === 'class' &&
                    w.weekdays[0] === day &&
                    w.start === start &&
                    w.from === period.from &&
                    w.to === period.to,
                );
                return (
                  <button
                    key={day}
                    disabled={!period.from || period.to < period.from}
                    aria-label={`${weekdays[day]}曜${i + 1}限`}
                    aria-pressed={selected}
                    className={selected ? 'class-selected' : ''}
                    onClick={() => toggleClass(day, start)}
                  >
                    {selected ? (
                      <span>
                        授業<small>学習不可</small>
                      </span>
                    ) : (
                      '＋'
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <ClassNames state={state} update={update} from={period.from} to={period.to} />
        <TimetablePreview settings={state.settings} from={period.from} to={period.to} />
        <details>
          <summary>
            登録済みの授業（全期間）{' '}
            {state.settings.windows.filter((w) => w.kind === 'class').length}コマ
          </summary>
          {state.settings.windows
            .filter((w) => w.kind === 'class')
            .map((w) => (
              <div className="row history-row" key={w.id}>
                <span>
                  {w.weekdays.map((d) => weekdays[d])} {clock(w.start)}–{clock(w.end)}　{w.from}〜
                  {w.to}
                </span>
                <button
                  onClick={() =>
                    void update((s) => ({
                      ...s,
                      settings: {
                        ...s.settings,
                        windows: s.settings.windows.filter((x) => x.id !== w.id),
                      },
                      proposal: null,
                    }))
                  }
                >
                  削除
                </button>
              </div>
            ))}
        </details>
      </section>
      <section className="card">
        <h2>勉強できない日・時間はありますか？</h2>
        <div className="two">
          <Field label="予定名">
            <input
              value={exception.name}
              onChange={(e) => setException({ ...exception, name: e.target.value })}
            />
          </Field>
          <Field label="予定日">
            <input
              type="date"
              value={exception.date}
              onChange={(e) => setException({ ...exception, date: e.target.value })}
            />
          </Field>
        </div>
        <div className="choices">
          <button
            className={exception.start === 0 && exception.end === 1440 ? 'selected' : ''}
            onClick={() => setException({ ...exception, start: 0, end: 1440 })}
          >
            終日
          </button>
          <button
            className={exception.end !== 1440 ? 'selected' : ''}
            onClick={() => setException({ ...exception, start: 600, end: 720 })}
          >
            時間帯を指定
          </button>
        </div>
        {exception.end !== 1440 && (
          <div className="two">
            <Field label="予定の開始時刻">
              <input
                type="time"
                value={clock(exception.start)}
                onChange={(e) => setException({ ...exception, start: minutes(e.target.value) })}
              />
            </Field>
            <Field label="予定の終了時刻">
              <input
                type="time"
                value={clock(exception.end)}
                onChange={(e) => setException({ ...exception, end: minutes(e.target.value) })}
              />
            </Field>
          </div>
        )}
        <button
          data-submit
          className="primary"
          disabled={!exception.date || exception.start >= exception.end}
          onClick={() =>
            void update((s) => ({
              ...s,
              settings: {
                ...s.settings,
                exceptions: [...s.settings.exceptions, { ...exception, id: uid() }],
              },
              proposal: null,
            }))
          }
        >
          予定を追加する
        </button>
        {state.settings.exceptions.map((x) => (
          <div className="row history-row" key={x.id}>
            <span>
              {x.date}　{x.name}　
              {x.start === 0 && x.end === 1440 ? '終日' : `${clock(x.start)}–${clock(x.end)}`}
            </span>
            <button
              onClick={() =>
                void update((s) => ({
                  ...s,
                  settings: {
                    ...s.settings,
                    exceptions: s.settings.exceptions.filter((e) => e.id !== x.id),
                  },
                  proposal: null,
                }))
              }
            >
              削除
            </button>
          </div>
        ))}
      </section>
    </>
  );
}
export function Focus({ state, update }: Props) {
  const s = state.settings;
  const patch = (key: string, value: number) =>
    void update((x) => ({ ...x, settings: { ...x.settings, [key]: value }, proposal: null }));
  return (
    <section className="card narrow">
      <div className="eyebrow">STEP 03 · YOUR PACE</div>
      <h2>最長でどのくらい続けて勉強できますか？</h2>
      <Field label="連続で勉強できる最長時間（分）">
        <input
          type="number"
          min="1"
          max={1440}
          value={s.block}
          onChange={(e) => patch('block', +e.target.value)}
        />
      </Field>
      <p className="note">
        {s.block}分まで勉強 → {s.rest}分休憩 → {s.block}分まで勉強
      </p>
      <Field label="ブロック間の休憩（分）">
        <input
          type="number"
          min="1"
          max="1440"
          value={s.rest}
          onChange={(e) => patch('rest', +e.target.value)}
        />
      </Field>
      <Field label="授業前後の移動・準備（各・分）" hint="各授業の前後に空ける時間です。">
        <input
          type="number"
          min="0"
          max="180"
          value={s.classTransition ?? 0}
          onChange={(e) => patch('classTransition', +e.target.value)}
        />
      </Field>
      <details>
        <summary>予定のまとまりを調整する</summary>
        <Field
          label="予定の下限（分）"
          hint="教材の完了時や期限上必要な場合だけ、短い予定を許可します。"
        >
          <input
            type="number"
            min="1"
            max={sessionPolicy(s).preferred}
            value={sessionPolicy(s).minimum}
            onChange={(e) => patch('minimumSessionMinutes', +e.target.value)}
          />
        </Field>
        <Field
          label="まとまりの目安（分）"
          hint="空き枠と連続学習の上限の中で、この長さを目指します。"
        >
          <input
            type="number"
            min={sessionPolicy(s).minimum}
            max="1440"
            value={sessionPolicy(s).preferred}
            onChange={(e) => patch('preferredSessionMinutes', +e.target.value)}
          />
        </Field>
      </details>
    </section>
  );
}
export function Buffer({ state, update }: Props) {
  const s = state.settings;
  const [other, setOther] = useState(![0.1, 0.2, 0.3].includes(s.buffer));
  return (
    <section className="card narrow">
      <div className="eyebrow">STEP 05 · ROOM TO BREATHE</div>
      <h2>どのくらい余裕を残しますか？</h2>
      <p>計画に割り当てずに残す割合を選んでください。</p>
      <div className="choices large">
        {[0.1, 0.2, 0.3].map((b) => (
          <button
            key={b}
            className={!other && s.buffer === b ? 'selected' : ''}
            onClick={() => {
              setOther(false);
              void update((x) => ({
                ...x,
                settings: { ...x.settings, buffer: b },
                proposal: null,
              }));
            }}
          >
            {Math.round(b * 100)}%{b === 0.2 && <small>初期値</small>}
          </button>
        ))}
        <button className={other ? 'selected' : ''} onClick={() => setOther(true)}>
          その他
        </button>
      </div>
      {other && (
        <Field label="余裕率（%）">
          <input
            type="number"
            min="0"
            max="99"
            value={Math.round(s.buffer * 100)}
            onChange={(e) =>
              void update((x) => ({
                ...x,
                settings: { ...x.settings, buffer: +e.target.value / 100 },
                proposal: null,
              }))
            }
          />
        </Field>
      )}
      <div className="note">20%は初期値です。自由に変更できます。</div>
    </section>
  );
}
