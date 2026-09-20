import {
  AppState,
  Capacity,
  Interval,
  Plan,
  Session,
  Settings,
  addDays,
  remaining,
  reported,
  today,
  uid,
  weekday,
} from './model';
const EPS = 1e-7;
import { sessionPolicy, sessionUnitCount, PLAN_CALCULATION_VERSION } from './sessionPolicy';
import { requirePlanningInputs } from './setupIssues';
import { overlapsBusy, sameSettings, unavailableEvents } from './planAudit';
import { validateRevisedSettings, sameRevisionBase } from './revision';
import { fixedTimeIssue, fixedIssueMessage } from './planConstraints';
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const [start, end] of [...intervals].sort((a, b) => a[0] - b[0])) {
    if (end <= start) continue;
    const last = out.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else out.push([start, end]);
  }
  return out;
}
export function subtractIntervals(available: Interval[], busy: Interval[]): Interval[] {
  let out = mergeIntervals(available);
  for (const [bs, be] of mergeIntervals(busy))
    out = out.flatMap(([s, e]): Interval[] =>
      be <= s || bs >= e
        ? [[s, e]]
        : ([...(s < bs ? [[s, bs]] : []), ...(be < e ? [[be, e]] : [])] as Interval[]),
    );
  return out;
}
export function freeIntervalsForDate(settings: Settings, date: string): Interval[] {
  const rules = settings.windows.filter(
    (w) => w.from <= date && date <= w.to && w.weekdays.includes(weekday(date)),
  );
  return subtractIntervals(
    rules.filter((w) => w.kind === 'study').map((w) => [w.start, w.end]),
    unavailableEvents(settings, date).map((e) => [e.start, e.end]),
  );
}
export function capacityForDate(settings: Settings, date: string): Capacity {
  if (
    !Number.isInteger(settings.block) ||
    settings.block < 1 ||
    settings.block > 1440 ||
    !Number.isInteger(settings.rest) ||
    settings.rest < 1 ||
    settings.rest > 1440 ||
    !Number.isFinite(settings.buffer) ||
    settings.buffer < 0 ||
    settings.buffer >= 1
  )
    throw new Error('連続学習は1〜1440分、休憩は1〜1440分、余裕率は0〜99%で設定してください。');
  const free = freeIntervalsForDate(settings, date);
  const blocks: Interval[] = [];
  // Carry a conservative break across midnight; a date boundary does not reset continuous study.
  const previousEnd = freeIntervalsForDate(settings, addDays(date, -1)).at(-1)?.[1] ?? 0;
  let nextStart = Math.max(0, previousEnd + settings.rest - 1440);
  for (const [s, e] of free) {
    let cursor = Math.max(s, nextStart);
    while (cursor < e) {
      const end = Math.min(e, cursor + settings.block);
      blocks.push([cursor, end]);
      nextStart = end + settings.rest;
      cursor = nextStart;
    }
  }
  const focus = blocks.reduce((n, [s, e]) => n + e - s, 0);
  let budget = Math.floor(focus * (1 - settings.buffer) + EPS);
  const slots: Interval[] = [];
  for (const [s, e] of blocks) {
    const length = Math.min(budget, e - s);
    if (length > 0) slots.push([s, s + length]);
    budget -= length;
  }
  return {
    date,
    blocks,
    free: free.reduce((n, [s, e]) => n + e - s, 0),
    focus,
    allocatable: slots.reduce((n, [s, e]) => n + e - s, 0),
    slots,
  };
}
export function datesBetween(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    dates.push(d);
    if (dates.length > 3660) throw new Error('計画期間は10年以内にしてください。');
  }
  return dates;
}
export function validateSettings(s: Settings): string[] {
  const errors: string[] = [];
  const policy = sessionPolicy(s);
  if (
    !Number.isInteger(policy.minimum) ||
    !Number.isInteger(policy.preferred) ||
    policy.minimum < 1 ||
    policy.preferred < policy.minimum ||
    policy.preferred > 1440
  )
    errors.push('予定の下限は1分以上、まとまりの目安は下限以上・1440分以下にしてください。');
  if (
    !Number.isInteger(s.classTransition ?? 0) ||
    (s.classTransition ?? 0) < 0 ||
    (s.classTransition ?? 0) > 180
  )
    errors.push('授業前後の移動・準備は0〜180分の整数で指定してください。');
  if (!(
    Number.isInteger(s.block) &&
    Number.isInteger(s.rest) &&
    s.block > 0 &&
    s.block <= 1440 &&
    s.rest >= 1 &&
    s.rest <= 1440 &&
    s.buffer >= 0 &&
    s.buffer < 1
  ))
    errors.push('連続学習は1〜1440分、休憩は1〜1440分、余裕率は0〜99%で設定してください。');
  for (const meal of Object.values(s.meals ?? {}))
    if (
      !meal ||
      !Number.isInteger(meal.start) ||
      meal.start < 0 ||
      meal.start >= 1440 ||
      !Number.isInteger(meal.duration) ||
      meal.duration < 30 ||
      meal.duration > 60
    )
      errors.push('食事は開始時刻と30〜60分の長さを指定してください。');
  for (const e of s.exams)
    if (
      !e.name.trim() ||
      !e.start ||
      !e.target ||
      e.target < e.start ||
      !Number.isInteger(e.reviewDays) ||
      e.reviewDays < 0 ||
      addDays(e.start, e.reviewDays) > e.target
    )
      errors.push(`${e.name || '試験'}：日付と復習期間を確認してください。`);
  for (const m of s.materials)
    if (
      !s.exams.some((e) => e.id === m.examId) ||
      !m.name.trim() ||
      !Number.isInteger(m.order) ||
      m.order < 1 ||
      !Number.isInteger(m.total) ||
      m.total < 1 ||
      !m.rounds.length ||
      m.rounds.some(
        (r) =>
          !Number.isInteger(r.completed) ||
          r.completed < 0 ||
          r.completed > m.total ||
          !Number.isFinite(r.minutes) ||
          r.minutes <= 0,
      )
    )
      errors.push(`${m.name || '教材'}：問題数と所要時間を確認してください。`);
  for (const w of s.windows)
    if (
      !w.from ||
      w.to < w.from ||
      !w.weekdays.length ||
      !Number.isFinite(w.start) ||
      !Number.isFinite(w.end) ||
      w.start < 0 ||
      w.end > 1440 ||
      w.start >= w.end
    )
      errors.push(`${w.name}：期間・曜日・時間帯を確認してください。`);
  for (const e of s.exceptions)
    if (
      !e.date ||
      !Number.isFinite(e.start) ||
      !Number.isFinite(e.end) ||
      e.start < 0 ||
      e.end > 1440 ||
      e.start >= e.end
    )
      errors.push(`${e.name}：予定の時間を確認してください。`);
  return errors;
}
export function generatePlan(
  state: AppState,
  from: string,
  preserve = true,
  notBefore = 0,
  allocation: 'balanced' | 'earliest' = 'balanced',
): Plan {
  const { settings: s } = state;
  const policy = sessionPolicy(s);
  const errors = validateSettings(s);
  if (errors.length) throw new Error(errors.join('\n'));
  if (!s.exams.length || !s.materials.length) throw new Error('試験と教材を登録してください。');
  const to = s.exams.reduce((d, e) => (e.target > d ? e.target : d), from);
  const capacities = datesBetween(from, to).map((d) => capacityForDate(s, d));
  const kept = preserve
    ? (state.plan?.sessions.filter(
        (x) => x.date < from || (x.date === from && x.start < notBefore) || x.fixed,
      ) ?? [])
    : [];
  const sessions: Session[] = kept.map((x) => ({ ...x }));
  const conflicts: string[] = [];
  const tasks = s.materials.flatMap((m) =>
    m.rounds.map((r, round) => ({
      m,
      round,
      minutes: r.minutes,
      left: remaining(state, m.id, round),
      exam: s.exams.find((e) => e.id === m.examId)!,
    })),
  );
  for (const x of kept.filter(
    (x) => x.date >= from && !(x.date === from && x.start < notBefore) && x.kind === 'study',
  )) {
    const t = tasks.find((t) => t.m.id === x.materialId && t.round === x.round);
    if (t) {
      t.left -= x.count;
      if (t.left < 0)
        conflicts.push(
          `${x.date} の固定予定が「${t.m.name}」の残数を超えています。固定を解除して再作成してください。`,
        );
    } else
      conflicts.push(
        `${x.date} の固定予定の教材・周回が変更されています。固定を解除して再作成してください。`,
      );
  }
  const deadline = (t: (typeof tasks)[number]) => addDays(t.exam.target, -t.exam.reviewDays - 1);
  const eligible = (t: (typeof tasks)[number], d: string) => d >= t.exam.start && d <= deadline(t);
  for (const x of kept.filter(
    (x) => x.fixed && x.date >= from && !(x.date === from && x.start < notBefore),
  )) {
    const e = s.exams.find((e) => e.id === x.examId);
    const inPeriod =
      e &&
      (x.kind === 'study'
        ? x.date >= e.start && x.date < addDays(e.target, -e.reviewDays)
        : e.reviewDays > 0 && x.date >= addDays(e.target, -e.reviewDays) && x.date < e.target);
    if (!inPeriod) conflicts.push(`${x.date} の固定予定が変更後の試験・復習期間から外れています。`);
  }
  // Reserve a share for each exam in its review period before assigning normal work.
  for (const cap of capacities) {
    const exams = s.exams
      .filter(
        (e) =>
          e.reviewDays > 0 && cap.date >= addDays(e.target, -e.reviewDays) && cap.date < e.target,
      )
      .sort((a, b) => b.priority - a.priority);
    if (!exams.length) continue;
    const busy: Interval[] = kept.filter((x) => x.date === cap.date).map((x) => [x.start, x.end]);
    if (cap.date === from && notBefore > 0) busy.push([0, notBefore]);
    let available = subtractIntervals(cap.slots, busy);
    const activeNormal = new Set(
      tasks.filter((t) => t.left > 0 && eligible(t, cap.date)).map((t) => t.exam.id),
    ).size;
    const share = available.reduce((n, [a, b]) => n + b - a, 0) / (exams.length + activeNormal);
    for (const exam of exams) {
      let left = share;
      for (const [start, end] of available) {
        if (left <= EPS) break;
        const length = Math.min(Math.max(policy.minimum, left), end - start);
        if (length < policy.minimum) continue;
        sessions.push({
          id: uid(),
          date: cap.date,
          start,
          end: start + length,
          examId: exam.id,
          materialId: '',
          round: 0,
          count: 0,
          fixed: false,
          kind: 'review',
        });
        left -= length;
      }
      available = subtractIntervals(
        available,
        sessions
          .filter((x) => x.date === cap.date && x.examId === exam.id && x.kind === 'review')
          .map((x) => [x.start, x.end]),
      );
    }
  }
  const precedes = (a: (typeof tasks)[number], b: (typeof tasks)[number]) =>
    a.exam.id === b.exam.id &&
    (a.m.order < b.m.order ||
      (a.m.order === b.m.order && (a.m.id < b.m.id || (a.m.id === b.m.id && a.round < b.round))));
  const canStart = (t: (typeof tasks)[number], date: string, time: number) =>
    !tasks.some(
      (p) =>
        precedes(p, t) &&
        (p.left > 0 ||
          sessions.some(
            (x) =>
              x.kind === 'study' &&
              x.materialId === p.m.id &&
              x.round === p.round &&
              (x.date > date || (x.date === date && x.end > time + EPS)),
          )),
    );
  const normalCount = (t: (typeof tasks)[number], room: number, quota: number) =>
    sessionUnitCount(t.left, t.minutes, room, quota, policy);
  for (const cap of capacities) {
    const fixed = kept.filter((x) => x.date === cap.date);
    for (const f of fixed) {
      // Elapsed sessions are historical; revised settings must not invalidate them.
      if (cap.date === from && f.start < notBefore) continue;
      const issue = fixedTimeIssue(s, f, cap);
      if (issue) conflicts.push(fixedIssueMessage(f, issue));
    }
    for (let i = 0; i < fixed.length; i++)
      for (let j = i + 1; j < fixed.length; j++)
        if (
          !(cap.date === from && fixed[i].start < notBefore && fixed[j].start < notBefore) &&
          fixed[i].start < fixed[j].end &&
          fixed[j].start < fixed[i].end
        )
          conflicts.push(`${cap.date} の固定予定が重複しています。`);
    const blocked: Interval[] = [
      ...fixed.map((x) => [x.start, x.end] as Interval),
      ...sessions
        .filter((x) => x.date === cap.date && x.kind === 'review')
        .map((x) => [x.start, x.end] as Interval),
      ...(cap.date === from && notBefore > 0 ? [[0, notBefore] as Interval] : []),
    ];
    const slots = subtractIntervals(cap.slots, blocked);
    // Daily quotas distribute remaining work over usable dates; a shared slot is consumed once.
    const quota = new Map(
      s.exams.map((e) => {
        const group = tasks.filter((t) => t.exam.id === e.id && t.left > 0);
        const need = group.reduce((n, t) => n + t.left * t.minutes, 0);
        const usable = (c: Capacity) => {
          if (!group.some((t) => eligible(t, c.date))) return 0;
          const busy: Interval[] = [...kept, ...sessions.filter((x) => x.kind === 'review')]
            .filter((x) => x.date === c.date)
            .map((x) => [x.start, x.end]);
          if (c.date === from && notBefore > 0) busy.push([0, notBefore]);
          return subtractIntervals(c.slots, busy)
            .filter(([a, b]) => group.some((t) => t.minutes <= b - a + EPS))
            .reduce((n, [a, b]) => n + b - a, 0);
        };
        const future = capacities
          .filter((c) => c.date >= cap.date)
          .reduce((n, c) => n + usable(c), 0);
        return [
          e.id,
          allocation === 'earliest' ? need : (need * usable(cap)) / Math.max(1, future),
        ];
      }),
    );
    const used = new Map<string, number>();
    for (const [start, end] of slots) {
      let cursor = start;
      while (cursor < end - EPS) {
        const candidates = tasks.filter(
          (t) =>
            t.left > 0 &&
            eligible(t, cap.date) &&
            normalCount(t, end - cursor, (quota.get(t.exam.id) || 0) - (used.get(t.exam.id) || 0)) >
              0 &&
            (used.get(t.exam.id) || 0) < (quota.get(t.exam.id) || 0) - EPS &&
            canStart(t, cap.date, cursor),
        );
        candidates.sort((a, b) => {
          const pressure = (t: typeof a) =>
            (t.left * t.minutes) /
            Math.max(
              1,
              capacities
                .filter((c) => c.date >= cap.date && eligible(t, c.date))
                .reduce((n, c) => n + c.allocatable, 0),
            );
          return (
            pressure(b) * (1 + b.exam.priority * 0.15) -
              pressure(a) * (1 + a.exam.priority * 0.15) || deadline(a).localeCompare(deadline(b))
          );
        });
        const t = candidates[0];
        if (!t) break;
        const count = normalCount(
          t,
          end - cursor,
          (quota.get(t.exam.id) || 0) - (used.get(t.exam.id) || 0),
        );
        if (count <= 0) break;
        const length = count * t.minutes;
        sessions.push({
          id: uid(),
          date: cap.date,
          start: cursor,
          end: cursor + length,
          examId: t.exam.id,
          materialId: t.m.id,
          round: t.round,
          count,
          fixed: false,
          kind: 'study',
        });
        cursor += length;
        t.left -= count;
        used.set(t.exam.id, (used.get(t.exam.id) || 0) + length);
      }
    }
    // Review gets its own dated period and consumes the same global slots.
    const reviewExams = s.exams
      .filter(
        (e) =>
          e.reviewDays > 0 && cap.date >= addDays(e.target, -e.reviewDays) && cap.date < e.target,
      )
      .sort((a, b) => b.priority - a.priority);
    if (reviewExams.length) {
      const rest = subtractIntervals(cap.slots, [
        ...blocked,
        ...sessions.filter((x) => x.date === cap.date).map((x) => [x.start, x.end] as Interval),
      ]);
      let index = 0;
      for (const [start, end] of rest) {
        if (end - start < policy.minimum) continue;
        const exam = reviewExams[index++ % reviewExams.length];
        sessions.push({
          id: uid(),
          date: cap.date,
          start,
          end,
          examId: exam.id,
          materialId: '',
          round: 0,
          count: 0,
          fixed: false,
          kind: 'review',
        });
      }
    }
  }
  // Exhaust normal-duration opportunities across all dates before allowing short exceptions.
  for (const allowShort of [false, true]) {
    for (const cap of capacities) {
      const occupied: Interval[] = sessions
        .filter((x) => x.date === cap.date)
        .map((x) => [x.start, x.end]);
      if (cap.date === from && notBefore > 0) occupied.push([0, notBefore]);
      for (const [start, end] of subtractIntervals(cap.slots, occupied)) {
        let cursor = start;
        while (cursor < end - EPS) {
          const candidates = tasks.filter(
            (t) =>
              t.left > 0 &&
              eligible(t, cap.date) &&
              canStart(t, cap.date, cursor) &&
              t.minutes <= end - cursor + EPS &&
              (allowShort ||
                Math.min(t.left, Math.floor((end - cursor + EPS) / t.minutes)) * t.minutes >=
                  policy.minimum - EPS),
          );
          candidates.sort(
            (a, b) => deadline(a).localeCompare(deadline(b)) || b.exam.priority - a.exam.priority,
          );
          const t = candidates[0];
          if (!t) break;
          const fits = Math.floor((end - cursor + EPS) / t.minutes);
          const count = Math.min(t.left, fits);
          const length = count * t.minutes;
          const small = length < policy.minimum - EPS;
          sessions.push({
            id: uid(),
            date: cap.date,
            start: cursor,
            end: cursor + count * t.minutes,
            examId: t.exam.id,
            materialId: t.m.id,
            round: t.round,
            count,
            fixed: false,
            kind: 'study',
            ...(small
              ? {
                  allocationReason:
                    t.left * t.minutes < policy.minimum - EPS && count === t.left
                      ? ('final-remainder' as const)
                      : ('deadline' as const),
                }
              : {}),
          });
          cursor += count * t.minutes;
          t.left -= count;
        }
      }
    }
  }
  // Merge a short remainder with a neighbouring session when the extra time fits that session's slot.
  const keptIds = new Set(kept.map((x) => x.id));
  for (const donor of [...sessions]) {
    if (
      keptIds.has(donor.id) ||
      !sessions.some((x) => x.id === donor.id) ||
      donor.kind !== 'study' ||
      donor.end - donor.start >= policy.minimum - EPS
    )
      continue;
    const length = donor.end - donor.start;
    const targets = sessions
      .filter(
        (x) =>
          x.id !== donor.id &&
          !keptIds.has(x.id) &&
          x.kind === 'study' &&
          x.materialId === donor.materialId &&
          x.round === donor.round,
      )
      .sort((a, b) => {
        const distance = (x: Session) =>
          Math.abs(Date.parse(x.date) - Date.parse(donor.date) + (x.start - donor.start) * 60000);
        return distance(a) - distance(b);
      });
    for (const target of targets) {
      const combined = target.end - target.start + length;
      const options = [
        { date: target.date, start: target.start, end: target.end + length },
        { date: target.date, start: target.start - length, end: target.end },
        { date: donor.date, start: donor.start, end: donor.start + combined },
        { date: donor.date, start: donor.end - combined, end: donor.end },
      ];
      const task = tasks.find((t) => t.m.id === target.materialId && t.round === target.round)!;
      const fit = options.find(
        ({ date, start: a, end: b }) =>
          capacities
            .find((c) => c.date === date)
            ?.slots.some(([lo, hi]) => a >= lo - EPS && b <= hi + EPS) &&
          !(date === from && a < notBefore) &&
          !sessions.some(
            (x) =>
              x.id !== target.id &&
              x.id !== donor.id &&
              x.date === date &&
              a < x.end - EPS &&
              x.start < b - EPS,
          ) &&
          !sessions.some((x) => {
            if (x.kind !== 'study' || x.id === target.id || x.id === donor.id) return false;
            const other = tasks.find((t) => t.m.id === x.materialId && t.round === x.round);
            return (
              other &&
              ((precedes(other, task) && (x.date > date || (x.date === date && x.end > a + EPS))) ||
                (precedes(task, other) &&
                  (x.date < date || (x.date === date && x.start < b - EPS))))
            );
          }),
      );
      if (!fit) continue;
      target.date = fit.date;
      target.start = fit.start;
      target.end = fit.end;
      target.count += donor.count;
      if (target.end - target.start >= policy.minimum - EPS) delete target.allocationReason;
      sessions.splice(
        sessions.findIndex((x) => x.id === donor.id),
        1,
      );
      break;
    }
  }
  for (const e of s.exams.filter((e) => e.reviewDays > 0 && e.target > from))
    if (!sessions.some((x) => x.examId === e.id && x.kind === 'review' && x.date >= from))
      conflicts.push(
        `${e.name}：残りの復習期間に復習枠を確保できません。学習可能枠を見直してください。`,
      );
  return {
    id: uid(),
    createdAt: new Date().toISOString(),
    calculationVersion: PLAN_CALCULATION_VERSION,
    settingsSnapshot: structuredClone(s),
    settingsUpdatedAt: state.settingsUpdatedAt,
    notBefore,
    from,
    sessions: sessions.sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start),
    capacities: [
      ...(preserve ? (state.plan?.capacities.filter((c) => c.date < from) ?? []) : []),
      ...capacities,
    ],
    conflicts: [...new Set(conflicts)],
    shortfalls: tasks
      .filter((t) => t.left > 0)
      .map((t) => ({
        materialId: t.m.id,
        round: t.round,
        count: t.left,
        minutes: t.left * t.minutes,
        reason: '期限までの割当可能枠・集中ブロック・教材順序の条件に収まりません。',
      })),
  };
}
export function propose(state: AppState, from: string, reason: string): AppState {
  const now = new Date();
  const notBefore = from === today() ? now.getHours() * 60 + now.getMinutes() : 0;
  const unreported = [
    ...new Set(
      (state.plan?.sessions ?? [])
        .filter(
          (x) =>
            x.kind === 'study' &&
            (x.date < from || (x.date === from && x.start < notBefore)) &&
            !reported(state, x.date, x.materialId, x.round),
        )
        .map(
          (x) =>
            `${x.date}｜${state.settings.materials.find((m) => m.id === x.materialId)?.name}｜${x.round + 1}周目`,
        ),
    ),
  ];
  return {
    ...state,
    proposal: {
      plan: generatePlan(state, from, true, notBefore),
      basedOn: state.plan?.id ?? null,
      reason,
      unreported,
    },
  };
}
export function proposalAfterRecord(state: AppState, reason: string): AppState {
  if (!state.plan) return state;
  try {
    const candidate =
      state.proposal?.settingsBase && sameRevisionBase(state.proposal.settingsBase, state.settings)
        ? proposeSettings(state, state.proposal.plan.settingsSnapshot!, today())
        : propose(state, today(), reason);
    return { ...candidate, draft: { ...state.draft, replanError: '' } };
  } catch (error) {
    return {
      ...state,
      proposal: null,
      draft: {
        ...state.draft,
        replanError: `記録は保存しました。再計画は設定を確認してから作成してください。${String(error)}`,
      },
    };
  }
}
export function proposeSettings(state: AppState, settings: Settings, from: string): AppState {
  requirePlanningInputs(settings);
  validateRevisedSettings(state, settings, from);
  const candidate = propose(
    { ...state, settings, settingsUpdatedAt: new Date().toISOString() },
    from,
    '対話で見直した条件を使い、残りの課題を再配分します。設定も承認時に反映します。',
  );
  return {
    ...state,
    proposal: { ...candidate.proposal!, settingsBase: structuredClone(state.settings) },
  };
}
export function approve(state: AppState, acknowledge = false): AppState {
  const p = state.proposal;
  if (!p) throw new Error('再計画案がありません。');
  if (p.plan.calculationVersion !== PLAN_CALCULATION_VERSION)
    throw new Error(
      '計算方式が更新されました。問題数ではなく所要時間を基準に案を作り直してください。',
    );
  if (p.basedOn !== (state.plan?.id ?? null))
    throw new Error('計画が変更されました。案を作り直してください。');
  if (
    !p.plan.settingsSnapshot ||
    !(p.settingsBase
      ? sameRevisionBase(p.settingsBase, state.settings)
      : sameSettings(p.plan.settingsSnapshot, state.settings))
  )
    throw new Error('作成後に設定が変わっています。現在の設定で案を作り直してください。');
  const settings = p.plan.settingsSnapshot;
  requirePlanningInputs(settings);
  validateRevisedSettings(state, settings);
  const now = new Date();
  const minute = now.getHours() * 60 + now.getMinutes();
  if (
    p.plan.sessions.some(
      (x) =>
        (x.date > today() || (x.date === today() && x.start >= minute)) &&
        overlapsBusy(settings, x).length > 0,
    )
  )
    throw new Error('授業・予定と重複しています。固定予定や設定を確認して案を作り直してください。');
  if (p.plan.conflicts.length) throw new Error('固定予定または復習枠の競合を解消してください。');
  if (p.unreported.length && !acknowledge) throw new Error('未報告の扱いを確認してください。');
  return {
    ...state,
    settings,
    settingsUpdatedAt: !sameSettings(state.settings, settings)
      ? now.toISOString()
      : state.settingsUpdatedAt,
    plan: {
      ...p.plan,
      settingsUpdatedAt: !sameSettings(state.settings, settings)
        ? now.toISOString()
        : state.settingsUpdatedAt,
    },
    history: state.plan ? [...state.history, state.plan] : state.history,
    proposal: null,
    draft: { ...state.draft, revision: undefined },
  };
}
export function undoPlan(state: AppState): AppState {
  const previous = state.history.at(-1);
  if (!previous) throw new Error('戻せる計画がありません。');
  return { ...state, plan: previous, history: state.history.slice(0, -1), proposal: null };
}
