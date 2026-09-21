import { examColors } from '../../domain/appearance';
import {
  AppState,
  Exam,
  Exception,
  Material,
  WindowRule,
  addDays,
  today,
  uid,
} from '../../domain/model';
export type Step =
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
  | 'outside.sleep'
  | 'outside.bath'
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
export interface Wizard {
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
export const newExam = (): Exam => ({
  id: uid(),
  name: '',
  start: today(),
  target: addDays(today(), 90),
  priority: 2,
  color: examColors[0].value,
  reviewDays: 0,
});
export const newWindow = (kind: WindowRule['kind'] = 'study'): WindowRule => ({
  id: uid(),
  kind,
  name: kind === 'study' ? '学習可能枠' : '定期予定',
  from: today(),
  to: addDays(today(), 180),
  weekdays: [1, 2, 3, 4, 5],
  start: 1080,
  end: 1260,
});
export const newMaterial = (examId: string): Material => ({
  id: uid(),
  examId,
  name: '',
  total: 100,
  order: 1,
  rounds: [{ completed: 0, minutes: 2 }],
});
export type Addition = 'addExam' | 'addMaterial';
export function initialWizard(state: AppState, mode?: Addition, examId?: string): Wizard {
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
