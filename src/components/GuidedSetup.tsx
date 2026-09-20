import { ReactNode, useState, useRef } from 'react';
import { ArrowLeft, ArrowRight, Check, Plus } from 'lucide-react';
import {
  Exam,
  AppState,
  Exception,
  Material,
  ScheduleKind,
  ScheduleAnswer,
  WindowRule,
  addDays,
  clock,
  minutes,
  today,
  uid,
} from '../domain/model';
import { validateSettings } from '../domain/planner';
import { Field, Props, useDraft, weekdays } from './common';
import { answerSchedule, scheduleCount, setupIssues } from '../domain/setupIssues';
import { SetupImpact, SkipImpact } from './SetupImpact';
import { MealSetup } from './Meals';
import { ClassNames } from './ClassNames';
import { ResetSetup } from './ResetSetup';
import { TimetablePreview } from './TimetablePreview';
import { RegistrationStatus } from './RegistrationStatus';
type Step =
  | 'exam.name'
  | 'exam.target'
  | 'exam.start'
  | 'exam.priority'
  | 'exam.color'
  | 'exam.review'
  | 'exam.reviewDays'
  | 'exam.done'
  | 'window.period'
  | 'window.days'
  | 'window.time'
  | 'window.done'
  | 'class.ask'
  | 'class.period'
  | 'class.times'
  | 'class.grid'
  | 'busy.ask'
  | 'busy.name'
  | 'busy.period'
  | 'busy.days'
  | 'busy.time'
  | 'busy.done'
  | 'exception.ask'
  | 'exception.date'
  | 'exception.kind'
  | 'exception.time'
  | 'exception.done'
  | 'meals'
  | 'focus.total'
  | 'focus.block'
  | 'focus.rest'
  | 'material.exam'
  | 'material.name'
  | 'material.total'
  | 'material.rounds'
  | 'material.completed'
  | 'material.minutes'
  | 'material.custom'
  | 'material.roundMinutes'
  | 'material.order'
  | 'material.done'
  | 'buffer'
  | 'addition.saved'
  | 'finish';
interface Wizard {
  step: Step;
  trail: { step: Step; roundIndex: number }[];
  exam: Exam;
  window: WindowRule;
  exception: Exception;
  material: Material;
  roundIndex: number;
  classEditingPeriod?: { from: string; to: string };
  classFrom: string;
  classTo: string;
}
const colors = ['#287569', '#6870b5', '#c78341', '#b66b7f', '#4c89ac'];
const newExam = (): Exam => ({
  id: uid(),
  name: '',
  start: today(),
  target: addDays(today(), 90),
  priority: 2,
  color: colors[0],
  reviewDays: 0,
});
const newWindow = (kind: WindowRule['kind'] = 'study'): WindowRule => ({
  id: uid(),
  kind,
  name: kind === 'study' ? '学習可能枠' : '定期予定',
  from: today(),
  to: addDays(today(), 180),
  weekdays: [1, 2, 3, 4, 5],
  start: 1080,
  end: 1260,
});
const newMaterial = (examId: string): Material => ({
  id: uid(),
  examId,
  name: '',
  total: 100,
  order: 1,
  rounds: [{ completed: 0, minutes: 2 }],
});
export type Addition = 'addExam' | 'addMaterial';
function initialWizard(state: AppState, mode?: Addition, examId?: string): Wizard {
  return {
    step: mode === 'addMaterial' ? 'material.exam' : 'exam.name',
    trail: [],
    exam: mode ? newExam() : (state.settings.exams[0] ?? newExam()),
    window: newWindow(),
    exception: { id: uid(), name: '勉強できない予定', date: today(), start: 0, end: 1440 },
    material: mode
      ? newMaterial(examId ?? state.settings.exams[0]?.id ?? '')
      : (state.settings.materials[0] ?? newMaterial(state.settings.exams[0]?.id ?? '')),
    roundIndex: 0,
    classFrom: today(),
    classTo: addDays(today(), 90),
  };
}
export function beginAddition(state: AppState, mode: Addition, examId?: string): AppState {
  const existing = state.draft[mode] as Wizard | undefined;
  if (existing && existing.step !== 'addition.saved') return state;
  return { ...state, draft: { ...state.draft, [mode]: initialWizard(state, mode, examId) } };
}
export function GuidedSetup({
  state,
  update,
  onGenerate,
  mode,
  onClose,
  onAddMaterial,
  onReview,
  onConfigure,
}: Props & {
  onGenerate: () => void;
  mode?: Addition;
  onClose?: () => void;
  onAddMaterial?: (examId: string) => void;
  onReview?: () => void;
  onConfigure?: (kind: string) => void;
}) {
  const [initial] = useState(() => initialWizard(state, mode));
  const draftKey = mode ?? 'guided';
  const [w, set] = useDraft(state, update, draftKey, initial);
  const submitting = useRef(false);
  const [savingItem, setSavingItem] = useState(false);
  const [error, err] = useState('');
  const [editing, setEditing] = useState(false);
  const [editTimes, setEditTimes] = useState(false);
  const [otherBuffer, setOtherBuffer] = useState(![0.1, 0.2, 0.3].includes(state.settings.buffer));
  const materialDraftPending =
    !!state.draft.addMaterial && (state.draft.addMaterial as Wizard).step !== 'addition.saved';
  const patch = (partial: Partial<Wizard>) => set({ ...w, ...partial });
  const exam = (partial: Partial<Exam>) => patch({ exam: { ...w.exam, ...partial } });
  const win = (partial: Partial<WindowRule>) => patch({ window: { ...w.window, ...partial } });
  const mat = (partial: Partial<Material>) => patch({ material: { ...w.material, ...partial } });
  const go = (step: Step, partial: Partial<Wizard> = {}) => {
    err('');
    set({
      ...w,
      ...partial,
      step,
      trail: [...w.trail, { step: w.step, roundIndex: w.roundIndex }],
    });
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
  const back = () => {
    const prior = w.trail.at(-1);
    if (prior) {
      err('');
      set({ ...w, step: prior.step, roundIndex: prior.roundIndex, trail: w.trail.slice(0, -1) });
    }
  };
  const answerAndGo = (kind: ScheduleKind, answer: ScheduleAnswer, step: Step) => {
    void update((s) => ({
      ...answerSchedule(s, kind, answer),
      draft: {
        ...s.draft,
        guided: { ...w, step, trail: [...w.trail, { step: w.step, roundIndex: w.roundIndex }] },
      },
    })).catch((e) => err(String(e)));
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
  const saveAndGo = async (
    kind: 'exam' | 'window' | 'material' | 'exception',
    next: Step,
    partial: Partial<Wizard> = {},
  ) => {
    if (submitting.current) return;
    const settings = { ...state.settings };
    if (kind === 'exam')
      settings.exams = [...settings.exams.filter((x) => x.id !== w.exam.id), w.exam];
    if (kind === 'window')
      settings.windows = [...settings.windows.filter((x) => x.id !== w.window.id), w.window];
    if (kind === 'material')
      settings.materials = [
        ...settings.materials.filter((x) => x.id !== w.material.id),
        w.material,
      ];
    if (kind === 'exception')
      settings.exceptions = [
        ...settings.exceptions.filter((x) => x.id !== w.exception.id),
        w.exception,
      ];
    if (kind === 'exception' || (kind === 'window' && w.window.kind === 'busy')) {
      const scheduleKind = kind === 'exception' ? 'exception' : 'busy';
      settings.scheduleAnswers = { ...settings.scheduleAnswers, [scheduleKind]: 'registered' };
    }
    const errors = validateSettings(settings);
    if (errors.length) {
      err(errors.join(' '));
      return;
    }
    try {
      submitting.current = true;
      setSavingItem(true);
      await update((s) => ({
        ...s,
        settings,
        proposal: null,
        draft: {
          ...s.draft,
          [draftKey]: {
            ...w,
            ...partial,
            step: next,
            trail: mode ? [] : [...w.trail, { step: w.step, roundIndex: w.roundIndex }],
          },
        },
      }));
      err('');
      window.scrollTo({ top: 0, behavior: 'instant' });
    } catch (e) {
      err(String(e));
    } finally {
      submitting.current = false;
      setSavingItem(false);
    }
  };
  const setting = (key: 'focus' | 'block' | 'rest' | 'buffer', value: number) =>
    void update((s) => ({ ...s, settings: { ...s.settings, [key]: value }, proposal: null }));
  const choice = (label: string, selected: boolean, action: () => void) => (
    <button
      key={label}
      className={`wizard-choice ${selected ? 'selected' : ''}`}
      aria-pressed={selected}
      onClick={action}
    >
      {selected && <Check size={17} />}
      <span>{label}</span>
    </button>
  );
  let title = '',
    content: ReactNode = null,
    next: Step | undefined,
    valid = true;
  switch (w.step) {
    case 'exam.name':
      title = '何の試験を受けますか？';
      content = (
        <Field label="試験名">
          <input
            autoFocus
            placeholder="例：基本情報技術者試験"
            value={w.exam.name}
            onChange={(e) => exam({ name: e.target.value })}
          />
        </Field>
      );
      next = 'exam.target';
      valid = !!w.exam.name.trim();
      break;
    case 'exam.target':
      title = 'いつまでの合格を目指しますか？';
      content = (
        <Field label="目標日">
          <input
            type="date"
            value={w.exam.target}
            onChange={(e) => exam({ target: e.target.value })}
          />
        </Field>
      );
      next = 'exam.start';
      valid = !!w.exam.target;
      break;
    case 'exam.start':
      title = 'いつから計画を始めますか？';
      content = (
        <>
          <div className="choices">
            {choice('今日から', w.exam.start === today(), () => exam({ start: today() }))}
          </div>
          <Field label="計画開始日">
            <input
              type="date"
              max={w.exam.target}
              value={w.exam.start}
              onChange={(e) => exam({ start: e.target.value })}
            />
          </Field>
        </>
      );
      next = 'exam.priority';
      valid = !!w.exam.start && w.exam.start <= w.exam.target;
      break;
    case 'exam.priority':
      title = 'この試験の優先度は？';
      content = (
        <div className="wizard-options">
          {[
            [3, '高い'],
            [2, 'ふつう'],
            [1, '低い'],
          ].map(([n, label]) =>
            choice(String(label), w.exam.priority === n, () => exam({ priority: Number(n) })),
          )}
        </div>
      );
      next = 'exam.color';
      break;
    case 'exam.color':
      title = 'この試験の色を選んでください。';
      content = (
        <div className="wizard-options color-options">
          {colors.map((color, i) => (
            <button
              key={color}
              aria-label={`表示色 ${color}`}
              aria-pressed={w.exam.color === color}
              className={w.exam.color === color ? 'selected' : ''}
              onClick={() => exam({ color })}
            >
              <i style={{ background: color }} />
              {['グリーン', 'パープル', 'オレンジ', 'ピンク', 'ブルー'][i]}
              {w.exam.color === color && <Check size={16} />}
            </button>
          ))}
        </div>
      );
      next = 'exam.review';
      break;
    case 'exam.review':
      title = '最後に復習する期間を取りますか？';
      content = (
        <div className="wizard-options">
          {choice('復習期間を設定する', w.exam.reviewDays > 0, () => go('exam.reviewDays'))}
          {choice('今回は設定しない', w.exam.reviewDays === 0, () =>
            go('exam.done', { exam: { ...w.exam, reviewDays: 0 } }),
          )}
        </div>
      );
      break;
    case 'exam.reviewDays':
      title = '復習に何日間、取っておきますか？';
      content = (
        <>
          <div className="choices">
            {[7, 14, 21].map((n) =>
              choice(`${n}日`, w.exam.reviewDays === n, () => exam({ reviewDays: n })),
            )}
          </div>
          <Field label="復習期間（日）">
            <input
              type="number"
              min="1"
              value={w.exam.reviewDays}
              onChange={(e) => exam({ reviewDays: +e.target.value })}
            />
          </Field>
        </>
      );
      next = 'exam.done';
      valid =
        Number.isInteger(w.exam.reviewDays) &&
        w.exam.reviewDays > 0 &&
        addDays(w.exam.start, w.exam.reviewDays) <= w.exam.target;
      break;
    case 'exam.done':
      title = '目標はこれでよいですか？';
      content = (
        <>
          <div className="answer-summary">
            <h3>{w.exam.name}</h3>
            <p>
              {w.exam.start} → {w.exam.target}
            </p>
            <p>
              優先度：{['', '低い', 'ふつう', '高い'][w.exam.priority]} · 復習 {w.exam.reviewDays}日
            </p>
          </div>
          <div className="wizard-options">
            {mode ? (
              <button
                data-submit
                className="primary"
                disabled={savingItem}
                onClick={() => saveAndGo('exam', 'addition.saved')}
              >
                試験を登録する
              </button>
            ) : (
              <>
                <button
                  data-submit
                  className="primary"
                  onClick={() => saveAndGo('exam', 'window.period')}
                >
                  保存して、勉強できる時間へ
                  <ArrowRight size={17} />
                </button>
                <button onClick={() => saveAndGo('exam', 'exam.name', { exam: newExam() })}>
                  <Plus size={17} />
                  別の試験も追加する
                </button>
              </>
            )}
          </div>
          {mode && (
            <p className="hint">
              {state.proposal
                ? '登録後、承認待ちの計画案は作り直します。'
                : '登録後に教材を追加できます。'}
              計画への反映は、計画案の承認後です。
            </p>
          )}
        </>
      );
      break;
    case 'window.period':
    case 'busy.period':
      title =
        w.step === 'window.period'
          ? 'この時間の設定を、いつまで使いますか？'
          : 'この定期予定の期間は？';
      content = (
        <div className="two">
          <Field label="適用開始日">
            <input
              type="date"
              value={w.window.from}
              onChange={(e) => win({ from: e.target.value })}
            />
          </Field>
          <Field label="適用終了日">
            <input
              type="date"
              min={w.window.from}
              value={w.window.to}
              onChange={(e) => win({ to: e.target.value })}
            />
          </Field>
        </div>
      );
      next = w.step === 'window.period' ? 'window.days' : 'busy.days';
      valid = !!w.window.from && w.window.from <= w.window.to;
      break;
    case 'window.days':
    case 'busy.days':
      title = w.step === 'window.days' ? 'どの曜日に勉強できますか？' : '何曜日の予定ですか？';
      content = (
        <div className="choices weekday-choices">
          {weekdays.map((label, i) =>
            choice(label, w.window.weekdays.includes(i), () =>
              win({
                weekdays: w.window.weekdays.includes(i)
                  ? w.window.weekdays.filter((d) => d !== i)
                  : [...w.window.weekdays, i],
              }),
            ),
          )}
        </div>
      );
      next = w.step === 'window.days' ? 'window.time' : 'busy.time';
      valid = w.window.weekdays.length > 0;
      break;
    case 'window.time':
    case 'busy.time':
      title =
        w.step === 'window.time'
          ? '何時から何時まで勉強できますか？'
          : '予定は何時から何時までですか？';
      content = (
        <div className="two">
          <Field
            label={w.step === 'window.time' ? '勉強できる開始時刻' : '予定の開始時刻'}
            hint={
              w.step === 'window.time'
                ? 'これより前には学習を入れません。'
                : 'ここから学習不可です。'
            }
          >
            <input
              type="time"
              value={clock(w.window.start)}
              onChange={(e) => win({ start: minutes(e.target.value) })}
            />
          </Field>
          <Field
            label={w.step === 'window.time' ? '勉強できる終了時刻' : '予定の終了時刻'}
            hint={
              w.step === 'window.time'
                ? 'これより後には学習を入れません。'
                : 'ここまで学習不可です。'
            }
          >
            <input
              type="time"
              value={clock(w.window.end)}
              onChange={(e) => win({ end: minutes(e.target.value) })}
            />
          </Field>
        </div>
      );
      next = w.step === 'window.time' ? 'window.done' : 'busy.done';
      valid = w.window.start >= 0 && w.window.end > w.window.start && w.window.end <= 1440;
      break;
    case 'window.done':
    case 'busy.done':
      title = 'ほかの時間帯も追加しますか？';
      content = (
        <>
          <div className="answer-summary">
            <h3>{w.window.name}</h3>
            <p>
              {w.window.weekdays.map((d) => weekdays[d]).join('・')}　{clock(w.window.start)}〜
              {clock(w.window.end)}
            </p>
            <p>
              {w.window.from}〜{w.window.to}
            </p>
          </div>
          <div className="wizard-options">
            <button
              data-submit
              className="primary"
              onClick={() =>
                saveAndGo('window', w.step === 'window.done' ? 'class.ask' : 'exception.ask')
              }
            >
              保存して次へ
              <ArrowRight size={17} />
            </button>
            <button
              onClick={() =>
                saveAndGo('window', w.step === 'window.done' ? 'window.period' : 'busy.name', {
                  window: newWindow(w.window.kind),
                })
              }
            >
              <Plus size={17} />
              もう一つ追加する
            </button>
          </div>
        </>
      );
      break;
    case 'class.ask':
      title = '大学の授業を登録しますか？';
      content = (
        <div className="wizard-options">
          <button data-submit className="primary" onClick={() => go('class.period')}>
            時間割を登録する
          </button>
          <button
            onClick={() =>
              answerAndGo(
                'class',
                scheduleCount(state.settings, 'class') ? 'registered' : 'none',
                'busy.ask',
              )
            }
          >
            {scheduleCount(state.settings, 'class') ? '登録済みの授業で進める' : '授業はない'}
          </button>
          <SkipImpact kind="class" />
          <button onClick={() => answerAndGo('class', 'deferred', 'busy.ask')}>
            あとで設定する
          </button>
        </div>
      );
      break;
    case 'class.period':
      title = 'この時間割は、いつの期間ですか？';
      content = (
        <div className="two">
          <Field label="時間割の適用開始">
            <input
              type="date"
              value={w.classFrom}
              onChange={(e) => patch({ classFrom: e.target.value })}
            />
          </Field>
          <Field label="時間割の適用終了">
            <input
              type="date"
              min={w.classFrom}
              value={w.classTo}
              onChange={(e) => patch({ classTo: e.target.value })}
            />
          </Field>
        </div>
      );
      next = 'class.times';
      valid = !!w.classFrom && w.classFrom <= w.classTo;
      break;
    case 'class.times':
      title = '授業の開始時刻は合っていますか？';
      content = (
        <>
          <div className="answer-summary">
            {state.settings.periods.map((t, i) => (
              <div className="row" key={i}>
                <span>{i + 1}限</span>
                {editTimes ? (
                  <input
                    aria-label={`${i + 1}限の開始`}
                    type="time"
                    value={clock(t)}
                    onChange={(e) => {
                      const v = minutes(e.target.value);
                      if (v >= 0 && v + 100 <= 1440)
                        void update((s) => ({
                          ...s,
                          settings: {
                            ...s.settings,
                            periods: s.settings.periods.map((a, j) => (j === i ? v : a)),
                            windows: s.settings.windows.map((rule) =>
                              rule.kind === 'class' &&
                              rule.start === t &&
                              rule.from === w.classFrom &&
                              rule.to === w.classTo
                                ? { ...rule, start: v, end: v + 100 }
                                : rule,
                            ),
                          },
                          proposal: null,
                        }));
                    }}
                  />
                ) : (
                  <b>
                    {clock(t)}〜{clock(t + 100)}
                  </b>
                )}
              </div>
            ))}
          </div>
          <button onClick={() => setEditTimes(!editTimes)}>
            {editTimes ? '時刻の編集を終了' : '開始時刻を変更する'}
          </button>
        </>
      );
      next = 'class.grid';
      break;
    case 'class.grid':
      title = '授業があるコマを押してください。';
      content = (
        <>
          <div className="timetable wizard-timetable">
            <div>時限</div>
            {[1, 2, 3, 4, 5].map((d) => (
              <b key={d}>{weekdays[d]}</b>
            ))}
            {state.settings.periods.map((t, i) => (
              <div className="timetable-row" key={i}>
                <span>
                  {i + 1}限 <small>{clock(t)}</small>
                </span>
                {[1, 2, 3, 4, 5].map((day) => {
                  const found = state.settings.windows.find(
                    (x) =>
                      x.kind === 'class' &&
                      x.start === t &&
                      x.weekdays[0] === day &&
                      x.from === w.classFrom &&
                      x.to === w.classTo,
                  );
                  return (
                    <button
                      key={day}
                      className={found ? 'class-selected' : ''}
                      aria-label={`${weekdays[day]}曜${i + 1}限`}
                      aria-pressed={!!found}
                      onClick={() =>
                        void update((s) => ({
                          ...s,
                          settings: {
                            ...s.settings,
                            windows: found
                              ? s.settings.windows.filter((x) => x.id !== found.id)
                              : [
                                  ...s.settings.windows,
                                  {
                                    id: uid(),
                                    kind: 'class',
                                    name: '大学の授業',
                                    from: w.classFrom,
                                    to: w.classTo,
                                    weekdays: [day],
                                    start: t,
                                    end: t + 100,
                                  },
                                ],
                          },
                          proposal: null,
                        }))
                      }
                    >
                      {found ? (
                        <span>
                          授業<small>学習不可</small>
                        </span>
                      ) : (
                        <Plus size={14} />
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          <ClassNames state={state} update={update} from={w.classFrom} to={w.classTo} />
          <TimetablePreview settings={state.settings} from={w.classFrom} to={w.classTo} />
        </>
      );
      next = 'busy.ask';
      break;
    case 'busy.ask':
      title = '授業以外に、毎週の予定はありますか？';
      content = (
        <div className="wizard-options">
          <button onClick={() => go('busy.name', { window: newWindow('busy') })}>
            定期予定を登録する
          </button>
          <button
            data-submit
            className="primary"
            onClick={() =>
              answerAndGo(
                'busy',
                scheduleCount(state.settings, 'busy') ? 'registered' : 'none',
                'exception.ask',
              )
            }
          >
            {scheduleCount(state.settings, 'busy')
              ? '登録済みの定期予定で進める'
              : '定期予定はない'}
            <ArrowRight size={17} />
          </button>
          <SkipImpact kind="busy" />
          <button onClick={() => answerAndGo('busy', 'deferred', 'exception.ask')}>
            あとで設定する
          </button>
        </div>
      );
      break;
    case 'busy.name':
      title = 'どんな定期予定ですか？';
      content = (
        <Field label="予定の名前">
          <input
            value={w.window.name}
            onChange={(e) => win({ name: e.target.value })}
            placeholder="例：アルバイト"
          />
        </Field>
      );
      next = 'busy.period';
      valid = !!w.window.name.trim();
      break;
    case 'exception.ask':
      title = '勉強できない特定の日はありますか？';
      content = (
        <div className="wizard-options">
          <button
            onClick={() =>
              go('exception.date', {
                exception: {
                  id: uid(),
                  name: '勉強できない予定',
                  date: today(),
                  start: 0,
                  end: 1440,
                },
              })
            }
          >
            勉強できない予定を追加
          </button>
          <button
            data-submit
            className="primary"
            onClick={() =>
              answerAndGo(
                'exception',
                scheduleCount(state.settings, 'exception') ? 'registered' : 'none',
                'meals',
              )
            }
          >
            {scheduleCount(state.settings, 'exception')
              ? '登録済みの単発予定で進める'
              : '勉強できない日はない'}
            <ArrowRight size={17} />
          </button>
          <SkipImpact kind="exception" />
          <button onClick={() => answerAndGo('exception', 'deferred', 'meals')}>
            あとで設定する
          </button>
        </div>
      );
      break;
    case 'exception.date':
      title = '勉強できないのは、いつですか？';
      content = (
        <Field label="予定日">
          <input
            type="date"
            value={w.exception.date}
            onChange={(e) => patch({ exception: { ...w.exception, date: e.target.value } })}
          />
        </Field>
      );
      next = 'exception.kind';
      valid = !!w.exception.date;
      break;
    case 'exception.kind':
      title = '一日中、それとも一部の時間ですか？';
      content = (
        <div className="wizard-options">
          <button
            onClick={() =>
              go('exception.done', { exception: { ...w.exception, start: 0, end: 1440 } })
            }
          >
            終日、勉強できない
          </button>
          <button
            onClick={() =>
              go('exception.time', { exception: { ...w.exception, start: 600, end: 720 } })
            }
          >
            時間帯だけ指定する
          </button>
        </div>
      );
      break;
    case 'exception.time':
      title = '何時から何時まで予定がありますか？';
      content = (
        <div className="two">
          <Field label="予定の開始時刻">
            <input
              type="time"
              value={clock(w.exception.start)}
              onChange={(e) =>
                patch({ exception: { ...w.exception, start: minutes(e.target.value) } })
              }
            />
          </Field>
          <Field label="予定の終了時刻">
            <input
              type="time"
              value={clock(w.exception.end)}
              onChange={(e) =>
                patch({ exception: { ...w.exception, end: minutes(e.target.value) } })
              }
            />
          </Field>
        </div>
      );
      next = 'exception.done';
      valid = w.exception.start >= 0 && w.exception.end > w.exception.start;
      break;
    case 'exception.done':
      title = 'この予定を登録します。';
      content = (
        <>
          <div className="answer-summary">
            <b>{w.exception.date}</b>
            <p>
              {w.exception.end === 1440 && w.exception.start === 0
                ? '終日'
                : `${clock(w.exception.start)}〜${clock(w.exception.end)}`}
            </p>
          </div>
          <div className="wizard-options">
            <button data-submit className="primary" onClick={() => saveAndGo('exception', 'meals')}>
              保存して次へ
            </button>
            <button onClick={() => saveAndGo('exception', 'exception.ask')}>
              ほかの予定も追加する
            </button>
          </div>
        </>
      );
      break;
    case 'focus.total': // Continue older in-progress setup at the new meal questions.
    case 'meals':
      title = '食事の時間も確保しましょう';
      content = <MealSetup state={state} update={update} onDone={() => go('focus.block')} />;
      break;
    case 'focus.block':
      title = '最長で何分続けて勉強できますか？';
      content = (
        <>
          <div className="choices">
            {[25, 50, 60].map((n) =>
              choice(`${n}分`, state.settings.block === n, () => setting('block', n)),
            )}
          </div>
          <Field label="連続で勉強できる最長時間（分）">
            <input
              type="number"
              min="1"
              max={1440}
              value={state.settings.block}
              onChange={(e) => setting('block', +e.target.value)}
            />
          </Field>
        </>
      );
      next = 'focus.rest';
      valid = state.settings.block > 0 && state.settings.block <= 1440;
      break;
    case 'focus.rest':
      title = '間に何分、休憩しますか？';
      content = (
        <>
          <div className="choices">
            {[5, 10, 15].map((n) =>
              choice(`${n}分`, state.settings.rest === n, () => setting('rest', n)),
            )}
          </div>
          <Field label="ブロック間の休憩（分）">
            <input
              type="number"
              min="1"
              max="1440"
              value={state.settings.rest}
              onChange={(e) => setting('rest', +e.target.value)}
            />
          </Field>
        </>
      );
      next = 'material.exam';
      valid = state.settings.rest >= 1 && state.settings.rest <= 1440;
      break;
    case 'material.exam':
      title = 'どの試験の教材を登録しますか？';
      content = (
        <div className="wizard-options">
          {state.settings.exams.map((e) =>
            choice(e.name, w.material.examId === e.id, () => mat({ examId: e.id })),
          )}
        </div>
      );
      next = 'material.name';
      valid = state.settings.exams.some((e) => e.id === w.material.examId);
      break;
    case 'material.name':
      title = '教材の名前を教えてください。';
      content = (
        <Field label="教材名">
          <input
            placeholder="例：過去問題集"
            value={w.material.name}
            onChange={(e) => mat({ name: e.target.value })}
          />
        </Field>
      );
      next = 'material.total';
      valid = !!w.material.name.trim();
      break;
    case 'material.total':
      title = '問題は全部で何問ありますか？';
      content = (
        <Field label="総問題数">
          <input
            type="number"
            min="1"
            max="1000000000"
            value={w.material.total}
            onChange={(e) => mat({ total: +e.target.value })}
          />
        </Field>
      );
      next = 'material.rounds';
      valid = Number.isInteger(w.material.total) && w.material.total > 0;
      break;
    case 'material.rounds':
      title = 'この教材を何周しますか？';
      content = (
        <>
          <div className="choices">
            {[1, 2, 3].map((n) =>
              choice(`${n}周`, w.material.rounds.length === n, () =>
                mat({
                  rounds: Array.from(
                    { length: n },
                    (_, i) => w.material.rounds[i] ?? { completed: 0, minutes: 2 },
                  ),
                }),
              ),
            )}
          </div>
          <Field label="周回数">
            <input
              type="number"
              min="1"
              max="20"
              value={w.material.rounds.length}
              onChange={(e) =>
                mat({
                  rounds: Array.from(
                    { length: Math.min(20, Math.max(1, +e.target.value)) },
                    (_, i) => w.material.rounds[i] ?? { completed: 0, minutes: 2 },
                  ),
                })
              }
            />
          </Field>
        </>
      );
      next = 'material.completed';
      break;
    case 'material.completed': {
      const i = Math.min(w.roundIndex, w.material.rounds.length - 1);
      title = `${i + 1}周目は、すでに何問終わっていますか？`;
      content = (
        <Field label={`${i + 1}周目の初期完了数`} hint="記録画面から追加した問題数は含めません。">
          <input
            type="number"
            min="0"
            max={w.material.total}
            value={w.material.rounds[i].completed}
            onChange={(e) =>
              mat({
                rounds: w.material.rounds.map((r, j) =>
                  i === j ? { ...r, completed: +e.target.value } : r,
                ),
              })
            }
          />
        </Field>
      );
      valid =
        Number.isInteger(w.material.rounds[i].completed) &&
        w.material.rounds[i].completed >= 0 &&
        w.material.rounds[i].completed <= w.material.total;
      break;
    }
    case 'material.minutes':
      title = '1問に何分くらいかかりそうですか？';
      content = (
        <Field label="1問あたりの推定時間（分）">
          <input
            type="number"
            min="0.1"
            step="0.1"
            value={w.material.rounds[0].minutes}
            onChange={(e) =>
              mat({ rounds: w.material.rounds.map((r) => ({ ...r, minutes: +e.target.value })) })
            }
          />
        </Field>
      );
      next = w.material.rounds.length > 1 ? 'material.custom' : 'material.order';
      valid = w.material.rounds[0].minutes > 0;
      break;
    case 'material.custom':
      title = '周回ごとに、所要時間を変えますか？';
      content = (
        <div className="wizard-options">
          <button
            data-submit
            className="primary"
            onClick={() =>
              go('material.order', {
                material: {
                  ...w.material,
                  rounds: w.material.rounds.map((r) => ({
                    ...r,
                    minutes: w.material.rounds[0].minutes,
                  })),
                },
              })
            }
          >
            すべて同じ時間で進める
          </button>
          <button onClick={() => go('material.roundMinutes', { roundIndex: 1 })}>
            周回ごとに変更する
          </button>
        </div>
      );
      break;
    case 'material.roundMinutes': {
      const i = Math.min(w.roundIndex, w.material.rounds.length - 1);
      title = `${i + 1}周目は1問に何分かけますか？`;
      content = (
        <Field label={`${i + 1}周目の推定時間（分）`}>
          <input
            type="number"
            min="0.1"
            step="0.1"
            value={w.material.rounds[i].minutes}
            onChange={(e) =>
              mat({
                rounds: w.material.rounds.map((r, j) =>
                  i === j ? { ...r, minutes: +e.target.value } : r,
                ),
              })
            }
          />
        </Field>
      );
      valid = w.material.rounds[i].minutes > 0;
      break;
    }
    case 'material.order':
      title = 'この教材は何番目に取り組みますか？';
      content = (
        <Field label="取り組む順序">
          <input
            type="number"
            min="1"
            value={w.material.order}
            onChange={(e) => mat({ order: +e.target.value })}
          />
        </Field>
      );
      next = 'material.done';
      valid = Number.isInteger(w.material.order) && w.material.order > 0;
      break;
    case 'material.done':
      title = mode ? 'この教材を登録しますか？' : 'ほかの教材も登録しますか？';
      content = (
        <>
          <div className="answer-summary">
            <h3>{w.material.name}</h3>
            {mode && <p>{state.settings.exams.find((e) => e.id === w.material.examId)?.name}</p>}
            <p>
              {w.material.total}問 × {w.material.rounds.length}周 · {w.material.order}番目
            </p>
            {w.material.rounds.map((r, i) => (
              <p key={i}>
                {i + 1}周目：初期完了 {r.completed}問 · 1問 {r.minutes}分
              </p>
            ))}
          </div>
          <div className="wizard-options">
            {mode ? (
              <button
                data-submit
                className="primary"
                disabled={savingItem}
                onClick={() => saveAndGo('material', 'addition.saved')}
              >
                教材を登録する
              </button>
            ) : (
              <>
                <button
                  data-submit
                  className="primary"
                  onClick={() => saveAndGo('material', 'buffer')}
                >
                  保存して、最後の質問へ
                  <ArrowRight size={17} />
                </button>
                <button
                  onClick={() =>
                    saveAndGo('material', 'material.exam', {
                      material: newMaterial(w.material.examId),
                      roundIndex: 0,
                    })
                  }
                >
                  <Plus size={17} />
                  別の教材も追加する
                </button>
              </>
            )}
          </div>
          {mode && (
            <p className="hint">
              登録内容を保存します。カレンダーへの反映は計画案の承認後です。
              {state.proposal && '承認待ちの案は作り直します。'}
            </p>
          )}
        </>
      );
      break;
    case 'addition.saved':
      title = `${mode === 'addExam' ? w.exam.name : w.material.name}を登録しました`;
      content = (
        <>
          {mode === 'addExam' && (
            <div className="actions">
              <button className="primary" onClick={() => onAddMaterial?.(w.exam.id)}>
                {materialDraftPending ? '入力途中の教材の追加を再開' : 'この試験の教材を追加'}
              </button>
            </div>
          )}
          {mode === 'addExam' && !state.settings.materials.some((m) => m.examId === w.exam.id) && (
            <p className="hint">この試験の学習予定は、教材を追加してから作成できます。</p>
          )}
          <RegistrationStatus
            state={state}
            onGenerate={onGenerate}
            onReview={onReview!}
            onConfigure={onConfigure!}
          />
          <button onClick={onClose}>一覧へ戻る</button>
        </>
      );
      break;
    case 'buffer':
      title = 'どのくらい余裕を残しますか？';
      content = (
        <>
          <div className="choices large">
            {[0.1, 0.2, 0.3].map((b) =>
              choice(
                `${b * 100}%${b === 0.2 ? '（初期値）' : ''}`,
                !otherBuffer && state.settings.buffer === b,
                () => {
                  setOtherBuffer(false);
                  setting('buffer', b);
                },
              ),
            )}
            {choice('その他', otherBuffer, () => setOtherBuffer(true))}
          </div>
          {otherBuffer && (
            <Field label="余裕率（%）">
              <input
                type="number"
                min="0"
                max="99"
                value={Math.round(state.settings.buffer * 100)}
                onChange={(e) => setting('buffer', +e.target.value / 100)}
              />
            </Field>
          )}
          <p className="hint">20%は初期値です。自由に変更できます。</p>
        </>
      );
      next = 'finish';
      valid = state.settings.buffer >= 0 && state.settings.buffer < 1;
      break;
    case 'finish':
      title = '設定の確認';
      content = (
        <>
          <div className="answer-summary">
            <p>
              試験 <b>{state.settings.exams.length}件</b> · 教材{' '}
              <b>{state.settings.materials.length}件</b>
            </p>
            <p>
              連続で最長 {state.settings.block}分 → 休憩 {state.settings.rest}分 → 勉強 · 余裕率{' '}
              {Math.round(state.settings.buffer * 100)}%
            </p>
          </div>
          <SetupImpact
            settings={state.settings}
            onConfigureStudy={(gap) =>
              go('window.period', {
                window: { ...newWindow(), from: gap.from, to: gap.to },
              })
            }
            onConfigure={(kind) =>
              go(kind === 'class' ? 'class.ask' : kind === 'busy' ? 'busy.ask' : 'exception.ask')
            }
          />
          <button
            data-submit
            className="primary wide"
            onClick={onGenerate}
            disabled={setupIssues(state.settings).some((i) => i.severity === 'error')}
          >
            計画案を作成する
            <ArrowRight size={17} />
          </button>
        </>
      );
      break;
  }
  const phase = w.step.startsWith('exam')
    ? 0
    : ['window', 'class', 'busy', 'exception', 'meals'].some((p) => w.step.startsWith(p))
      ? 1
      : w.step.startsWith('focus')
        ? 2
        : w.step.startsWith('material')
          ? 3
          : 4;
  const advance = () => {
    if (w.step === 'class.period' && w.classEditingPeriod) {
      const old = w.classEditingPeriod;
      void update((s) => ({
        ...s,
        settings: {
          ...s.settings,
          windows: s.settings.windows.map((x) =>
            x.kind === 'class' && x.from === old.from && x.to === old.to
              ? { ...x, from: w.classFrom, to: w.classTo }
              : x,
          ),
        },
        draft: {
          ...s.draft,
          guided: {
            ...w,
            step: 'class.times',
            classEditingPeriod: { from: w.classFrom, to: w.classTo },
            trail: [...w.trail, { step: w.step, roundIndex: w.roundIndex }],
          },
        },
      })).catch((e) => err(String(e)));
    } else if (w.step === 'class.grid') {
      answerAndGo(
        'class',
        scheduleCount(state.settings, 'class') ? 'registered' : 'none',
        'busy.ask',
      );
    } else if (w.step === 'material.completed' || w.step === 'material.roundMinutes') {
      const i = w.roundIndex;
      if (i < w.material.rounds.length - 1) go(w.step, { roundIndex: i + 1 });
      else
        go(w.step === 'material.completed' ? 'material.minutes' : 'material.order', {
          roundIndex: 0,
        });
    } else if (next) go(next, next === 'material.completed' ? { roundIndex: 0 } : {});
  };
  return (
    <div className="guided-setup">
      {!mode && (
        <section className="card setup-tools">
          <button onClick={() => setEditing(!editing)}>
            {editing ? '項目選択を閉じる' : '設定項目を選んで修正する'}
          </button>
          {editing && (
            <div aria-label="初期設定の項目選択" role="region">
              <h3>どの設定を修正しますか？</h3>
              <p>
                登録済みの内容を引き継いで、その質問へ移動します。保存済みの計画は再計画を承認してから更新します。
              </p>
              <div className="wizard-options">
                {state.settings.exams.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => {
                      go('exam.name', { exam: e });
                      setEditing(false);
                    }}
                  >
                    試験・目標：{e.name}
                  </button>
                ))}
                <button
                  onClick={() => {
                    go('exam.name', { exam: newExam() });
                    setEditing(false);
                  }}
                >
                  試験を追加する
                </button>
                {state.settings.materials.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => {
                      go('material.exam', { material: m, roundIndex: 0 });
                      setEditing(false);
                    }}
                  >
                    教材：{m.name}
                  </button>
                ))}
                <button
                  onClick={() => {
                    go('material.exam', {
                      material: newMaterial(state.settings.exams[0]?.id ?? ''),
                      roundIndex: 0,
                    });
                    setEditing(false);
                  }}
                >
                  教材を追加する
                </button>
                {state.settings.windows
                  .filter((x) => x.kind !== 'class')
                  .map((x) => (
                    <button
                      key={x.id}
                      onClick={() => {
                        go(x.kind === 'study' ? 'window.period' : 'busy.name', { window: x });
                        setEditing(false);
                      }}
                    >
                      {x.kind === 'study' ? '勉強できる時間' : '定期予定'}：{x.name}
                    </button>
                  ))}
                <button
                  onClick={() => {
                    go('window.period', { window: newWindow() });
                    setEditing(false);
                  }}
                >
                  学習可能枠を追加する
                </button>
                {[
                  ...new Set(
                    state.settings.windows
                      .filter((x) => x.kind === 'class')
                      .map((x) => x.from + '|' + x.to),
                  ),
                ].map((period) => {
                  const [from, to] = period.split('|');
                  return (
                    <button
                      key={period}
                      onClick={() => {
                        go('class.period', {
                          classFrom: from,
                          classTo: to,
                          classEditingPeriod: { from, to },
                        });
                        setEditing(false);
                      }}
                    >
                      大学の授業：{from}〜{to}
                    </button>
                  );
                })}
                <button
                  onClick={() => {
                    go('class.ask', { classEditingPeriod: undefined });
                    setEditing(false);
                  }}
                >
                  大学の時間割を設定する
                </button>
                <button
                  onClick={() => {
                    go('busy.ask');
                    setEditing(false);
                  }}
                >
                  定期予定を追加・確認する
                </button>
                {state.settings.exceptions.map((x) => (
                  <button
                    key={x.id}
                    onClick={() => {
                      go('exception.date', { exception: x });
                      setEditing(false);
                    }}
                  >
                    特定日の予定：{x.date} {x.name}
                  </button>
                ))}
                <button
                  onClick={() => {
                    go('exception.ask');
                    setEditing(false);
                  }}
                >
                  特定日の予定を追加・確認する
                </button>
                <button
                  onClick={() => {
                    go('meals');
                    setEditing(false);
                  }}
                >
                  食事時間を修正する
                </button>
                <button
                  onClick={() => {
                    go('focus.block');
                    setEditing(false);
                  }}
                >
                  連続時間・休憩を修正する
                </button>
                <button
                  onClick={() => {
                    go('buffer');
                    setEditing(false);
                  }}
                >
                  余裕率を修正する
                </button>
              </div>
            </div>
          )}
          <ResetSetup state={state} update={update} />
        </section>
      )}
      {!mode && (
        <div className="guided-phases">
          {['試験・目標', '勉強できる時間', '連続時間と休憩', '教材', '余裕率'].map((name, i) => (
            <span key={name} className={i === phase ? 'active' : i < phase ? 'complete' : ''}>
              <i>{i < phase ? <Check size={12} /> : i + 1}</i>
              {name}
            </span>
          ))}
        </div>
      )}
      <section className="card question-card" aria-label={mode ? '追加の質問' : undefined}>
        <div className="eyebrow">
          {mode
            ? w.step === 'addition.saved'
              ? '登録完了'
              : '一つずつ、決めていきましょう'
            : `${phase + 1} / 5 · 一つずつ、決めていきましょう`}
        </div>
        <h2>{title}</h2>
        {w.step === 'class.times' && <p className="hint">1コマ100分</p>}
        {w.step === 'class.grid' && (
          <p className="hint">
            適用期間：{w.classFrom}〜{w.classTo}
          </p>
        )}
        <div className="question-answer">{content}</div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {w.step !== 'addition.saved' && (
          <div className="question-footer">
            <button disabled={!w.trail.length} onClick={back}>
              <ArrowLeft size={16} />
              前の質問
            </button>
            {(next || w.step === 'material.completed' || w.step === 'material.roundMinutes') && (
              <button data-submit className="primary" disabled={!valid} onClick={advance}>
                次へ
                <ArrowRight size={16} />
              </button>
            )}
          </div>
        )}
      </section>
      <div className="guided-save">
        <Check size={14} />
        {mode && w.step !== 'addition.saved'
          ? '入力途中は自動保存されます。登録は最後の確認で行います。'
          : '入力は自動保存されます。'}
      </div>
      {mode && w.step !== 'addition.saved' && (
        <button onClick={onClose}>中断して一覧へ（続きは保存）</button>
      )}
    </div>
  );
}
