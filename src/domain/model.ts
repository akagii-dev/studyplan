import initialData from './initialState.json' with { type: 'json' };
export type DateKey = string;
export interface Exam {
  id: string;
  name: string;
  start: DateKey;
  target: DateKey;
  priority: number;
  color: string;
  reviewDays: number;
}
export interface Round {
  completed: number;
  /** Estimated minutes per question, independently configured for each round. */
  minutes: number;
}
export interface Material {
  id: string;
  examId: string;
  name: string;
  total: number;
  order: number;
  rounds: Round[];
}
export interface WindowRule {
  id: string;
  name: string;
  from: DateKey;
  to: DateKey;
  weekdays: number[];
  start: number;
  end: number;
  kind: 'study' | 'class' | 'busy';
}
export interface Exception {
  id: string;
  name: string;
  date: DateKey;
  start: number;
  end: number;
}
export type ScheduleKind = 'class' | 'busy' | 'exception';
export type ScheduleAnswer = 'none' | 'deferred' | 'registered';
export type MealKey = 'breakfast' | 'lunch' | 'dinner';
export interface Meal {
  start: number;
  duration: number;
}
export const mealKeys: MealKey[] = ['breakfast', 'lunch', 'dinner'];
export const mealNames: Record<MealKey, string> = {
  breakfast: '朝食',
  lunch: '昼食',
  dinner: '夕食',
};
export const defaultMeals: Record<MealKey, Meal> = {
  breakfast: { start: 480, duration: 45 },
  lunch: { start: 720, duration: 45 },
  dinner: { start: 1140, duration: 45 },
};
export interface Settings {
  commute?: Commute;
  meals?: Partial<Record<MealKey, Meal>>;
  classTransition?: number;
  scheduleAnswers?: Partial<Record<ScheduleKind, ScheduleAnswer>>;
  exams: Exam[];
  materials: Material[];
  windows: WindowRule[];
  exceptions: Exception[];
  /** Legacy daily limit, retained only for reading older saved data. Not used in new plans. */
  focus?: number;
  block: number;
  minimumSessionMinutes?: number;
  preferredSessionMinutes?: number;
  rest: number;
  buffer: number;
  periods: number[];
}
export interface Commute {
  enabled: boolean;
  from: DateKey;
  to: DateKey;
  mode: 'classDays' | 'weekdays';
  weekdays: number[];
  outboundMinutes: number;
  returnMinutes: number;
  outboundStart: number;
  returnStart: number;
}
export interface Progress {
  id: string;
  date: DateKey;
  materialId: string;
  round: number;
  count: number;
  cancelled: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface Session {
  allocationReason?: 'final-remainder' | 'deadline';
  id: string;
  date: DateKey;
  start: number;
  end: number;
  examId: string;
  materialId: string;
  round: number;
  count: number;
  fixed: boolean;
  kind: 'study' | 'review';
}
export interface Capacity {
  blocks?: Interval[];
  date: DateKey;
  free: number;
  focus: number;
  /** Daily physical capacity after breaks. Weekly buffer ceilings are calculated separately. */
  allocatable: number;
  slots: Interval[];
}
export interface Shortfall {
  materialId: string;
  round: number;
  count: number;
  minutes: number;
  reason: string;
}
export interface Plan {
  calculationVersion?: number;
  notBefore?: number;
  settingsSnapshot?: Settings;
  settingsUpdatedAt?: string;
  id: string;
  createdAt: string;
  sessions: Session[];
  capacities: Capacity[];
  shortfalls: Shortfall[];
  conflicts: string[];
  from: DateKey;
}
export interface Proposal {
  settingsBase?: Settings;
  plan: Plan;
  basedOn: string | null;
  reason: string;
  unreported: string[];
}
export interface AppState {
  resetBackup?: AppState;
  settingsUpdatedAt?: string;
  theme?: 'mint' | 'sky' | 'lime';
  appearance?: 'light' | 'dark' | 'system';
  sidebarCollapsed?: boolean;
  ignoredWarnings?: Record<string, { title: string; version: string; ignoredAt: string }>;
  warningExpanded?: Record<string, boolean>;
  settings: Settings;
  draft: Record<string, unknown>;
  step: number;
  records: Progress[];
  plan: Plan | null;
  history: Plan[];
  proposal: Proposal | null;
}
export interface Envelope {
  revision: number;
  data: AppState;
}
export type Interval = [number, number];
export const uid = () => crypto.randomUUID();
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
export const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
export const clock = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(Math.floor(minutes % 60)).padStart(2, '0')}`;
export const minutes = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};
export const initialState = (): AppState => structuredClone(initialData);
export function completed(state: AppState, materialId: string, round: number) {
  const m = state.settings.materials.find((m) => m.id === materialId);
  return (
    (m?.rounds[round]?.completed ?? 0) +
    state.records
      .filter((r) => !r.cancelled && r.materialId === materialId && r.round === round)
      .reduce((n, r) => n + r.count, 0)
  );
}
export function remaining(state: AppState, materialId: string, round: number) {
  return (
    (state.settings.materials.find((m) => m.id === materialId)?.total ?? 0) -
    completed(state, materialId, round)
  );
}
export function reported(state: AppState, date: string, materialId: string, round: number) {
  return state.records.some(
    (r) => !r.cancelled && r.date === date && r.materialId === materialId && r.round === round,
  );
}
export function actual(state: AppState, date: string, materialId: string, round: number) {
  return state.records
    .filter(
      (r) => !r.cancelled && r.date === date && r.materialId === materialId && r.round === round,
    )
    .reduce((n, r) => n + r.count, 0);
}
