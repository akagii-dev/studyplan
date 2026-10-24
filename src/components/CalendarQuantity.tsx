import { progressView } from '../domain/progressView';
import { ProgressValue } from './ProgressValue';
import { AppState, Session, today } from '../domain/model';
import { calendarDisplayQuantity, recordedShortage } from '../domain/calendarQuantity';

export function CalendarQuantityDetails({
  state,
  date,
  filter,
  onRecord,
}: {
  state: AppState;
  date: string;
  filter: string;
  onRecord: (session: Session) => void;
}) {
  const quantity = calendarDisplayQuantity(state, date, today(), filter);
  return (
    <div className="quantity-breakdown">
      {quantity.rows.map((row) => (
        <section key={JSON.stringify([row.materialId, row.round, row.unit])} className="border-b border-line py-3">
          <h4 className="m-0 mb-1.5 wrap-anywhere">
            {row.name} · {row.round + 1}周目
          </h4>
          <ProgressValue
            value={progressView({ ...row, shortage: recordedShortage(row) }, date, today())}
          />
          {date <= today() &&
            state.settings.materials.some(
              (m) => m.id === row.materialId && m.rounds[row.round],
            ) && (
              <button
                className="min-h-11"
                data-return-focus={`quantity:${date}:${row.materialId}:${row.round}`}
                onClick={() =>
                  onRecord({
                    id: '',
                    date,
                    materialId: row.materialId,
                    round: row.round,
                    examId: row.examId,
                    count: row.planned ?? 0,
                    start: 0,
                    end: 0,
                    fixed: false,
                    kind: 'study',
                  })
                }
              >
                {row.reported ? '記録を確認・追加' : '進捗を記録'}
              </button>
            )}
        </section>
      ))}
      {!quantity.rows.length && <p>予定なし</p>}
    </div>
  );
}
