import { addDays, initialState } from '../../src/domain/model';
import { PLAN_CALCULATION_VERSION } from '../../src/domain/sessionPolicy';

// Shared by semantic unit tests and real-browser tests; never reads a user's database.
export const contractDay = '2026-09-24';
export const contractPast = addDays(contractDay, -1);
export const contractFuture = addDays(contractDay, 1);
export const contractCases = [
  { id: 'missing', name: '未報告の教材', actual: null, deficit: null },
  { id: 'zero', name: 'ゼロの教材', actual: 0, deficit: 10 },
  { id: 'partial', name: '一部の教材', actual: 6, deficit: 4 },
  { id: 'complete', name: '完了の教材', actual: 10, deficit: 0 },
  { id: 'over', name: '超過の教材', actual: 12, deficit: 0 },
  { id: 'cancelled', name: '取消の教材', actual: null, deficit: null },
] as const;

export function progressContractFixture() {
  const state = initialState();
  state.settings.exams = [
    {
      id: 'exam',
      name: '検証用試験',
      start: contractPast,
      target: '2026-09-30',
      priority: 2,
      color: '#287569',
      reviewDays: 0,
    },
  ];
  state.settings.materials = contractCases.map((c, order) => ({
    id: c.id,
    name: c.name,
    examId: 'exam',
    total: 100,
    order: order + 1,
    rounds: [{ completed: 0, minutes: 2 }],
  }));
  state.settings.windows = [
    {
      id: 'study',
      name: '学習枠',
      kind: 'study',
      from: contractPast,
      to: '2026-09-30',
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      start: 540,
      end: 1200,
    },
  ];
  state.settings.scheduleAnswers = { class: 'none', busy: 'none', exception: 'none' };
  state.plan = {
    id: 'contract-plan',
    from: contractPast,
    createdAt: `${contractPast}T00:00:00+09:00`,
    calculationVersion: PLAN_CALCULATION_VERSION,
    settingsSnapshot: structuredClone(state.settings),
    capacities: [],
    conflicts: [],
    shortfalls: [],
    sessions: [contractPast, contractDay, contractFuture].flatMap((date) =>
      contractCases.map((c, i) => ({
        id: `${date}-${c.id}`,
        date,
        materialId: c.id,
        examId: 'exam',
        round: 0,
        count: 10,
        kind: 'study' as const,
        fixed: false,
        start: 540 + i * 30,
        end: 560 + i * 30,
      })),
    ),
  };
  state.records = [contractPast, contractDay].flatMap((date) =>
    contractCases.flatMap((c) =>
      c.actual === null && c.id !== 'cancelled'
        ? []
        : [
            {
              id: `${date}-${c.id}`,
              date,
              materialId: c.id,
              round: 0,
              count: c.actual ?? 9,
              cancelled: c.id === 'cancelled',
              createdAt: `${date}T09:00:00+09:00`,
              updatedAt: `${date}T09:00:00+09:00`,
            },
          ],
    ),
  );
  return state;
}
