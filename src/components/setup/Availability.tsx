import { Plus } from 'lucide-react';
import { useState } from 'react';
import { WindowRule, addDays, clock, minutes, today, uid } from '../../domain/model';
import { validateSettings } from '../../domain/planning';
import { ClassNames } from '../ClassNames';
import { Empty, Field, Props, useDraft, weekdays } from '../common';
import { ScheduleReview } from '../SetupImpact';
import { TimetablePreview } from '../TimetablePreview';
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
