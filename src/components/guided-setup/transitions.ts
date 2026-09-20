import { AppState } from '../../domain/model';
import { validateSettings } from '../../domain/planner/validation';
import { answerSchedule, scheduleCount } from '../../domain/setupIssues';
import { Step, Wizard } from './model';

/** Preserve edits to an existing item and all other settings, then jump to the summary. */
export function skipRemaining(state: AppState, w: Wizard, draftKey = 'guided'): AppState {
  const settings = structuredClone(state.settings);
  if (w.step.startsWith('exam.') && settings.exams.some((x) => x.id === w.exam.id))
    settings.exams = settings.exams.map((x) => (x.id === w.exam.id ? structuredClone(w.exam) : x));
  if (w.step.startsWith('material.') && settings.materials.some((x) => x.id === w.material.id))
    settings.materials = settings.materials.map((x) =>
      x.id === w.material.id ? structuredClone(w.material) : x,
    );
  if (
    (w.step.startsWith('window.') || w.step.startsWith('busy.')) &&
    settings.windows.some((x) => x.id === w.window.id)
  )
    settings.windows = settings.windows.map((x) =>
      x.id === w.window.id ? structuredClone(w.window) : x,
    );
  if (w.step.startsWith('exception.') && settings.exceptions.some((x) => x.id === w.exception.id))
    settings.exceptions = settings.exceptions.map((x) =>
      x.id === w.exception.id ? structuredClone(w.exception) : x,
    );
  if (w.step === 'class.period' && w.classEditingPeriod) {
    const old = w.classEditingPeriod;
    settings.windows = settings.windows.map((x) =>
      x.kind === 'class' && x.from === old.from && x.to === old.to
        ? { ...x, from: w.classFrom, to: w.classTo }
        : x,
    );
  }
  const errors = validateSettings(settings);
  if (errors.length) throw new Error(errors.join(' '));
  return { ...state, settings, draft: { ...state.draft, [draftKey]: moveTo(w, 'finish') } };
}

/** Navigation rules have no rendering, saving, or browser side effects. */
export function nextStep(w: Wizard): Step | undefined {
  const next: Partial<Record<Step, Step>> = {
    'exam.name': 'exam.target',
    'exam.target': 'exam.start',
    'exam.start': 'exam.priority',
    'exam.priority': 'exam.color',
    'exam.color': 'exam.review',
    'exam.reviewDays': 'exam.done',
    'window.period': 'window.days',
    'window.days': 'window.time',
    'window.time': 'window.done',
    'busy.name': 'busy.period',
    'busy.period': 'busy.days',
    'busy.days': 'busy.time',
    'busy.time': 'busy.done',
    'class.period': 'class.times',
    'class.times': 'class.grid',
    'class.grid': 'busy.ask',
    'exception.date': 'exception.kind',
    'exception.time': 'exception.done',
    'focus.block': 'focus.rest',
    'focus.rest': 'material.exam',
    'material.exam': 'material.name',
    'material.name': 'material.total',
    'material.total': 'material.rounds',
    'material.rounds': 'material.completed',
    'material.order': 'material.done',
    buffer: 'finish',
  };
  if (w.step === 'material.minutes')
    return w.material.rounds.length > 1 ? 'material.custom' : 'material.order';
  if (w.step === 'material.completed' || w.step === 'material.roundMinutes') {
    return w.roundIndex < w.material.rounds.length - 1
      ? w.step
      : w.step === 'material.completed'
        ? 'material.minutes'
        : 'material.order';
  }
  return next[w.step];
}
export function moveTo(w: Wizard, step: Step, partial: Partial<Wizard> = {}): Wizard {
  return {
    ...w,
    ...partial,
    step,
    trail: [...w.trail, { step: w.step, roundIndex: w.roundIndex }],
  };
}
export function previousQuestion(w: Wizard): Wizard {
  const previous = w.trail.at(-1);
  return previous ? { ...w, ...previous, trail: w.trail.slice(0, -1) } : w;
}
export function advanceQuestion(state: AppState, w: Wizard, draftKey: string): AppState {
  const next = nextStep(w);
  if (!next) return state;
  let result = state;
  const partial: Partial<Wizard> = {};
  if (w.step === 'class.period' && w.classEditingPeriod) {
    const old = w.classEditingPeriod;
    result = {
      ...state,
      settings: {
        ...state.settings,
        windows: state.settings.windows.map((x) =>
          x.kind === 'class' && x.from === old.from && x.to === old.to
            ? { ...x, from: w.classFrom, to: w.classTo }
            : x,
        ),
      },
    };
    partial.classEditingPeriod = { from: w.classFrom, to: w.classTo };
  }
  if (w.step === 'class.grid')
    result = answerSchedule(
      result,
      'class',
      scheduleCount(result.settings, 'class') ? 'registered' : 'none',
    );
  if (w.step === 'material.completed' || w.step === 'material.roundMinutes')
    partial.roundIndex = next === w.step ? w.roundIndex + 1 : 0;
  else if (next === 'material.completed') partial.roundIndex = 0;
  return { ...result, draft: { ...result.draft, [draftKey]: moveTo(w, next, partial) } };
}

export function saveAnswer(
  state: AppState,
  w: Wizard,
  draftKey: string,
  kind: 'exam' | 'window' | 'material' | 'exception',
  next: Step,
  partial: Partial<Wizard> = {},
  addition = false,
): AppState {
  const settings = { ...state.settings };
  if (kind === 'exam')
    settings.exams = [...settings.exams.filter((x) => x.id !== w.exam.id), w.exam];
  if (kind === 'window')
    settings.windows = [...settings.windows.filter((x) => x.id !== w.window.id), w.window];
  if (kind === 'material')
    settings.materials = [...settings.materials.filter((x) => x.id !== w.material.id), w.material];
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
  if (errors.length) throw new Error(errors.join(' '));

  const draft = moveTo(w, next, partial);
  return {
    ...state,
    settings,
    proposal: null,
    draft: { ...state.draft, [draftKey]: { ...draft, trail: addition ? [] : draft.trail } },
  };
}
