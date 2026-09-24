import { addDays, initialState, type Progress } from '../../src/domain/model';
import { capacityForDate } from '../../src/domain/planner/capacity';
import { createProgressBaseline } from '../../src/domain/progressReflection';
import { PLAN_CALCULATION_VERSION } from '../../src/domain/sessionPolicy';

export const adjustmentDay = '2030-10-07';
export const adjustmentContext = {
  date: adjustmentDay,
  minute: 720,
  timestamp: '2030-10-07T03:00:00.000Z',
  idPrefix: 'adjust',
};
export function adjustmentFixture(baseDate = adjustmentDay) {
  const state = initialState();
  state.settings.exams = ['a', 'b'].map((id) => ({
    id,
    name: `試験${id}`,
    start: baseDate,
    target: addDays(baseDate, 10),
    priority: 2,
    color: '#287569',
    reviewDays: 0,
  }));
  state.settings.materials = [
    {
      id: 'book',
      examId: 'a',
      name: '対象問題集',
      total: 30,
      order: 1,
      rounds: [
        { completed: 0, minutes: 3 },
        { completed: 0, minutes: 3 },
      ],
    },
    {
      id: 'other',
      examId: 'b',
      name: '別問題集',
      total: 45,
      order: 1,
      rounds: [{ completed: 0, minutes: 3 }],
    },
  ];
  state.settings.windows = [
    {
      id: 'window',
      name: '学習枠',
      kind: 'study',
      from: baseDate,
      to: addDays(baseDate, 9),
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      start: 540,
      end: 660,
    },
  ];
  state.settings.block = 50;
  state.settings.rest = 10;
  state.settings.buffer = 0.2;
  state.settings.scheduleAnswers = { class: 'none', busy: 'none', exception: 'none' };
  state.plan = {
    id: 'original',
    createdAt: `${baseDate}T00:00:00.000Z`,
    approvedAt: `${baseDate}T00:00:00.000Z`,
    from: baseDate,
    calculationVersion: PLAN_CALCULATION_VERSION,
    settingsSnapshot: structuredClone(state.settings),
    sessions: Array.from({ length: 10 }, (_, index) => ({
      id: `book-${index}`,
      date: addDays(baseDate, index),
      start: 540,
      end: 558,
      materialId: 'book',
      examId: 'a',
      round: index < 5 ? 0 : 1,
      count: 6,
      fixed: false,
      kind: 'study' as const,
    })).concat(
      Array.from({ length: 5 }, (_, index) => ({
        id: `other-${index}`,
        date: addDays(baseDate, index),
        start: 600,
        end: 627,
        materialId: 'other',
        examId: 'b',
        round: 0,
        count: 9,
        fixed: false,
        kind: 'study' as const,
      })),
    ),
    capacities: Array.from({ length: 10 }, (_, index) =>
      capacityForDate(state.settings, addDays(baseDate, index)),
    ),
    shortfalls: [],
    conflicts: [],
  };
  state.plan.progressBaseline = createProgressBaseline(state.plan, state.records);
  return state;
}
export const adjustmentReport = (count: number, id = 'record'): Progress => ({
  id,
  materialId: 'book',
  round: 0,
  date: adjustmentDay,
  count,
  cancelled: false,
  createdAt: adjustmentContext.timestamp,
  updatedAt: adjustmentContext.timestamp,
});
