import { materialUnit } from '../domain/calendarQuantity';
import { Props, duration } from '../components/common';
import { useState } from 'react';
import { upcomingSunday, shortDayLabel, weekRangeLabel } from '../domain/calendar';
import { Session, today, addDays } from '../domain/model';
import { ShortfallDetails } from '../components/ShortfallDetails';
import { progressReceipts } from '../domain/progressReceipt';
import { ProgressReceiptView, receiptLabel } from '../components/ProgressReceiptView';

export function Future({
  state,
  onCalendar,
  onProposal,
  initialWeek = upcomingSunday(today()),
  onWeekChange,
}: Props & {
  onCalendar: (date?: string) => void;
  onProposal: () => void;
  initialWeek?: string;
  onWeekChange?: (date: string) => void;
}) {
  const [week, setWeek] = useState(initialWeek);
  const moveWeek = (date: string) => {
    setWeek(date);
    onWeekChange?.(date);
  };
  const groups = new Map<string, Session[]>();
  for (const session of state.plan?.sessions ?? []) {
    if (
      session.date < week ||
      session.date > addDays(week, 6) ||
      (session.kind === 'study' && session.count <= 0)
    )
      continue;
    groups.set(session.date, [...(groups.get(session.date) ?? []), session]);
  }
  const shortfalls = state.plan?.shortfalls ?? [];
  const receipts = progressReceipts(state);
  return (
    <div className="future-page">
      <button data-return-focus="future:calendar" onClick={() => onCalendar(week)}>
        詳細カレンダーを見る
      </button>
      <div className="future-week row" role="group" aria-label="週間予定の表示範囲">
        <button aria-label="前の週" onClick={() => moveWeek(addDays(week, -7))}>
          ‹
        </button>
        <strong aria-live="polite">
          <time dateTime={week}>{weekRangeLabel(week)}</time>
        </strong>
        <button aria-label="次の週" onClick={() => moveWeek(addDays(week, 7))}>
          ›
        </button>
      </div>
      {state.proposal && (
        <button className="primary" onClick={onProposal}>
          計画案を確認
        </button>
      )}
      {groups.size ? (
        [...groups]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, sessions]) => {
            const rows = new Map<string, { session: Session; count: number; minutes: number }>();
            for (const session of sessions) {
              const key = JSON.stringify([
                session.kind,
                session.materialId,
                session.round,
                session.examId,
                session.fixed,
              ]);
              const existing = rows.get(key);
              rows.set(key, {
                session,
                count: (existing?.count ?? 0) + session.count,
                minutes: (existing?.minutes ?? 0) + session.end - session.start,
              });
            }
            return (
              <section className="future-day" key={date}>
                <h2>
                  <button
                    className="future-day-date"
                    aria-label={`${date} ${shortDayLabel(date)}`}
                    data-return-focus={`future:${date}`}
                    onClick={() => onCalendar(date)}
                  >
                    {shortDayLabel(date)}
                  </button>
                </h2>
                <ul>
                  {[...rows.values()].map(({ session, count, minutes }) => (
                    <li
                      key={`${session.kind}/${session.materialId}/${session.round}/${session.examId}/${session.fixed}`}
                    >
                      <span>
                        {session.kind === 'review'
                          ? `${state.settings.exams.find((exam) => exam.id === session.examId)?.name ?? '試験'} · 復習`
                          : `${state.settings.materials.find((material) => material.id === session.materialId)?.name ?? session.materialId} · ${session.round + 1}周目`}
                      </span>
                      <strong>
                        {session.kind === 'review'
                          ? duration(minutes)
                          : `${count}${materialUnit(state.settings.materials.find((m) => m.id === session.materialId)?.unit)}`}
                      </strong>
                      {session.fixed && <span className="future-fixed">固定</span>}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })
      ) : (
        <p>
          {shortfalls.length ? 'この週に配置済み予定はありません。' : 'この週の予定はありません。'}
        </p>
      )}
      <ShortfallDetails state={state} />
      {receipts.length > 0 && (
        <details className="plan-change-history">
          <summary>実績による予定調整の履歴</summary>
          {[...receipts].reverse().map((receipt) => (
            <details key={receipt.id}>
              <summary>
                {receipt.date} ·{' '}
                {state.settings.materials.find((material) => material.id === receipt.materialId)
                  ?.name ?? receipt.materialId}{' '}
                · {receiptLabel(receipt)}
              </summary>
              <ProgressReceiptView state={state} receipt={receipt} />
            </details>
          ))}
        </details>
      )}
    </div>
  );
}
