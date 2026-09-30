import type { RemainingWorkRow } from '../domain/remainingWork';

/** Quantities and failures only; destinations belong to the calendar. */
export function WorkPlacements({ row }: { row: RemainingWorkRow }) {
  const issues = [...new Set([...row.reasons, ...row.unavailable.filter((item) => !item.clockOnly).map((item) => item.reason)])];
  return (
    <div className="work-placements">
      <p className="work-summary">残り{row.remaining}{row.unit} · 未配置{row.unplaced}{row.unit}</p>
      {row.unplacedReasons.map((reason) => <p key={reason}>{reason}</p>)}
      {issues.length > 0 && <p className="work-review">
        <strong>調整未反映・要確認</strong>：{issues.join(' ')}
      </p>}
    </div>
  );
}
