import { AppState } from '../domain/model';
import { duration } from './common';
import { materialUnit } from '../domain/calendarQuantity';

/** Unplaced study; the week view shows it as a plain list above the days. */
export function ShortfallDetails({ state, onReview, inWeek = false }: { state: AppState; onReview?: () => void; inWeek?: boolean }) {
  const shortfalls = state.plan?.shortfalls ?? [];
  if (!shortfalls.length) return null;
  const minutes = shortfalls.reduce((sum, item) => sum + item.minutes, 0);
  return (
    <section className={`shortfall-summary mx-0 ${inWeek ? 'mt-3 mb-1' : 'mt-[18px] mb-0 border-t border-t-line pt-3.5'}`} aria-label="未配置の学習">
      <h2 className={`mx-0 mt-0 mb-2 font-semibold text-ink ${inWeek ? 'text-[1.125rem]' : 'text-[14px]'}`}>
        未配置 {shortfalls.length}件・{duration(minutes).replace(' ', '')}
      </h2>
      <ul className={`mx-0 mt-0 list-none p-0 ${inWeek ? 'mb-0' : 'mb-3.5'}`}>
        {shortfalls.map((item) => (
          <li className={inWeek ? 'py-1' : 'border-b border-b-line py-[7px]'} key={`${item.materialId}/${item.round}`}>
            <div className="flex items-baseline justify-between gap-2.5">
              <span className={`wrap-anywhere ${inWeek ? 'min-w-0' : ''}`}>
                {state.settings.materials.find((material) => material.id === item.materialId)
                  ?.name ?? item.materialId}{' '}
                · {item.round + 1}周目
              </span>
              <strong className="whitespace-nowrap">{item.count}{materialUnit(state.settings.materials.find((material) => material.id === item.materialId)?.unit)}</strong>
            </div>
            <details className="mt-[3px]">
              <summary className={inWeek ? 'w-fit min-w-[44px]' : undefined}>理由</summary>
              <p className="mx-0 mt-1 mb-0">{item.reason}</p>
            </details>
          </li>
        ))}
      </ul>
      {onReview && <button onClick={onReview}>予定を確認</button>}
    </section>
  );
}
