import { AppState, Settings } from './model';
import { minimumRetainedRounds } from './revision';

export const MAX_ROUNDS = 20;

/**
 * Sets the number of rounds of several materials at once. Added rounds start uncompleted with
 * the first round's minutes, as in the single material form. All or nothing: when a material
 * cannot lose a round (initial completion, records, started or fixed sessions), nothing changes.
 */
export function setRoundCounts(
  state: AppState,
  materialIds: readonly string[],
  count: number,
  from?: string,
  notBefore?: number,
): Settings {
  if (!Number.isInteger(count) || count < 1 || count > MAX_ROUNDS)
    throw new Error(`周回数は1〜${MAX_ROUNDS}で指定してください。`);
  const ids = new Set(materialIds);
  const blocked = state.settings.materials.filter(
    (m) => ids.has(m.id) && count < minimumRetainedRounds(state, m.id, from, notBefore),
  );
  if (blocked.length)
    throw new Error(
      `${blocked.map((m) => m.name).join('、')}：初期完了・記録・開始済み予定・固定予定のある周回は減らせません。`,
    );
  return {
    ...state.settings,
    materials: state.settings.materials.map((m) =>
      ids.has(m.id) && m.rounds.length !== count
        ? {
            ...m,
            rounds: Array.from(
              { length: count },
              (_, i) => m.rounds[i] ?? { completed: 0, minutes: m.rounds[0].minutes },
            ),
          }
        : m,
    ),
  };
}
