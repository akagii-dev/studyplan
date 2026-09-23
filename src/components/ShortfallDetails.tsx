import { AppState } from '../domain/model';
import { duration } from './common';

export function ShortfallDetails({ state, onReview }: { state: AppState; onReview?: () => void }) {
  const shortfalls = state.plan?.shortfalls ?? [];
  if (!shortfalls.length) return null;
  const minutes = shortfalls.reduce((sum, item) => sum + item.minutes, 0);
  return (
    <section className="shortfall-summary" aria-label="未配置の学習">
      <h2>
        未配置 {shortfalls.length}件・{duration(minutes).replace(' ', '')}
      </h2>
      <ul>
        {shortfalls.map((item) => (
          <li key={`${item.materialId}/${item.round}`}>
            <div>
              <span>
                {state.settings.materials.find((material) => material.id === item.materialId)
                  ?.name ?? item.materialId}{' '}
                · {item.round + 1}周目
              </span>
              <strong>{item.count}問</strong>
            </div>
            <details>
              <summary>理由</summary>
              <p>{item.reason}</p>
            </details>
          </li>
        ))}
      </ul>
      {onReview && <button onClick={onReview}>予定を確認</button>}
    </section>
  );
}
