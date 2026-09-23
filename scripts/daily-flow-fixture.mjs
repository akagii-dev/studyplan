import { readFileSync } from 'node:fs';

export function dailyFlowFixture({ capacity = 60, secondBook = false, fixed = false } = {}) {
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const after = (days) => {
    const value = new Date(`${date}T12:00:00Z`);
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
  };
  const state = JSON.parse(readFileSync(new URL('../src/domain/initialState.json', import.meta.url), 'utf8'));
  const exam = { id: 'exam', name: '検証用試験', start: date, target: after(2), priority: 2, color: '#287569', reviewDays: 0 };
  state.settings.exams = [exam];
  state.settings.materials = [{ id: 'book', examId: 'exam', name: '民法過去問', total: 20, order: 1, rounds: [{ completed: 0, minutes: 2 }] }];
  if (secondBook) {
    state.settings.exams.push({ ...exam, id: 'english', name: '英語試験' });
    state.settings.materials.push({ id: 'reading', examId: 'english', name: '英語読解', total: 4, order: 1, rounds: [{ completed: 0, minutes: 5 }] });
  }
  state.settings.windows = [
    { id: 'today', name: '今日の枠', kind: 'study', from: date, to: date, weekdays: [0, 1, 2, 3, 4, 5, 6], start: 1080, end: 1140 },
    { id: 'tomorrow', name: '明日の枠', kind: 'study', from: after(1), to: after(1), weekdays: [0, 1, 2, 3, 4, 5, 6], start: 1080, end: 1080 + capacity },
  ];
  state.settings.scheduleAnswers = { class: 'none', busy: 'none', exception: 'none' };
  Object.assign(state.settings, { buffer: 0, block: 60, rest: 10, minimumSessionMinutes: 10, preferredSessionMinutes: 30 });
  const session = { id: 'today-book', date, start: 1080, end: 1100, examId: 'exam', materialId: 'book', round: 0, count: 10, fixed: false, kind: 'study' };
  const version = Number(readFileSync(new URL('../src/domain/sessionPolicy.ts', import.meta.url), 'utf8').match(/PLAN_CALCULATION_VERSION\s*=\s*(\d+)/)[1]);
  state.plan = {
    id: 'baseline', createdAt: now.toISOString(), from: date, notBefore: 0,
    calculationVersion: version, settingsSnapshot: structuredClone(state.settings),
    sessions: [session, { ...session, id: 'tomorrow-book', date: after(1), fixed }],
    capacities: [], conflicts: [], shortfalls: [],
  };
  state.records = [];
  state.history = [];
  state.proposal = null;
  state.draft = {};
  return { state, date, tomorrow: after(1) };
}
