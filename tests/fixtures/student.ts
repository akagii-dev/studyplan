import { addDays, initialState } from '../../src/domain/model';

/** Fictional student: two exams, short answers and essays, semester then holiday. */
export function studentFixture(from = '2030-10-07') {
  const state = initialState();
  const end = addDays(from, 55);
  state.settings.exams = [
    {
      id: 'law',
      name: '行政書士',
      start: from,
      target: addDays(from, 28),
      priority: 3,
      color: '#287569',
      reviewDays: 2,
    },
    {
      id: 'essay',
      name: '予備試験',
      start: from,
      target: end,
      priority: 2,
      color: '#456da9',
      reviewDays: 3,
    },
  ];
  state.settings.materials = [
    {
      id: 'short',
      examId: 'law',
      name: '短答・過去問',
      total: 137,
      order: 1,
      rounds: [
        { completed: 23, minutes: 3 },
        { completed: 0, minutes: 3 },
      ],
    },
    {
      id: 'long',
      examId: 'essay',
      name: '論文演習',
      total: 37,
      order: 1,
      rounds: [
        { completed: 7, minutes: 30 },
        { completed: 0, minutes: 40 },
      ],
    },
  ];
  const period = { from, to: addDays(from, 20) };
  state.settings.windows = [
    {
      ...period,
      id: 'semester',
      kind: 'study',
      name: '授業期間',
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      start: 420,
      end: 1320,
    },
    {
      id: 'holiday',
      kind: 'study',
      name: '休暇',
      from: addDays(from, 21),
      to: end,
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      start: 540,
      end: 1200,
    },
    {
      ...period,
      id: 'class1',
      kind: 'class',
      name: '民法',
      weekdays: [1, 3, 5],
      start: 540,
      end: 640,
    },
    {
      ...period,
      id: 'class2',
      kind: 'class',
      name: '行政法',
      weekdays: [1, 3, 5],
      start: 650,
      end: 750,
    },
    {
      ...period,
      id: 'class3',
      kind: 'class',
      name: '演習',
      weekdays: [2, 4],
      start: 790,
      end: 890,
    },
    {
      from,
      to: end,
      id: 'job',
      kind: 'busy',
      name: 'アルバイト',
      weekdays: [6],
      start: 780,
      end: 1080,
    },
    {
      from,
      to: end,
      id: 'job-overlap',
      kind: 'busy',
      name: '重複する用事',
      weekdays: [6],
      start: 840,
      end: 1020,
    },
  ];
  state.settings.exceptions = [
    { id: 'off', name: '終日予定', date: addDays(from, 9), start: 0, end: 1440 },
  ];
  state.settings.meals = {
    breakfast: { start: 420, duration: 30 },
    lunch: { start: 750, duration: 60 },
    dinner: { start: 1140, duration: 45 },
  };
  state.settings.commute = {
    enabled: true,
    ...period,
    mode: 'classDays',
    weekdays: [],
    outboundMinutes: 50,
    returnMinutes: 50,
    departureTimesConfirmed: true,
    outboundStart: 490,
    returnStart: 960,
  };
  state.settings.block = 90;
  state.settings.rest = 15;
  state.settings.buffer = 0.2;
  state.settings.scheduleAnswers = {
    class: 'registered',
    busy: 'registered',
    exception: 'registered',
  };
  return state;
}
