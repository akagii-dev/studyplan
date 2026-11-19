import { expect, it } from 'vitest';
import { setRoundCounts } from '../src/domain/roundCounts';
import { studentFixture } from './fixtures/student';

const from = '2030-10-07';

it('選んだ教材だけ周回数をそろえ、増えた周回は未完了・1周目と同じ分数で足す', () => {
  const state = studentFixture(from);
  state.settings.materials[0].rounds.push({ completed: 0, minutes: 5 }); // short: 3周
  const settings = setRoundCounts(state, ['short', 'long'], 4, from, 0);
  expect(settings.materials.find((m) => m.id === 'short')!.rounds).toEqual([
    { completed: 23, minutes: 3 }, { completed: 0, minutes: 3 }, { completed: 0, minutes: 5 },
    { completed: 0, minutes: 3 },
  ]);
  expect(settings.materials.find((m) => m.id === 'long')!.rounds.map((r) => r.minutes)).toEqual([30, 40, 30, 30]);
  const reduced = setRoundCounts(state, ['short'], 2, from, 0);
  expect(reduced.materials.map((m) => m.rounds.length)).toEqual([2, 2]);
});

it('減らせない教材が1つでもあれば、どの教材も変えずに理由と教材名を示す', () => {
  const state = studentFixture(from);
  state.records = [{ id: 'r', date: from, materialId: 'long', round: 1, count: 1, cancelled: false,
    createdAt: `${from}T09:00:00.000Z`, updatedAt: `${from}T09:00:00.000Z` }];
  expect(() => setRoundCounts(state, ['short', 'long'], 1, from, 0)).toThrow(/^論文演習：.*減らせません/);
});
