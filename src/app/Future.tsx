import { Props, duration } from '../components/common';
import { Session, today } from '../domain/model';
import { ShortfallDetails } from '../components/ShortfallDetails';
import { progressReceipts } from '../domain/progressReceipt';
import { ProgressReceiptView, receiptLabel } from '../components/ProgressReceiptView';

export function Future({
  state,
  onCalendar,
  onProposal,
}: Props & { onCalendar: (date?: string) => void; onProposal: () => void }) {
  const groups = new Map<string, Session[]>();
  for (const session of state.plan?.sessions ?? []) {
    if (session.date <= today() || (session.kind === 'study' && session.count <= 0)) continue;
    groups.set(session.date, [...(groups.get(session.date) ?? []), session]);
  }
  const shortfalls = state.plan?.shortfalls ?? [];
  const receipts = progressReceipts(state);
  return (
    <div className="future-page">
      {state.proposal && (
        <button className="primary" onClick={onProposal}>
          計画案を確認
        </button>
      )}
      {groups.size ? (
        [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([date, sessions]) => {
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
                  data-return-focus={`future:${date}`}
                  onClick={() => onCalendar(date)}
                >
                  {date}
                </button>
              </h2>
              <ul>
                {[...rows.values()].map(({ session, count, minutes }) => (
                  <li key={`${session.kind}/${session.materialId}/${session.round}/${session.examId}/${session.fixed}`}>
                    <span>
                      {session.kind === 'review'
                        ? `${state.settings.exams.find((exam) => exam.id === session.examId)?.name ?? '試験'} · 復習`
                        : `${state.settings.materials.find((material) => material.id === session.materialId)?.name ?? session.materialId} · ${session.round + 1}周目`}
                    </span>
                    <strong>{session.kind === 'review' ? duration(minutes) : `${count}問`}</strong>
                    {session.fixed && <span className="future-fixed">固定</span>}
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      ) : (
        <p>{shortfalls.length ? '今後の配置済み予定はありません。' : '今後の予定はありません。'}</p>
      )}
      <ShortfallDetails state={state} />
      {receipts.length > 0 && (
        <details className="plan-change-history">
          <summary>実績による予定調整の履歴</summary>
          {[...receipts].reverse().map((receipt) => (
            <details key={receipt.id}>
              <summary>{receipt.date} · {state.settings.materials.find((material) => material.id === receipt.materialId)?.name ?? receipt.materialId} · {receiptLabel(receipt)}</summary>
              <ProgressReceiptView state={state} receipt={receipt} />
            </details>
          ))}
        </details>
      )}
      <button onClick={() => onCalendar()}>詳細カレンダーを見る</button>
    </div>
  );
}
