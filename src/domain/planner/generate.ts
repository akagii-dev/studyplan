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
import { datesBetween, mergeIntervals, subtractIntervals } from './intervals';
import { dailyWaterfill } from './dailyWaterfill';
import { validateSettings } from './validation';
import { createProgressBaseline } from '../progressReflection';
import { workPrecedence } from '../terms';
const EPS = 1e-7;
export interface RetainedAllocation {
  sessions: Session[];
  /** Remaining work after reserving unfinished work on the current day. */
  remaining: Record<string, number>;
  /** Existing shortfalls of unaffected tasks are not automatically refilled. */
  unplaced?: Record<string, number>;
  /** Explicit restart rebuilds review slots as well as unfinished study work. */
  rebuildReviews?: boolean;
  /** An explicit restart may use the remainder of a reported, but unfinished day. */
  allowReportedDay?: boolean;
  /** Targeted adjustment keeps unrelated retained sessions separate from new work. */
  preserveSessionBoundaries?: boolean;
  /** Explicit redistribution balances final daily quantities; ordinary adjustment keeps its scope. */
  dailyQuantityBalance?: boolean;
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
      : (state.plan?.comparisonSessionIds ?? []),
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
  const weekStarts = new Map<string, string>();
  const weekStart = (date: string) => {
    let week = weekStarts.get(date);
    if (week === undefined) weekStarts.set(date, (week = startOfWeek(date)));
    return week;
  };
  const weekDays = datesBetween(startOfWeek(from), addDays(startOfWeek(to), 6)).map((d) =>
    capacityForDate(s, d),
  );
  const capacities = weekDays.filter((c) => c.date >= from && c.date <= to);
  const retained =
    retention?.sessions ??
    (preserve
      ? (state.plan?.sessions.filter(
          (x) =>
            (x.kind === 'review' || x.count > 0) &&
            (x.date < from || (x.date === from && x.start < notBefore) || x.fixed),
        ) ?? [])
      : []);
  const comparisonIds = new Set(state.plan?.comparisonSessionIds ?? []);
  const comparisons = retained.filter((session) => comparisonIds.has(session.id));
  const kept = retained.filter((session) => !comparisonIds.has(session.id));
  const sessions: Session[] = kept.map((x) => ({ ...x }));
  // The latest-ending study session of each material round. Placement only appends
  // sessions; merging later changes them, after the last start check.
  const latestStudy = new Map<string, { date: string; end: number }>();
  const noteStudy = (x: Session) => {
    if (x.kind !== 'study') return;
    const key = `${x.materialId}\u0000${x.round}`;
    const latest = latestStudy.get(key);
    if (!latest || x.date > latest.date || (x.date === latest.date && x.end > latest.end))
      latestStudy.set(key, { date: x.date, end: x.end });
  };
  sessions.forEach(noteStudy);
  const weeks = new Map(weeklyCapacities(weekDays, s.buffer, kept).map((w) => [w.from, w]));
  const weekFor = (date: string) => weeks.get(weekStart(date))!;
  const weeklyRoom = (date: string) => Math.max(0, weekFor(date).limit - weekFor(date).used);
  const assign = (session: Session) => {
    sessions.push(session);
    noteStudy(session);
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
  const deadlines = new Map(
    s.exams.map((exam) => [exam.id, addDays(exam.target, -exam.reviewDays - 1)]),
  );
  const deadline = (t: (typeof tasks)[number]) => deadlines.get(t.exam.id)!;
  const eligible = (t: (typeof tasks)[number], d: string) =>
    d >= t.exam.start &&
    d <= deadline(t) &&
    // A report, including an explicit zero, closes this material/round for the reported day.
    // Keep elapsed and fixed sessions above, but redistribute unperformed work from tomorrow.
    (retention?.allowReportedDay || !(d === from && reported(state, d, t.m.id, t.round)));
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
          (!retention || retention.rebuildReviews) &&
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
  const workPrecedes = workPrecedence(s);
  const precedes = (a: (typeof tasks)[number], b: (typeof tasks)[number]) =>
    workPrecedes({ materialId: a.m.id, round: a.round }, { materialId: b.m.id, round: b.round });
  const taskBounds = new Map(tasks.map((task) => {
    let first = { date: from, time: notBefore }, last = { date: deadline(task), time: 1440 };
    if (retention) for (const session of kept) {
      if (session.kind !== 'study' || session.count <= 0 || session.date < from) continue;
      const other = tasks.find((t) => t.m.id === session.materialId && t.round === session.round);
      if (!other) continue;
      if (precedes(other, task) && (session.date > first.date ||
        (session.date === first.date && session.end > first.time)))
        first = { date: session.date, time: session.end };
      if (precedes(task, other) && (session.date < last.date ||
        (session.date === last.date && session.start < last.time)))
        last = { date: session.date, time: session.start };
    }
    return [task, { first, last }];
  }));
  // Physical opportunity only: apply the weekly ceiling once after combining intervals.
  const taskInterval = (task: (typeof tasks)[number], date: string, a: number, b: number): Interval | null => {
    const { first, last } = taskBounds.get(task)!;
    if (!eligible(task, date) || date < first.date || date > last.date) return null;
    const start = date === first.date ? Math.max(a, first.time) : a;
    const end = date === last.date ? Math.min(b, last.time) : b;
    return end - start + EPS >= task.minutes ? [start, end] : null;
  };
  const canStart = (t: (typeof tasks)[number], date: string, time: number) =>
    !tasks.some(
      (p) =>
        precedes(p, t) &&
        (p.left > 0 ||
          (retention?.unplaced?.[JSON.stringify([p.m.id, p.round])] ?? 0) > 0 ||
          ((latest) => !!latest && (latest.date > date || (latest.date === date && latest.end > time + EPS)))(
            latestStudy.get(`${p.m.id}\u0000${p.round}`),
          )),
    );
  // Kept successors are an upper bound for new predecessor work. Do not insert
  // an earlier round after an already reserved later round.
  const availableRoom = (t: (typeof tasks)[number], date: string, start: number, end: number) => {
    const interval = taskInterval(t, date, start, end);
    return !interval || interval[0] > start + EPS ? 0 : Math.max(0, Math.min(interval[1] - start, weeklyRoom(date)));
  };
  const normalCount = (
    t: (typeof tasks)[number],
    room: number,
    quota: number,
    cap: Capacity,
    start: number,
  ) => {
    const neighbour =
      retention && !retention.preserveSessionBoundaries
        ? sessions.find(
            (x) =>
              x.kind === 'study' &&
              !x.fixed &&
              x.date === cap.date &&
              x.materialId === t.m.id &&
              x.round === t.round &&
              Math.abs(x.end - start) < EPS &&
              cap.slots.some(([lo, hi]) => x.start >= lo - EPS && start < hi - EPS),
          )
        : undefined;
    const minimum = neighbour
      ? Math.max(0, policy.minimum - (neighbour.end - neighbour.start))
      : policy.minimum;
    let count = sessionUnitCount(
      t.left,
      t.minutes,
      allocation === 'balanced'
        ? Math.min(room, Math.floor((quota + t.minutes / 2 + EPS) / t.minutes) * t.minutes)
        : room,
      quota,
      { ...policy, minimum },
    );
    // The daily quota also crosses concentration blocks. Reserve enough of it
    // for a normal next session instead of losing a one-unit daily tail.
    if (retention?.dailyQuantityBalance && count > 0 && quota > room + EPS &&
      quota - count * t.minutes > EPS && quota - count * t.minutes < policy.minimum - EPS) {
      const adjusted = Math.floor((quota - policy.minimum + EPS) / t.minutes);
      count = adjusted * t.minutes >= minimum - EPS ? Math.min(count, adjusted) : 0;
    }
    // Leave a normal-duration tail for the next block when this block cannot
    // finish the round. A sub-minimum predecessor would otherwise stop every
    // later round until the chronological fallback pass.
    if (retention?.dailyQuantityBalance && count > 0 && count < t.left &&
      (t.left - count) * t.minutes < policy.minimum - EPS && t.left * t.minutes > room + EPS) {
      const tail = Math.ceil((policy.minimum - EPS) / t.minutes);
      const adjusted = t.left - tail;
      count = adjusted * t.minutes >= minimum - EPS ? Math.min(count, adjusted) : 0;
    }
    // Complete a small remainder together, but do not inflate every daily share
    // to the preferred session duration. The quota is a target, not a hard limit.
    return count > 0 &&
      (t.left - count) * t.minutes < minimum - EPS &&
      t.left * t.minutes <= room + EPS
      ? t.left
      : count;
  };
  const freeSlots = new Map(
    capacities.map((cap) => {
      const busy: Interval[] = [...kept, ...sessions.filter((x) => x.kind === 'review')]
        .filter((x) => x.date === cap.date)
        .map((x) => [x.start, x.end]);
      if (cap.date === from && notBefore > 0) busy.push([0, notBefore]);
      return [cap.date, subtractIntervals(cap.slots, busy)];
    }),
  );
  // Free slots, eligibility and task bounds are fixed during placement, so the usable
  // time of the same tasks on the same day is computed once.
  const taskIndex = new Map(tasks.map((task, index) => [task, index]));
  const groupKeys = new WeakMap<typeof tasks, string>();
  const usableCache = new Map<string, Map<string, { intervals: Interval[]; minutes: number }>>();
  const groupKey = (group: typeof tasks) => {
    let key = groupKeys.get(group);
    if (key === undefined) groupKeys.set(group, (key = group.map((task) => taskIndex.get(task)).join(',')));
    return key;
  };
  const usableOn = (group: typeof tasks, c: Capacity) => {
    const key = groupKey(group);
    let byDate = usableCache.get(key);
    if (!byDate) usableCache.set(key, (byDate = new Map()));
    let cached = byDate.get(c.date);
    if (!cached) {
      const intervals = mergeIntervals((freeSlots.get(c.date) ?? []).flatMap(([a, b]) => group.flatMap((task) => {
        const interval = taskInterval(task, c.date, a, b);
        return interval ? [interval] : [];
      })));
      cached = { intervals, minutes: intervals.reduce((n, [a, b]) => n + b - a, 0) };
      byDate.set(c.date, cached);
    }
    return cached;
  };
  const usableIntervals = (group: typeof tasks, c: Capacity) => usableOn(group, c).intervals;
  const usable = (group: typeof tasks, c: Capacity) => usableOn(group, c).minutes;
  // Usable minutes of each placement week for a group, summed in date order like opportunity().
  const weekUsable = new Map<string, { week: string; dates: string[]; minutes: number[]; total: number }[]>();
  const weeksOf = (group: typeof tasks) => {
    const key = groupKey(group);
    let weeks = weekUsable.get(key);
    if (!weeks) {
      weeks = [];
      for (const c of capacities) {
        const week = weekStart(c.date);
        let last = weeks.at(-1);
        if (last?.week !== week) weeks.push((last = { week, dates: [], minutes: [], total: 0 }));
        const minutes = usable(group, c);
        last.dates.push(c.date);
        last.minutes.push(minutes);
        last.total += minutes;
      }
      weekUsable.set(key, weeks);
    }
    return weeks;
  };
  /**
   * Physical opportunity from `date` (inclusive) to the last placement day, limited by each
   * week's remaining room. `strict` excludes `date` itself.
   */
  const opportunityFrom = (group: typeof tasks, date: string, strict = false) => {
    let n = 0;
    for (const w of weeksOf(group)) {
      const last = w.dates[w.dates.length - 1];
      if (last < date || (strict && last === date)) continue;
      let minutes = w.total;
      if (w.dates[0] < date || (strict && w.dates[0] === date)) {
        minutes = 0;
        for (let i = 0; i < w.dates.length; i++)
          if (strict ? w.dates[i] > date : w.dates[i] >= date) minutes += w.minutes[i];
      }
      n += Math.min(minutes, weeklyRoom(w.week));
    }
    return n;
  };
  // A retained successor gives earlier work a different deadline of its own.
  // Combining it with later work would hide that bound in the quota denominator.
  // Different retained predecessors only delay the start of later work: they
  // must not give sequential work independent quotas extending to the same end.
  // taskInterval still applies each task's first boundary to physical capacity.
  const bucketKey = (t: (typeof tasks)[number]) => JSON.stringify([
    t.exam.id, retention?.dailyQuantityBalance ? (t.m.unit ?? '問') : '', taskBounds.get(t)!.last,
  ]);
  const bucketTasks = new Map<string, typeof tasks>();
  const balancedMaterials = new Set(tasks.filter((t) => t.left > 0).map((t) => t.m.id));
  for (const task of tasks) {
    const key = bucketKey(task);
    bucketTasks.set(key, [...(bucketTasks.get(key) ?? []), task]);
  }
  const ordered = (group: typeof tasks) => [...group].sort((a, b) =>
    a.m.order - b.m.order || a.m.id.localeCompare(b.m.id) || a.round - b.round);
  const minutesForUnits = (group: typeof tasks, count: number) => {
    let minutes = 0;
    for (const task of ordered(group)) {
      const units = Math.min(count, task.left);
      minutes += units * task.minutes;
      count -= units;
      if (count <= 0) break;
    }
    return minutes;
  };
  const quotaCarry = new Map<string, number>();
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
    // The weekly ceiling contributes to the daily target, without reserving or
    // removing any physical slots. Carry whole-unit/minimum-session rounding
    // forward instead of filling the start of the week with preferred blocks.
    const open = tasks.filter((t) => t.left > 0);
    const futureCaps = capacities.filter((c) => c.date >= cap.date);
    const weekFree = new Map<string, number>();
    for (const c of futureCaps) {
      const week = weekStart(c.date);
      weekFree.set(week, (weekFree.get(week) ?? 0) + usable(open, c));
    }
    const weight = (c: Capacity) =>
      Math.min(1, weeklyRoom(c.date) / Math.max(1, weekFree.get(weekStart(c.date)) ?? 0));
    // Weekly room does not change while today's shares are computed.
    const weights = futureCaps.map(weight);
    const shares = [...bucketTasks].map(([id, all]) => {
      const group = all.filter((t) => t.left > 0);
      const need = group.reduce((n, t) => n + t.left * t.minutes, 0);
      const today = usable(group, cap);
      const future = futureCaps.reduce((n, c, i) => n + usable(group, c) * weights[i], 0);
      const carry = Math.min(need, quotaCarry.get(id) ?? 0);
      let share =
        today > 0
          ? Math.max(0, carry + ((need - carry) * today * weight(cap)) / Math.max(EPS, future))
          : 0;
      let units: number | undefined;
      if (retention?.dailyQuantityBalance && group.length) {
        const quantity = group.reduce((n, t) => n + t.left, 0);
        // Different round speeds affect the capacity estimate. Exact placement
        // below always uses that round's duration and re-fills the remaining days.
        const minutes = need / quantity;
        const days = futureCaps.map((c) => ({
          date: c.date,
          week: weekStart(c.date),
          base: kept.filter((s) => s.kind === 'study' && s.date === c.date &&
            balancedMaterials.has(s.materialId) && all.some((t) =>
            t.exam.id === s.examId && (t.m.unit ?? '問') ===
            (tasks.find((other) => other.m.id === s.materialId)?.m.unit ?? '問')))
            .reduce((n, s) => n + s.count, 0),
          capacity: usableIntervals(group, c).reduce((n, [a, b]) => {
            const fits = Math.floor((b - a + EPS) / minutes);
            return n + (fits * minutes >= policy.minimum - EPS ? fits : 0);
          }, 0),
        }));
        const weekLimits = new Map(days.map((day) =>
          [day.week, Math.floor((weeklyRoom(day.date) + EPS) / minutes)]));
        units = dailyWaterfill(quantity, days, weekLimits).get(cap.date) ?? 0;
        share = minutesForUnits(group, units);
      }
      // Work whose deadline cannot be met using later slots may exceed its
      // fair share today. Overloaded tasks do not claim impossible demand.
      const urgent = Math.max(0, Math.min(need, opportunityFrom(group, cap.date)) -
        opportunityFrom(group, cap.date, true));
      return { id, need, share, urgent, units };
    });
    const target = retention?.dailyQuantityBalance
      ? Math.min(usable(open, cap), weeklyRoom(cap.date))
      : usable(open, cap) * weight(cap);
    const urgentTotal = shares.reduce((n, x) => n + x.urgent, 0);
    const flexibleTotal = shares.reduce((n, x) => n + Math.max(0, x.share - x.urgent), 0);
    const scale = Math.min(1, Math.max(0, target - urgentTotal) / Math.max(EPS, flexibleTotal));
    const quota = new Map(
      shares.map((x) => [
        x.id,
        allocation === 'earliest' ? x.need : x.urgent + Math.max(0, x.share - x.urgent) * scale,
      ]),
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
              (quota.get(bucketKey(t)) || 0) - (used.get(bucketKey(t)) || 0),
              cap,
              cursor,
            ) > 0 &&
            (used.get(bucketKey(t)) || 0) < (quota.get(bucketKey(t)) || 0) - EPS &&
            canStart(t, cap.date, cursor),
        );
        // Each candidate's pressure is fixed during one sort; compute it once.
        const pressures = new Map(candidates.map((t) =>
          [t, (t.left * t.minutes) / Math.max(1, opportunityFrom([t], cap.date))]));
        candidates.sort((a, b) => {
          const pressure = (t: typeof a) => pressures.get(t)!;
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
          (quota.get(bucketKey(t)) || 0) - (used.get(bucketKey(t)) || 0),
          cap,
          cursor,
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
        used.set(bucketKey(t), (used.get(bucketKey(t)) || 0) + length);
      }
    }
    for (const [examId, minutes] of quota)
      quotaCarry.set(examId, minutes - (used.get(examId) ?? 0));
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
    // A small extension already belongs to an unchanged retained block. Leave
    // it for the adjacent merge below instead of moving it to another date.
    if (
      retention &&
      !retention.preserveSessionBoundaries &&
      kept.some(
        (x) =>
          !x.fixed &&
          x.kind === 'study' &&
          x.date === donor.date &&
          x.materialId === donor.materialId &&
          x.round === donor.round &&
          Math.abs(x.end - donor.start) < EPS &&
          donor.end - x.start >= policy.minimum - EPS &&
          capacities
            .find((c) => c.date === donor.date)
            ?.slots.some(([lo, hi]) => x.start >= lo - EPS && donor.end <= hi + EPS),
      )
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
        (retention &&
          !retention.preserveSessionBoundaries &&
          !a.fixed &&
          !b.fixed &&
          (!keptIds.has(a.id) || !keptIds.has(b.id)))) &&
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
    ...(comparisons.length
      ? { comparisonSessionIds: comparisons.map((session) => session.id) }
      : {}),
    sessions: [...sessions, ...comparisons.map((session) => ({ ...session }))].sort(
      (a, b) => a.date.localeCompare(b.date) || a.start - b.start,
    ),
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
