import type { AppState, Settings } from './model';
import { minimumRetainedRounds } from './revision';

export const MAX_MINUTES_PER_UNIT = 1440;

/** Validate committed changes against the latest state, including stale editor drafts. */
export function validateMaterialChanges(
  state: AppState,
  settings: Settings,
  date: string,
  minute: number,
) {
  for (const material of settings.materials) {
    if (
      state.settings.materials.some((m) => m.id === material.id) &&
      material.rounds.length < minimumRetainedRounds(state, material.id, date, minute)
    )
      throw new Error(
        `${material.name}：初期完了・記録・開始済み予定・固定予定のある周回は減らせません。`,
      );
    material.rounds.forEach((round, index) => {
      if (
        !Number.isFinite(round.minutes) ||
        round.minutes <= 0 ||
        round.minutes > MAX_MINUTES_PER_UNIT
      )
        throw new Error(
          `${material.name}・${index + 1}周目：1問あたりの分数は0より大きく${MAX_MINUTES_PER_UNIT}分以下にしてください。`,
        );
    });
  }
}
