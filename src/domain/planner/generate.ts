import { startOfWeek } from '../calendar';
import {
  addDays,
  AppState,
  Capacity,
  Interval,
  Plan,
  remaining,
  reported,
  Session,
} from '../model';
import { fixedIssueMessage, fixedOrderIssue, fixedTimeIssue } from '../planConstraints';
import { PLAN_CALCULATION_VERSION, sessionPolicy, sessionUnitCount } from '../sessionPolicy';
import { weeklyCapacities } from '../weeklyCapacity';
import { capacityForDate } from './capacity';
import { PlanningContext } from './context';
import { datesBetween, subtractIntervals } from './intervals';
import { validateSettings } from './validation';
import { createProgressBaseline } from '../progressReflection';
const EPS = 1e-7;
export interface RetainedAllocation {
  sessions: Session[];
  /** Remaining work after reserving unfinished work on the current day. */
  remaining: Record<string, number>;
  /** Existing shortfalls of unaffected tasks are not automatically refilled. */
  unplaced?: Record<string, number>;
}
export function generatePlan(
  state: AppState,
  from: string,
  preserve = true,
  notBefore = 0,
  allocation: 'balanced' | 'earliest',
  context: PlanningContext,
  retention?: RetainedAllocation,
): Plan {
  let sequence = 0;
  const existingIds = new Set(
    retention
      ? [
          ...retention.sessions.map((x) => x.id),
          ...(state.plan?.sessions.map((x) => x.id) ?? []),
          ...(state.plan?.adjustmentBasis?.sessions.map((x) => x.id) ?? []),
        ]
      : [],
  );
  const nextId = () => {
    let id: string;
    do {
      id = `${context.idPrefix}-${sequence++}`;
    } while (existingIds.has(id));
    return id;
  };
  const { settings: s } = state;
  const policy = sessionPolicy(s);
  const errors = validateSettings(s);
  if (errors.length) throw new Error(errors.join('\n'));
  if (!s.exams.length || !s.materials.length) throw new Error('試験と教材を登録してください。');
  const to = s.exams.reduce((d, e) => (e.target > d ? e.target : d), from);
  const weekDays = datesBetween(startOfWeek(from), addDays(startOfWeek(to), 6)).map((d) =>
    capacityForDate(s, d),
  );
  const capacities = weekDays.filter((c) => c.date >= from && c.date <= to);
  const kept =
    retention?.sessions ??
    (preserve
      ? (state.plan?.sessions.filter(
          (x) =>
            (x.kind === 'review' || x.count > 0) &&
            (x.date < from || (x.date === from && x.start < notBefore) || x.fixed),
        ) ?? [])
      : []);
  const sessions: Session[] = kept.map((x) => ({ ...x }));
  const weeks = new Map(weeklyCapacities(weekDays, s.buffer, kept).map((w) => [w.from, w]));
  const weekFor = (date: string) => weeks.get(startOfWeek(date))!;
  const weeklyRoom = (date: string) => Math.max(0, weekFor(date).limit - weekFor(date).used);
  const assign = (session: Session) => {
    sessions.push(session);
    weekFor(session.date).used += session.end - session.start;
  };
  const conflicts: string[] = [];
  const tasks = s.materials.flatMap((m) =>
    m.rounds.map((r, round) => ({
      m,
      round,
      minutes: r.minutes,
      left: retention?.remaining[JSON.stringify([m.id, round])] ?? remaining(state, m.id, round),
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
  const eligible = (t: (typeof tasks)[number], d: string) =>
    d >= t.exam.start &&
    d <= deadline(t) &&
    // A report, including an explicit zero, closes this material/round for the reported day.
    // Keep elapsed and fixed sessions above, but redistribute unperformed work from tomorrow.
    !(d === from && reported(state, d, t.m.id, t.round));
  for (const x of kept.filter(
    (x) => (x.fixed || retention) && x.date >= from && !(x.date === from && x.start < notBefore),
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
          !retention &&
          e.reviewDays > 0 &&
          cap.date >= addDays(e.target, -e.reviewDays) &&
          cap.date < e.target,
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
        const length = Math.min(Math.max(policy.minimum, left), end - start, weeklyRoom(cap.date));
        if (length < policy.minimum) continue;
        assign({
          id: nextId(),
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
          (retention?.unplaced?.[JSON.stringify([p.m.id, p.round])] ?? 0) > 0 ||
          sessions.some(
            (x) =>
              x.kind === 'study' &&
              x.materialId === p.m.id &&
              x.round === p.round &&
              (x.date > date || (x.date === date && x.end > time + EPS)),
          )),
    );
  // Kept successors are an upper bound for new predecessor work. Do not insert
  // an earlier round after an already reserved later round.
  const availableRoom = (t: (typeof tasks)[number], date: string, start: number, end: number) => {
    let room = Math.min(end - start, weeklyRoom(date));
    if (retention)
      for (const x of kept) {
        const successor = tasks.find(
          (other) => other.m.id === x.materialId && other.round === x.round,
        );
        if (x.kind !== 'study' || x.date < from || !successor || !precedes(t, successor)) continue;
        if (x.date < date) return 0;
        if (x.date === date) room = Math.min(room, x.start - start);
      }
    return Math.max(0, room);
  };
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
            normalCount(
              t,
              availableRoom(t, cap.date, cursor, end),
              (quota.get(t.exam.id) || 0) - (used.get(t.exam.id) || 0),
            ) > 0 &&
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
          availableRoom(t, cap.date, cursor, end),
          (quota.get(t.exam.id) || 0) - (used.get(t.exam.id) || 0),
        );
        if (count <= 0) break;
        const length = count * t.minutes;
        assign({
          id: nextId(),
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
          !retention &&
          e.reviewDays > 0 &&
          cap.date >= addDays(e.target, -e.reviewDays) &&
          cap.date < e.target,
      )
      .sort((a, b) => b.priority - a.priority);
    if (reviewExams.length) {
      const rest = subtractIntervals(cap.slots, [
        ...blocked,
        ...sessions.filter((x) => x.date === cap.date).map((x) => [x.start, x.end] as Interval),
      ]);
      let index = 0;
      for (const [start, end] of rest) {
        const length = Math.min(end - start, weeklyRoom(cap.date));
        if (length < policy.minimum) continue;
        const exam = reviewExams[index++ % reviewExams.length];
        assign({
          id: nextId(),
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
              t.minutes <= availableRoom(t, cap.date, cursor, end) + EPS &&
              (allowShort ||
                Math.min(
                  t.left,
                  Math.floor((availableRoom(t, cap.date, cursor, end) + EPS) / t.minutes),
                ) *
                  t.minutes >=
                  policy.minimum - EPS),
          );
          candidates.sort(
            (a, b) => deadline(a).localeCompare(deadline(b)) || b.exam.priority - a.exam.priority,
          );
          const t = candidates[0];
          if (!t) break;
          const fits = Math.floor((availableRoom(t, cap.date, cursor, end) + EPS) / t.minutes);
          const count = Math.min(t.left, fits);
          const length = count * t.minutes;
          const small = length < policy.minimum - EPS;
          assign({
            id: nextId(),
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
          weekFor(date).used -
            (startOfWeek(target.date) === startOfWeek(date) ? target.end - target.start : 0) -
            (startOfWeek(donor.date) === startOfWeek(date) ? length : 0) +
            combined <=
            weekFor(date).limit + EPS &&
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
      weekFor(target.date).used -= target.end - target.start;
      weekFor(donor.date).used -= length;
      weekFor(fit.date).used += combined;
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
  // Different allocation passes can leave adjoining cards for the same work.
  // Coalesce only new sessions inside one real concentration block.
  sessions.sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
  for (let i = 1; i < sessions.length;) {
    const a = sessions[i - 1],
      b = sessions[i];
    if (
      ((!keptIds.has(a.id) && !keptIds.has(b.id)) ||
        (retention && !a.fixed && !b.fixed && (!keptIds.has(a.id) || !keptIds.has(b.id)))) &&
      a.kind === 'study' &&
      b.kind === 'study' &&
      a.date === b.date &&
      a.materialId === b.materialId &&
      a.round === b.round &&
      a.examId === b.examId &&
      Math.abs(a.end - b.start) < EPS &&
      capacities
        .find((c) => c.date === a.date)
        ?.slots.some(([lo, hi]) => a.start >= lo - EPS && b.end <= hi + EPS)
    ) {
      if (retention && keptIds.has(b.id)) a.id = b.id;
      a.end = b.end;
      a.count += b.count;
      if (a.end - a.start >= policy.minimum - EPS) delete a.allocationReason;
      sessions.splice(i, 1);
    } else i++;
  }
  for (const fixed of kept.filter(
    (x) => x.fixed && (x.date > from || (x.date === from && x.start >= notBefore)),
  )) {
    const issue = fixedOrderIssue(state, fixed, sessions, from, notBefore, retention?.remaining);
    if (issue) conflicts.push(fixedIssueMessage(fixed, issue));
  }
  for (const e of s.exams.filter((e) => e.reviewDays > 0 && e.target > from))
    if (!sessions.some((x) => x.examId === e.id && x.kind === 'review' && x.date >= from))
      conflicts.push(
        `${e.name}：残りの復習期間に復習枠を確保できません。学習可能枠を見直してください。`,
      );
  for (const week of weeks.values())
    if (
      week.used > week.limit + EPS &&
      sessions.some(
        (x) =>
          startOfWeek(x.date) === week.from &&
          (x.date > from || (x.date === from && x.start >= notBefore)),
      )
    )
      conflicts.push(
        `${week.from}〜${week.to}の週の割当上限${week.limit}分を、固定・保持予定が${Math.ceil(week.used - week.limit)}分超えています。固定予定または週の学習可能枠・余裕率を見直してください。`,
      );
  const shortfallReason = (t: (typeof tasks)[number]) => {
    const due = deadline(t);
    const need = t.left * t.minutes;
    const relevant = capacities.filter((cap) => eligible(t, cap.date));
    if (!relevant.length)
      return `${due}までが学習期限ですが、再配分の対象日に学習できる日がありません。`;
    const raw = relevant.flatMap((cap) => cap.slots);
    if (!raw.length) return `${due}までの学習可能枠がありません。`;
    if (raw.every(([start, end]) => end - start + EPS < t.minutes))
      return `1問に必要な${t.minutes}分の連続学習枠が${due}までにありません。`;
    const open = relevant.map((cap) => {
      const occupied: Interval[] = sessions
        .filter((session) => session.date === cap.date)
        .map((session) => [session.start, session.end]);
      if (cap.date === from && notBefore > 0) occupied.push([0, notBefore]);
      return { date: cap.date, slots: subtractIntervals(cap.slots, occupied) };
    });
    const free = open.flatMap((day) => day.slots);
    const total = free.reduce((sum, [start, end]) => sum + end - start, 0);
    if (total + EPS >= t.minutes && relevant.every((cap) => weeklyRoom(cap.date) + EPS < t.minutes))
      return `${due}までの週の割当上限に、1問分の${t.minutes}分を入れる空きがありません。`;
    if (total + EPS < need)
      return `${due}までの空き枠は${Math.floor(total)}分、未配置の必要時間は${need}分です。`;
    if (free.every(([start, end]) => end - start + EPS < t.minutes))
      return `ほかの予定を除くと、1問に必要な${t.minutes}分の連続枠が${due}までに残っていません。`;
    const predecessor = tasks.find(
      (before) =>
        precedes(before, t) &&
        (before.left > 0 ||
          (retention?.unplaced?.[JSON.stringify([before.m.id, before.round])] ?? 0) > 0),
    );
    if (predecessor)
      return `先行する「${predecessor.m.name}」${predecessor.round + 1}周目が未完了のため、${due}までに配分できません。`;
    return `${due}までに${need}分が未配置です。残る空き枠は${Math.floor(total)}分、1問に${t.minutes}分必要です。`;
  };
  const plan: Plan = {
    id: nextId(),
    createdAt: context.timestamp,
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
        reason: shortfallReason(t),
      })),
  };
  plan.progressBaseline = createProgressBaseline(plan, state.records);
  return plan;
}
