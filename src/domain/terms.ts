import { AppState, Material, Settings, remaining } from './model';

export interface WorkRef {
  materialId: string;
  round: number;
}
export interface TermItem {
  material: Material;
  round: number;
  left: number;
}
export interface StudyTerm {
  index: number;
  items: TermItem[];
}

/** A positive integer enables terms. Omitted keeps the original per-exam order. */
export function parallelMaterialLimit(settings: Pick<Settings, 'parallelMaterials'>) {
  const limit = settings.parallelMaterials;
  return Number.isInteger(limit) && limit! >= 1 ? limit! : undefined;
}

/** Materials by their configured order, then the order shown in settings. */
function termGroups(settings: Settings, limit: number) {
  const sorted = settings.materials
    .map((material, index) => ({ material, index }))
    .sort((a, b) => a.material.order - b.material.order || a.index - b.index)
    .map(({ material }) => material);
  const groups: Material[][] = [];
  for (let i = 0; i < sorted.length; i += limit) groups.push(sorted.slice(i, i + limit));
  return groups;
}

/** Material groups of one round cycle, for settings preview. Empty when terms are off. */
export function materialTermGroups(settings: Settings) {
  const limit = parallelMaterialLimit(settings);
  return limit ? termGroups(settings, limit) : [];
}

/**
 * Term number of each material round. Rounds are term-major:
 * group 1 round 1, group 2 round 1, …, group 1 round 2, ….
 */
function termIndexes(settings: Settings) {
  const limit = parallelMaterialLimit(settings);
  if (!limit) return undefined;
  const groups = termGroups(settings, limit);
  const indexes = new Map<string, number>();
  groups.forEach((group, g) =>
    group.forEach((material) =>
      material.rounds.forEach((_, round) =>
        indexes.set(JSON.stringify([material.id, round]), round * groups.length + g),
      ),
    ),
  );
  return indexes;
}

/**
 * Shared precedence used by planning, adjustment and fixed-order checks.
 * With terms, every round of an earlier term precedes every round of a later term.
 * Without terms, the original rule applies within one exam.
 */
export function workPrecedence(settings: Settings) {
  const indexes = termIndexes(settings);
  const materials = new Map(settings.materials.map((material) => [material.id, material]));
  return (a: WorkRef, b: WorkRef) => {
    if (indexes) {
      const ta = indexes.get(JSON.stringify([a.materialId, a.round]));
      const tb = indexes.get(JSON.stringify([b.materialId, b.round]));
      return ta !== undefined && tb !== undefined && ta < tb;
    }
    const ma = materials.get(a.materialId);
    const mb = materials.get(b.materialId);
    return (
      !!ma &&
      !!mb &&
      ma.examId === mb.examId &&
      (ma.order < mb.order ||
        (ma.order === mb.order && (ma.id < mb.id || (ma.id === mb.id && a.round < b.round))))
    );
  };
}

/** Terms in order, with the remaining quantity of each material round from records. */
export function studyTerms(state: AppState): StudyTerm[] {
  const { settings } = state;
  const indexes = termIndexes(settings);
  if (!indexes) return [];
  const terms = new Map<number, TermItem[]>();
  for (const material of settings.materials)
    material.rounds.forEach((_, round) => {
      const index = indexes.get(JSON.stringify([material.id, round]))!;
      terms.set(index, [
        ...(terms.get(index) ?? []),
        { material, round, left: remaining(state, material.id, round) },
      ]);
    });
  return [...terms].sort(([a], [b]) => a - b).map(([index, items]) => ({ index, items }));
}

/** The first term with remaining work is current; the next unfinished term follows it. */
export function currentTerms(state: AppState) {
  const open = studyTerms(state).filter((term) => term.items.some((item) => item.left > 0));
  return { current: open[0], next: open[1] };
}

export const termItemLabel = (item: TermItem) =>
  item.material.rounds.length > 1
    ? `${item.material.name}（${item.round + 1}周目）`
    : item.material.name;
