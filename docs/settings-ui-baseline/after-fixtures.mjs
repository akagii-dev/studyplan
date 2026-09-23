import { readFileSync } from 'node:fs';

export const DEMO_KEY = 'studyplan-demo-state-v1';

function day(offset) {
  const value = new Date();
  value.setHours(12, 0, 0, 0);
  value.setDate(value.getDate() + offset);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

/** Isolated demo data for UI evaluation; never seed an existing browser profile. */
export function settingsFixture(kind = 'empty') {
  const state = JSON.parse(
    readFileSync(new URL('../../src/domain/initialState.json', import.meta.url), 'utf8'),
  );
  if (kind === 'empty') return state;

  state.settings.exams = [{
    id: 'ux-exam', name: '検証用試験', start: day(0), target: day(14),
    priority: 2, color: '#287569', reviewDays: 0,
  }];
  if (kind === 'partial') return state;

  state.settings.materials = [{
    id: 'ux-book', examId: 'ux-exam', name: '検証用問題集',
    total: 20, order: 1, rounds: [{ completed: 0, minutes: 2 }],
  }];
  state.settings.windows = [{
    id: 'ux-study', name: '夕方', kind: 'study', from: day(0), to: day(14),
    weekdays: [0, 1, 2, 3, 4, 5, 6], start: 1080, end: 1140,
  }];
  if (kind === 'ready-unconfirmed') return state;
  if (kind === 'schedule-none') {
    state.settings.scheduleAnswers = { class: 'none', busy: 'none', exception: 'none' };
    return state;
  }
  if (kind === 'invalid-block') {
    state.settings.block = 0;
    return state;
  }
  throw new Error(`unknown fixture: ${kind}`);
}

export function settingsEnvelope(kind) {
  return { revision: 1, data: settingsFixture(kind) };
}
