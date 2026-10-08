import { reflectProgressSafely } from '../src/domain/progressReflection';
import { calendarQuantity } from '../src/domain/calendarQuantity';
import { describe, expect, it } from 'vitest';
import {
  AppState,
  Progress,
  addDays,
  completed,
  initialState,
  remaining,
  reported,
} from '../src/domain/model';
import {
  approve,
  capacityForDate,
  capacityForWeek,
  generatePlan,
  mergeIntervals,
  propose,
  subtractIntervals,
  undoPlan,
} from '../src/domain/planning';
import { correctProgress, recordProgress } from '../src/domain/progress';
import { currentTerms, termItemLabel } from '../src/domain/terms';
const from = '2026-09-21';
function fixture(): AppState {
  const s = initialState();
  s.settings.exams = [
    {
      id: 'e',
      name: '試験',
      start: from,
      target: addDays(from, 7),
      priority: 2,
      color: '#287569',
      reviewDays: 0,
    },
  ];
  s.settings.materials = [
    {
      id: 'm',
      examId: 'e',
      name: '問題集',
      total: 37,
      order: 1,
      rounds: [{ completed: 0, minutes: 2 }],
    },
  ];
  s.settings.windows = [
    {
      id: 'w',
      name: '夕方',
      kind: 'study',
      from,
      to: addDays(from, 30),
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      start: 1080,
      end: 1260,
    },
  ];
  return s;
}
function entry(count: number, id = 'r', date = from): Progress {
  return {
    id,
    date,
    materialId: 'm',
    round: 0,
    count,
    cancelled: false,
    createdAt: 'now',
    updatedAt: 'now',
  };
}
function assertPlan(state: AppState) {
  const plan = generatePlan(state, from);
  for (const date of plan.capacities.map((c) => c.date)) {
    const w = capacityForWeek(state.settings, date, plan.sessions);
    expect(w.used).toBeLessThanOrEqual(w.limit + 1e-6);
  }
  for (const c of plan.capacities) {
    const sessions = plan.sessions.filter((s) => s.date === c.date);
    expect(sessions.reduce((n, s) => n + s.end - s.start, 0)).toBeLessThanOrEqual(
      c.allocatable + 1e-6,
    );
    for (const [a, b] of c.blocks ?? []) expect(b - a).toBeLessThanOrEqual(state.settings.block);
    expect(c.allocatable).toBe(c.focus);
    for (let i = 0; i < sessions.length; i++) {
      expect(c.slots.some(([a, b]) => sessions[i].start >= a && sessions[i].end <= b + 1e-6)).toBe(
        true,
      );
      for (let j = i + 1; j < sessions.length; j++)
        expect(sessions[i].end <= sessions[j].start || sessions[j].end <= sessions[i].start).toBe(
          true,
        );
    }
  }
  return plan;
}
describe('時間枠と集中量', () => {
  it('重複予定を二重に差し引かない', () =>
    expect(
      subtractIntervals(
        [[0, 180]],
        [
          [20, 70],
          [40, 100],
          [20, 70],
        ],
      ),
    ).toEqual([
      [0, 20],
      [100, 180],
    ]));
  it('重複する学習枠も一つとして数える', () =>
    expect(
      mergeIntervals([
        [10, 50],
        [30, 90],
        [90, 100],
      ]),
    ).toEqual([[10, 100]]));
  it('日ごとには休憩だけを除き、余裕率で時間枠を減らさない', () => {
    const s = fixture();
    const c = capacityForDate(s.settings, from);
    expect(c.free).toBe(180);
    expect(c.focus).toBe(150);
    expect(c.allocatable).toBe(150);
  });
  it('終日予定と時間帯予定を差し引く', () => {
    const s = fixture();
    s.settings.exceptions = [{ id: 'x', name: '外出', date: from, start: 0, end: 1440 }];
    expect(capacityForDate(s.settings, from).free).toBe(0);
    s.settings.exceptions[0] = { ...s.settings.exceptions[0], start: 1100, end: 1120 };
    expect(capacityForDate(s.settings, from).free).toBe(160);
  });
  it('授業の適用期間を守る', () => {
    const s = fixture();
    s.settings.windows.push({
      id: 'class',
      name: '授業',
      kind: 'class',
      from,
      to: from,
      weekdays: [1],
      start: 1080,
      end: 1180,
    });
    expect(capacityForDate(s.settings, from).free).toBe(80);
    expect(capacityForDate(s.settings, addDays(from, 7)).free).toBe(180);
  });
  it('短い空き枠の間にも必要な休憩を残す', () => {
    const s = fixture();
    s.settings.windows = [
      { ...s.settings.windows[0], start: 600, end: 620 },
      { ...s.settings.windows[0], id: 'w2', start: 625, end: 645 },
    ];
    s.settings.buffer = 0;
    expect(capacityForDate(s.settings, from).slots).toEqual([
      [600, 620],
      [630, 645],
    ]);
  });
  it('旧日次上限を使わず連続学習と休憩を繰り返す', () => {
    const s = fixture();
    s.settings.focus = 60;
    s.settings.buffer = 0.3;
    const c = capacityForDate(s.settings, from);
    expect(c.focus).toBe(150);
    expect(c.allocatable).toBe(150);
  });
});
describe('統合計画', () => {
  it('複数試験で枠を重複せず共有する', () => {
    const s = fixture();
    s.settings.exams.push({ ...s.settings.exams[0], id: 'e2', priority: 3 });
    s.settings.materials.push({ ...s.settings.materials[0], id: 'm2', examId: 'e2', total: 101 });
    const p = assertPlan(s);
    expect(p.sessions.some((x) => x.examId === 'e')).toBe(true);
    expect(p.sessions.some((x) => x.examId === 'e2')).toBe(true);
    expect(p.shortfalls).toHaveLength(0);
  });
  it('3問・7問など端数が消失しない', () => {
    for (const count of [1, 3, 7, 13, 37]) {
      const s = fixture();
      s.settings.materials[0].total = count;
      const p = assertPlan(s);
      expect(
        p.sessions.reduce((n, x) => n + x.count, 0) + p.shortfalls.reduce((n, x) => n + x.count, 0),
      ).toBe(count);
      expect(p.sessions.every((x) => Number.isInteger(x.count))).toBe(true);
    }
  });
  it('収まらない課題を問題数と分数で表示する', () => {
    const s = fixture();
    s.settings.materials[0].total = 5000;
    const p = assertPlan(s);
    expect(p.shortfalls[0].count).toBeGreaterThan(0);
    expect(p.shortfalls[0].minutes).toBe(p.shortfalls[0].count * 2);
    expect(p.sessions.reduce((n, x) => n + x.count, 0) + p.shortfalls[0].count).toBe(5000);
  });
  it('推定時間を周回別に用い速度向上を仮定しない', () => {
    const s = fixture();
    s.settings.materials[0] = {
      ...s.settings.materials[0],
      total: 7,
      rounds: [
        { completed: 4, minutes: 2 },
        { completed: 0, minutes: 4 },
      ],
    };
    const p = assertPlan(s);
    expect(p.shortfalls).toHaveLength(0);
    expect(p.sessions.reduce((n, x) => n + x.end - x.start, 0)).toBe(34);
    const lastFirst = p.sessions.filter((x) => x.round === 0).at(-1)!;
    const firstSecond = p.sessions.find((x) => x.round === 1)!;
    expect(lastFirst.date <= firstSecond.date).toBe(true);
  });
  it('教材順序を守りながら後続教材も配置する', () => {
    const s = fixture();
    s.settings.materials[0].total = 21;
    s.settings.materials.push({ ...s.settings.materials[0], id: 'm2', order: 2, total: 21 });
    const p = assertPlan(s);
    expect(p.shortfalls).toHaveLength(0);
    const one = p.sessions.filter((x) => x.materialId === 'm').at(-1)!;
    const two = p.sessions.find((x) => x.materialId === 'm2')!;
    expect(one.date < two.date || (one.date === two.date && one.end <= two.start)).toBe(true);
  });
  it('復習期間は通常教材から分離して共有枠に配置する', () => {
    const s = fixture();
    s.settings.exams[0].reviewDays = 2;
    const p = assertPlan(s);
    const cutoff = addDays(s.settings.exams[0].target, -2);
    expect(p.sessions.filter((x) => x.kind === 'study').every((x) => x.date < cutoff)).toBe(true);
    expect(p.sessions.some((x) => x.kind === 'review')).toBe(true);
  });
  it('1問が集中ブロックに収まらない場合は未配置にする', () => {
    const s = fixture();
    s.settings.materials[0].rounds[0].minutes = 51;
    const p = assertPlan(s);
    expect(p.shortfalls[0].count).toBe(37);
  });
  it('大量の課題を一日だけに押しつけず分散する', () => {
    const p = generatePlan(fixture(), from);
    expect(new Set(p.sessions.map((x) => x.date)).size).toBeGreaterThan(1);
  });
  it('日によって枠の長さが異なっても長い日を活用する', () => {
    const s = fixture();
    s.settings.exams[0].target = addDays(from, 2);
    s.settings.materials[0].total = 65;
    s.settings.focus = 180;
    s.settings.buffer = 0;
    s.settings.windows = [
      { ...s.settings.windows[0], to: from },
      { ...s.settings.windows[0], id: 'short', from: addDays(from, 1), start: 1080, end: 1100 },
    ];
    const p = assertPlan(s);
    expect(p.shortfalls).toHaveLength(0);
    expect(p.sessions.reduce((n, x) => n + x.count, 0)).toBe(65);
  });
  it('再計画で経過した当日の時間に新しい予定を入れない', () => {
    const s = fixture();
    const p = generatePlan(s, from, true, 1150);
    expect(p.sessions.filter((x) => x.date === from).every((x) => x.start >= 1150)).toBe(true);
  });
  it('期限と優先度を考慮する', () => {
    const s = fixture();
    s.settings.exams.push({
      ...s.settings.exams[0],
      id: 'urgent',
      priority: 3,
      target: addDays(from, 1),
    });
    s.settings.materials.push({
      ...s.settings.materials[0],
      id: 'urgent-m',
      examId: 'urgent',
      total: 30,
    });
    const p = assertPlan(s);
    expect(p.sessions[0].examId).toBe('urgent');
    expect(
      p.sessions
        .filter((x) => x.examId === 'urgent')
        .every((x) => x.date < s.settings.exams[1].target),
    ).toBe(true);
  });
});
describe('追加方式の記録', () => {
  it('教材・周回ごとに加算し二重送信しない', () => {
    let s = recordProgress(fixture(), entry(3));
    s = recordProgress(s, entry(3));
    s = recordProgress(s, entry(7, 'other'));
    expect(completed(s, 'm', 0)).toBe(10);
    expect(s.records).toHaveLength(2);
  });
  it('残数超過・負数・小数を拒否する', () => {
    for (const n of [38, -1, 2.5, NaN]) expect(() => recordProgress(fixture(), entry(n))).toThrow();
  });
  it('0問と未報告を区別し既存の完了数を消さない', () => {
    let s = recordProgress(fixture(), entry(7));
    expect(reported(s, addDays(from, 1), 'm', 0)).toBe(false);
    s = recordProgress(s, entry(0, 'zero', addDays(from, 1)));
    expect(reported(s, addDays(from, 1), 'm', 0)).toBe(true);
    expect(completed(s, 'm', 0)).toBe(7);
  });
  it('残りすべては端数も含めて追加する', () => {
    const s = recordProgress(fixture(), entry(3));
    const all = recordProgress(s, entry(remaining(s, 'm', 0), 'all'));
    expect(remaining(all, 'm', 0)).toBe(0);
  });
  it('訂正と取消で残数が戻り履歴が残る', () => {
    let s = recordProgress(fixture(), entry(7));
    s = correctProgress(s, 'r', 3);
    expect(remaining(s, 'm', 0)).toBe(34);
    s = correctProgress(s, 'r', 3, true);
    expect(remaining(s, 'm', 0)).toBe(37);
    expect(s.records[0].cancelled).toBe(true);
  });
  it('訂正時も残数超過を防ぐ', () => {
    let s = recordProgress(fixture(), entry(30));
    s = recordProgress(s, entry(7, 'second'));
    expect(() => correctProgress(s, 'r', 31)).toThrow();
  });
});
describe('承認・再計画・復元', () => {
  it('目標日を短縮しても固定予定を黙って期間外に残さない', () => {
    let s = approve(propose(fixture(), from, '初回'));
    s.plan!.sessions.at(-1)!.fixed = true;
    s.settings.exams[0].target = addDays(from, 1);
    s = propose(s, from, '変更');
    expect(s.proposal!.plan.conflicts.length).toBeGreaterThan(0);
    expect(() => approve(s)).toThrow();
  });
  it('再計画できない設定でも確定した記録は失わない', () => {
    let s = approve(propose(fixture(), from, '初回'));
    s.settings.block = 0;
    s = reflectProgressSafely(recordProgress(s, entry(3)));
    expect(completed(s, 'm', 0)).toBe(3);
    expect(s.proposal).toBeNull();
    expect(s.draft.progressResult).toBeTruthy();
  });
  it('複数試験の通常教材が多くても復習期間の枠を確保する', () => {
    const s = fixture();
    s.settings.exams[0].reviewDays = 2;
    s.settings.exams.push({
      ...s.settings.exams[0],
      id: 'e2',
      reviewDays: 0,
      target: addDays(from, 10),
    });
    s.settings.materials.push({ ...s.settings.materials[0], id: 'm2', examId: 'e2', total: 9000 });
    const p = assertPlan(s);
    expect(p.sessions.some((x) => x.examId === 'e' && x.kind === 'review')).toBe(true);
    expect(p.conflicts).toHaveLength(0);
  });
  it('承認前には計画を変更しない', () => {
    const s = propose(fixture(), from, '初回');
    expect(s.plan).toBeNull();
    expect(approve(s).plan).not.toBeNull();
  });
  it('実績と固定予定を保持し、固定枠を重複使用しない', () => {
    let s = approve(propose(fixture(), from, '初回'));
    const fixed = s.plan!.sessions[2];
    fixed.fixed = true;
    s = recordProgress(s, entry(3));
    const p = generatePlan(s, from);
    expect(p.sessions.find((x) => x.id === fixed.id)).toEqual(fixed);
    expect(s.records[0].count).toBe(3);
    for (const x of p.sessions.filter((x) => x.date === fixed.date && x.id !== fixed.id))
      expect(x.end <= fixed.start || x.start >= fixed.end).toBe(true);
  });
  it('固定予定が新しい枠に収まらない場合に承認を止める', () => {
    let s = approve(propose(fixture(), from, '初回'));
    s.plan!.sessions[0].fixed = true;
    s.settings.windows = [];
    s = propose(s, from, '変更');
    expect(s.proposal!.plan.conflicts.length).toBeGreaterThan(0);
    expect(() => approve(s)).toThrow();
  });
  it('未報告は確認対象になり0問として記録されない', () => {
    let s = approve(propose(fixture(), from, '初回'));
    s = propose(s, addDays(from, 1), '再計画');
    expect(s.proposal!.unreported.length).toBeGreaterThan(0);
    expect(() => approve(s)).toThrow();
    s = approve(s, true);
    expect(s.records).toHaveLength(0);
  });
  it('カレンダーで調整済みの未報告は再計画の確認対象にしない', () => {
    let s = approve(propose(fixture(), from, '初回'));
    s = approve(propose(s, addDays(from, 1), '再計画'), true);
    const day0 = calendarQuantity(s, from, addDays(from, 2)).rows.filter((row) => row.planned);
    expect(day0.length).toBeGreaterThan(0);
    expect(day0.every((row) => row.adjustment === 'applied')).toBe(true);
    s = propose(s, addDays(from, 2), '再計画');
    expect(s.proposal!.unreported.length).toBeGreaterThan(0);
    expect(s.proposal!.unreported.every((x) => x.startsWith(addDays(from, 1)))).toBe(true);
  });
  it('計画の復元は実績を巻き戻さない', () => {
    let s = approve(propose(fixture(), from, '初回'));
    const id = s.plan!.id;
    s = recordProgress(s, entry(7));
    s = approve(propose(s, from, '記録'));
    expect(s.plan!.id).not.toBe(id);
    s = undoPlan(s);
    expect(s.plan!.id).toBe(id);
    expect(completed(s, 'm', 0)).toBe(7);
  });
  it('固定した問題数が残数を超える場合に黙って消さない', () => {
    let s = approve(propose(fixture(), from, '初回'));
    s.plan!.sessions[0].fixed = true;
    s = recordProgress(s, entry(37));
    s = propose(s, from, '再計画');
    expect(s.proposal!.plan.conflicts.length).toBeGreaterThan(0);
    expect(() => approve(s)).toThrow();
  });
});
describe('同時に進める教材数（ターム）', () => {
  function terms(limit?: number): AppState {
    const s = fixture();
    s.settings.exams[0].target = addDays(from, 40);
    s.settings.exams.push({ ...s.settings.exams[0], id: 'e2', name: '試験2' });
    s.settings.materials = ['A', 'B', 'C', 'D'].map((name, i) => ({
      id: `m${name}`,
      examId: i % 2 ? 'e2' : 'e',
      name,
      total: 20,
      order: 1,
      rounds: [{ completed: 0, minutes: 2 }, { completed: 0, minutes: 2 }],
    }));
    if (limit) s.settings.parallelMaterials = limit;
    return s;
  }
  const span = (sessions: { date: string; start: number; end: number }[]) => ({
    first: sessions.map((x) => x.date + String(x.start).padStart(4, '0')).sort()[0],
    last: sessions.map((x) => x.date + String(x.end).padStart(4, '0')).sort().at(-1)!,
  });
  it('一覧順に2教材ずつ区切り、周回ごとにタームを順に配置する', () => {
    const plan = generatePlan(terms(2), from);
    expect(plan.shortfalls).toEqual([]);
    const study = plan.sessions.filter((x) => x.kind === 'study');
    const term = (ids: string[], round: number) =>
      span(study.filter((x) => ids.includes(x.materialId) && x.round === round));
    const order = [term(['mA', 'mB'], 0), term(['mC', 'mD'], 0), term(['mA', 'mB'], 1), term(['mC', 'mD'], 1)];
    for (let i = 1; i < order.length; i++) expect(order[i - 1].last <= order[i].first).toBe(true);
    // Both materials of the first term are studied in parallel from the first study day.
    const first = study[0].date;
    expect(new Set(study.filter((x) => x.date === first).map((x) => x.materialId))).toEqual(new Set(['mA', 'mB']));
  });
  it('未設定なら従来どおり試験ごとの順序だけを守る', () => {
    // A and C share an exam: without terms every round of A precedes C.
    const study = generatePlan(terms(), from).sessions.filter((x) => x.kind === 'study');
    const at = (materialId: string, round: number) =>
      span(study.filter((x) => x.materialId === materialId && x.round === round));
    expect(at('mA', 1).last <= at('mC', 0).first).toBe(true);
  });
  it('前のタームが終わる前の固定予定を順序違反として止める', () => {
    const s = terms(2);
    const plan = generatePlan(s, from);
    s.plan = plan;
    const c = plan.sessions.find((x) => x.materialId === 'mC' && x.round === 0)!;
    s.plan.sessions = plan.sessions.map((x) =>
      x.id === c.id ? { ...x, date: plan.sessions[0].date, start: 1080, end: 1080 + x.count * 2, fixed: true } : x,
    );
    const next = generatePlan(s, from);
    expect(next.conflicts.join('')).toContain('取り組む順序を守れません');
  });
  it('現在と次のタームを実績から判定する', () => {
    let s = terms(2);
    let t = currentTerms(s);
    expect(t.current!.items.map(termItemLabel)).toEqual(['A（1周目）', 'B（1周目）']);
    expect(t.next!.items.map(termItemLabel)).toEqual(['C（1周目）', 'D（1周目）']);
    for (const materialId of ['mA', 'mB'])
      s = recordProgress(s, { ...entry(20), id: `done-${materialId}`, materialId });
    t = currentTerms(s);
    expect(t.current!.items.map((x) => x.material.id)).toEqual(['mC', 'mD']);
    expect(t.next!.items.map(termItemLabel)).toEqual(['A（2周目）', 'B（2周目）']);
    expect(currentTerms(terms())).toEqual({ current: undefined, next: undefined, parallel: [] });
  });
  it('タームに含めない教材は毎日並行し、自分の周回順だけを守る', () => {
    const s = terms(1);
    s.settings.materials[0].outsideTerms = true;
    const plan = generatePlan(s, from);
    expect(plan.shortfalls).toEqual([]);
    const study = plan.sessions.filter((x) => x.kind === 'study');
    const at = (materialId: string, round: number) =>
      span(study.filter((x) => x.materialId === materialId && x.round === round));
    // B → C → D → B2 → C2 → D2 one at a time; A is outside the terms.
    const order = ['mB', 'mC', 'mD'].flatMap((id) => [0, 1].map((round) => ({ id, round })))
      .sort((a, b) => a.round - b.round).map(({ id, round }) => at(id, round));
    for (let i = 1; i < order.length; i++) expect(order[i - 1].last <= order[i].first).toBe(true);
    expect(at('mA', 0).last <= at('mA', 1).first).toBe(true);
    const first = study[0].date;
    expect(new Set(study.filter((x) => x.date === first).map((x) => x.materialId))).toEqual(new Set(['mA', 'mB']));
    expect(at('mA', 0).first < at('mC', 0).first).toBe(true);
  });
  it('タームに含めない教材を現在の並行教材として周回付きで示す', () => {
    let s = terms(1);
    s.settings.materials[0].outsideTerms = true;
    let t = currentTerms(s);
    expect(t.current!.items.map(termItemLabel)).toEqual(['B（1周目）']);
    expect(t.next!.items.map(termItemLabel)).toEqual(['C（1周目）']);
    expect(t.parallel.map(termItemLabel)).toEqual(['A（1周目）']);
    s = recordProgress(s, { ...entry(20), id: 'done-a', materialId: 'mA' });
    t = currentTerms(s);
    expect(t.current!.items.map(termItemLabel)).toEqual(['B（1周目）']);
    expect(t.parallel.map(termItemLabel)).toEqual(['A（2周目）']);
    s = recordProgress(s, { ...entry(20), id: 'done-a2', materialId: 'mA', round: 1 });
    expect(currentTerms(s).parallel).toEqual([]);
  });
});
