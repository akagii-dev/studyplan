import { clock } from '../domain/model';
import type { RemainingWorkRow } from '../domain/remainingWork';

/** The daily recorder and future plan use the same allocation projection. */
export function WorkPlacements({ row }: { row: RemainingWorkRow }) {
  return (
    <div className="work-placements">
      <p>
        教材・周回全体：残り {row.remaining}{row.unit}
        {!row.needsReview && row.balanced ? ` = 予定 ${row.executable}${row.unit} + 未配置 ${row.unplaced}${row.unit}` :
          ` / 実行可能 ${row.executable}${row.unit} / 未配置 ${row.unplaced}${row.unit}`}
      </p>
      {row.placements.length > 0 && <ul aria-label="実行可能な配置先">
        {row.placements.map((session) => <li key={session.id}>
          <time dateTime={session.date}>{session.date}</time> {clock(session.start)}〜{clock(session.end)}
          {' · '}この予定の残り {session.count}{row.unit}{session.fixed ? '（固定）' : ''}
        </li>)}
      </ul>}
      {row.unplaced > 0 && <div className="work-unplaced">
        <strong>未配置 {row.unplaced}{row.unit}</strong>
        {row.unplacedReasons.map((reason) => <p key={reason}>{reason}</p>)}
      </div>}
      {row.needsReview && <div className="work-review">
        <strong>調整未反映・要確認</strong>
        {row.reasons.map((reason) => <p key={reason}>{reason}</p>)}
        {row.unavailable.map(({ session, reason }) => <p key={session.id}>
          元の配置：{session.date} {clock(session.start)}〜{clock(session.end)} · 残り {session.count}{row.unit}。{reason}
        </p>)}
      </div>}
    </div>
  );
}
