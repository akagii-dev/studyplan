import { todayStudyRows } from '../domain/todayProgress';
import { AppState, today } from '../domain/model';

export function TodayStudyList({
  state,
  onRecord,
  prominentRecord = false,
}: {
  state: AppState;
  onRecord?: (target: { date: string; materialId: string; round: number }) => void;
  prominentRecord?: boolean;
}) {
  const date = today();
  const rows = todayStudyRows(state, date);
  if (!rows.length) return <p>今日の予定・実績はありません。</p>;
  return (
    <div className="today-study-list" role="list">
      {rows.map((row) => (
        <div className="today-study-row" role="listitem" key={`${row.materialId}/${row.round}`}>
          <div className="today-study-name">
            <strong>{row.materialName}</strong>
            <span>{row.round + 1}周目</span>
          </div>
          <div className="today-study-values">
            <span>{row.planned > 0 ? `予定 ${row.planned}問` : '予定なし'}</span>
            <span>{row.reported ? `実績 ${row.actual}問` : '実績 未入力'}</span>
          </div>
          {onRecord &&
            state.settings.materials.some((material) => material.id === row.materialId) && (
              <button
                className={prominentRecord ? 'primary small' : undefined}
                aria-label={`${row.materialName} ${row.round + 1}周目を${row.reported ? '追加で記録' : '記録'}`}
                onClick={() => onRecord({ date, materialId: row.materialId, round: row.round })}
              >
                {row.reported ? '追加で記録' : '記録'}
              </button>
            )}
        </div>
      ))}
    </div>
  );
}
