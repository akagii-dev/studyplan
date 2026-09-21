import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { useRef, useState } from 'react';
import { Exam, Material, ScheduleAnswer, ScheduleKind, WindowRule } from '../../domain/model';
import { answerSchedule } from '../../domain/setupIssues';
import { Props, useDraft } from '../common';
import { ResetSetup } from '../ResetSetup';
import { AvailabilitySteps } from './AvailabilitySteps';
import { ExamSteps } from './ExamSteps';
import { FinishSteps } from './FinishSteps';
import { FocusSteps } from './FocusSteps';
import { MaterialSteps } from './MaterialSteps';
import { Addition, Step, Wizard, initialWizard, newExam, newMaterial, newWindow } from './model';
import { advanceQuestion, moveTo, nextStep, previousQuestion, saveAnswer } from './transitions';
import { StepContext } from './types';
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
    set(moveTo(w, step, partial));
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
  const back = () => {
    const prior = w.trail.at(-1);
    if (prior) {
      err('');
      set(previousQuestion(w));
    }
  };
  const answerAndGo = (kind: ScheduleKind, answer: ScheduleAnswer, step: Step) => {
    void update((s) => ({
      ...answerSchedule(s, kind, answer),
      draft: {
        ...s.draft,
        guided: moveTo(w, step),
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
    try {
      submitting.current = true;
      setSavingItem(true);
      await update((s) => saveAnswer(s, w, draftKey, kind, next, partial, !!mode));
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
  const ctx: StepContext = {
    state,
    update,
    mode,
    w,
    exam,
    win,
    mat,
    patch,
    go,
    choice,
    setting,
    saveAndGo,
    answerAndGo,
    editTimes,
    setEditTimes,
    otherBuffer,
    setOtherBuffer,
    savingItem,
    materialDraftPending,
    onGenerate,
    onClose,
    onAddMaterial,
    onReview,
    onConfigure,
  };
  const { title, content, valid } = ExamSteps(ctx) ??
    AvailabilitySteps(ctx) ??
    FocusSteps(ctx) ??
    MaterialSteps(ctx) ??
    FinishSteps(ctx) ?? { title: '', content: null, valid: false };
  const next = nextStep(w);
  const phase = w.step.startsWith('exam')
    ? 0
    : ['window', 'class', 'busy', 'exception', 'meals', 'outside'].some((p) => w.step.startsWith(p))
      ? 1
      : w.step.startsWith('focus')
        ? 2
        : w.step.startsWith('material')
          ? 3
          : 4;
  const advance = () => {
    void update((s) => advanceQuestion(s, w, draftKey)).catch((e) => err(String(e)));
    window.scrollTo({ top: 0, behavior: 'instant' });
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
                    go('outside.sleep');
                    setEditing(false);
                  }}
                >
                  睡眠・風呂を修正する
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
