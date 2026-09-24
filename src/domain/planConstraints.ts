import {
  AppState,
  Capacity,
  Interval,
  Session,
  Settings,
  clock,
  weekday,
  remaining,
} from './model';
import { unavailableEvents } from './planAudit';
import type { RevisionTopic } from './revision';

export interface ConstraintIssue {
  message: string;
  topic: RevisionTopic;
  index: number;
  itemId: string;
}
const fits = (session: Session, ranges: Interval[]) =>
  ranges.some(([a, b]) => session.start >= a - 1e-7 && session.end <= b + 1e-7);
const timeRanges = (ranges: Interval[]) =>
  ranges.map(([a, b]) => `${clock(a)}〜${clock(b)}`).join('、');
function missing(session: Session, ranges: Interval[]): Interval[] {
  let intervals: Interval[] = [[session.start, session.end]];
  for (const [a, b] of ranges)
    intervals = intervals.flatMap(([x, y]): Interval[] =>
      b <= x || a >= y
        ? [[x, y]]
        : [...(x < a ? [[x, a] as Interval] : []), ...(b < y ? [[b, y] as Interval] : [])],
    );
  return intervals;
}
export function fixedTimeIssue(
  settings: Settings,
  session: Session,
  capacity: Capacity,
): ConstraintIssue | null {
  const result = (message: string, topic: RevisionTopic, index = 0, itemId = '') => ({
    message,
    topic,
    index,
    itemId,
  });
  if (fits(session, capacity.slots)) {
    const material = settings.materials.find((m) => m.id === session.materialId);
    const round = material?.rounds[session.round];
    if (
      session.kind === 'study' &&
      round &&
      session.count * round.minutes > session.end - session.start + 1e-7
    )
      return result(
        `${material!.name} ${session.round + 1}周目の${session.count}問には推定所要時間${Math.round(session.count * round.minutes * 10) / 10}分が必要ですが、固定枠は${Math.round((session.end - session.start) * 10) / 10}分です。推定時間を確認するか、固定を解除して再配置してください。`,
        'material',
        3 + session.round,
        session.materialId,
      );
    return null;
  }
  const busy = unavailableEvents(settings, session.date).filter(
    (e) => session.start < e.end && e.start < session.end,
  );
  if (busy.length) {
    const first = busy[0];
    const topic: RevisionTopic =
      first.kind === 'commute'
        ? 'commute'
        : first.kind === 'transition'
          ? 'focus'
          : first.kind === 'meal'
            ? 'meal'
            : first.kind === 'class' || first.kind === 'classBreak'
              ? 'class'
              : first.kind === 'exception'
                ? 'exception'
                : 'busy';
    const index =
      first.kind === 'transition'
        ? 2
        : first.kind === 'meal'
          ? first.id.includes('lunch')
            ? 2
            : first.id.includes('dinner')
              ? 4
              : 0
          : 0;
    return result(
      `${busy.map((e) => `${e.name || '大学の授業'}（${clock(e.start)}〜${clock(e.end)}）`).join('、')}と重なっています。`,
      topic,
      index,
      first.kind === 'classBreak' ? '' : first.id,
    );
  }
  const study = settings.windows.filter(
    (w) =>
      w.kind === 'study' &&
      w.from <= session.date &&
      session.date <= w.to &&
      w.weekdays.includes(weekday(session.date)),
  );
  if (
    missing(
      session,
      study.map((w) => [w.start, w.end]),
    ).length
  )
    return result(
      study.length
        ? `登録した学習可能枠（${timeRanges(study.map((w) => [w.start, w.end]))}）の外にあります。`
        : 'この日には学習可能枠が登録されていません。',
      'study',
    );
  if (session.end - session.start > settings.block)
    return result(
      `予定は${Math.round((session.end - session.start) * 10) / 10}分ですが、連続学習の上限は${settings.block}分です。`,
      'focus',
    );
  if (!fits(session, capacity.blocks ?? capacity.slots))
    return result(
      `${timeRanges(missing(session, capacity.blocks ?? []))}が休憩枠と重なります（休憩の設定：${settings.rest}分）。`,
      'focus',
      1,
    );
  return result('学習可能な時間帯に収まりません。現在の条件で案を作り直してください。', 'study');
}
export const fixedIssueMessage = (session: Session, issue: ConstraintIssue) =>
  `${session.date} ${clock(session.start)}〜${clock(session.end)}の固定予定：${issue.message}`;

/** Remaining work must be scheduled before a fixed successor, not merely somewhere in the plan. */
export function fixedOrderIssue(
  state: AppState,
  session: Session,
  sessions: Session[],
  from: string,
  notBefore = 0,
  remainingCounts?: Record<string, number>,
): ConstraintIssue | null {
  if (session.kind !== 'study') return null;
  const target = state.settings.materials.find((m) => m.id === session.materialId);
  if (!target) return null;
  for (const material of state.settings.materials.filter((m) => m.examId === target.examId)) {
    for (const round of material.rounds.keys()) {
      const precedes =
        material.order < target.order ||
        (material.order === target.order &&
          (material.id < target.id || (material.id === target.id && round < session.round)));
      if (!precedes) continue;
      const before = sessions
        .filter(
          (x) =>
            x.kind === 'study' &&
            x.materialId === material.id &&
            x.round === round &&
            (x.date > from || (x.date === from && x.start >= notBefore)) &&
            (x.date < session.date || (x.date === session.date && x.end <= session.start + 1e-7)),
        )
        .reduce((n, x) => n + x.count, 0);
      if (
        before <
        (remainingCounts?.[JSON.stringify([material.id, round])] ??
          remaining(state, material.id, round))
      )
        return {
          message: `取り組む順序を守れません。「${material.name}」${round + 1}周目が終わる前に「${target.name}」${session.round + 1}周目が固定されています。順序を確認するか、固定を解除して再配置してください。`,
          topic: 'material',
          itemId: target.id,
          index: 3 + target.rounds.length,
        };
    }
  }
  return null;
}
