import { useState } from 'react';
import { clock } from '../domain/model';
import type { RemainingWorkRow } from '../domain/remainingWork';

/** Shared summary and progressive detail; the action never follows the full list. */
export function WorkPlacements({ row, onAdjust, unreported = false }: {
  row: RemainingWorkRow; onAdjust?: () => void; unreported?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [originalsOpen, setOriginalsOpen] = useState(false);
  return (
    <div className="work-placements">
      <p className="work-summary">
        残り{row.remaining}{row.unit} · 実行可能{row.executable}{row.unit} · 再配置待ち{row.pending}{row.unit} · 未配置{row.unplaced}{row.unit}
      </p>
      {onAdjust && <button type="button" onClick={onAdjust}>残りの配置を調整</button>}
      {row.needsReview && <p className="work-review">
        <strong>調整未反映・要確認</strong>：{row.reasons[0] ?? row.unavailable[0]?.reason}
      </p>}
      <details className="work-destinations" onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary>配置先を確認</summary>
        {open && <>
          {unreported && <p>未報告分は記録上の残量です。実績0として確定していません。</p>}
          {row.placements.length > 0 && <ul aria-label="実行可能な配置先">
            {row.placements.map((session) => <li key={session.id}>
              <time dateTime={session.date}>{session.date}</time> {clock(session.start)}〜{clock(session.end)}
              {' · '}この予定の残り {session.count}{row.unit}{session.fixed ? '（固定）' : ''}
            </li>)}
          </ul>}
          {row.pending > 0 && <details onToggle={(event) => setOriginalsOpen(event.currentTarget.open)}>
            <summary>経過済みの元の配置（{row.pendingPlacements.length}件）</summary>
            {originalsOpen && <ul>{row.pendingPlacements.map((session) => <li key={session.id}>
              {session.date} {clock(session.start)}〜{clock(session.end)} · 残り{session.count}{row.unit}
            </li>)}</ul>}
          </details>}
          {row.unplaced > 0 && <div className="work-unplaced">
            <strong>未配置{row.unplaced}{row.unit}</strong>
            {row.unplacedReasons.map((reason) => <p key={reason}>{reason}</p>)}
          </div>}
          {row.needsReview && <div className="work-review">
            {row.reasons.slice(1).map((reason) => <p key={reason}>{reason}</p>)}
            {row.unavailable.map(({ session, reason }) => <p key={session.id}>
              要確認の配置：{session.date} {clock(session.start)}〜{clock(session.end)} · 残り{session.count}{row.unit}。{reason}
            </p>)}
          </div>}
        </>}
      </details>
    </div>
  );
}
