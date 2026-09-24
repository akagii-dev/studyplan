import { AppState, Session, today } from '../domain/model';
import { calendarQuantity, QuantityTotal } from '../domain/calendarQuantity';

function Amounts({
  total,
  past,
  future,
}: {
  total: QuantityTotal;
  past: boolean;
  future: boolean;
}) {
  return (
    <dl className="calendar-amounts">
      <div>
        <dt>予定</dt>
        <dd>
          {total.planned === null ? (
            '基準なし'
          ) : (
            <>
              {total.planned}
              <span>{total.unit}</span>
            </>
          )}
        </dd>
      </div>
      <div>
        <dt>実績</dt>
        <dd>
          {total.actual}
          <span>{total.unit}</span>
        </dd>
      </div>
      <div>
        <dt>{past ? 'その日の不足' : future ? '未実施' : '残り'}</dt>
        <dd>
          {total.remainder === null ? (
            '基準なし'
          ) : (
            <>
              {total.remainder}
              <span>{total.unit}</span>
            </>
          )}
        </dd>
      </div>
    </dl>
  );
}
export function CalendarQuantity({
  state,
  date,
  filter,
  onSelect,
}: {
  state: AppState;
  date: string;
  filter: string;
  onSelect: () => void;
}) {
  const quantity = calendarQuantity(state, date, today(), filter);
  return (
    <div className="calendar-quantity">
      {quantity.totals.map((total) => (
        <Amounts key={total.unit} total={total} past={quantity.past} future={date > today()} />
      ))}
      {!quantity.totals.length && (
        <Amounts
          total={{
            unit: '問',
            planned: quantity.known ? 0 : null,
            actual: 0,
            remainder: quantity.known ? 0 : null,
            reported: false,
            partial: false,
          }}
          past={quantity.past}
          future={date > today()}
        />
      )}
      {quantity.rows.length > 0 && (
        <button className="text-button" aria-label={`${date}の学習量の内訳`} onClick={onSelect}>
          内訳
        </button>
      )}
    </div>
  );
}

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
  const quantity = calendarQuantity(state, date, today(), filter);
  return (
    <div className="quantity-breakdown">
      {quantity.rows.map((row) => (
        <section key={JSON.stringify([row.materialId, row.round, row.unit])}>
          <h4>
            {row.name} · {row.round + 1}周目
          </h4>
          <Amounts
            total={{
              unit: row.unit,
              planned: row.planned,
              actual: row.actual,
              reported: row.reported,
              remainder: row.remainder,
              partial: false,
            }}
            past={quantity.past}
            future={date > today()}
          />
          {date <= today() &&
            state.settings.materials.some(
              (m) => m.id === row.materialId && m.rounds[row.round],
            ) && (
              <button
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
      {!quantity.rows.length && (
        <p>{quantity.known ? '予定 0問・実績 0問' : '予定 基準なし・実績 0問'}</p>
      )}
      {quantity.past && quantity.rows.length > 0 && (
        <p className="hint">その日の不足は現在の残量とは別です。</p>
      )}
    </div>
  );
}
