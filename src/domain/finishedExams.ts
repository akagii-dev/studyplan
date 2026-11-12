import { AppState, DateKey, Plan, Settings } from './model';

/**
 * Removes exams whose target date has passed, with everything that only exists for them:
 * materials, records, planned and historical sessions, and saved daily baselines. So the
 * calendar no longer shows them. Reward points already earned stay in the ledger.
 * Called at the load/date boundary only; returns the same state when nothing has finished.
 */
export function removeFinishedExams(state: AppState, date: DateKey): AppState {
  const examIds = new Set(state.settings.exams.filter((e) => e.target < date).map((e) => e.id));
  if (!examIds.size) return state;
  const materialIds = new Set(
    state.settings.materials.filter((m) => examIds.has(m.examId)).map((m) => m.id),
  );
  const settingsWithout = (settings: Settings): Settings => ({
    ...settings,
    exams: settings.exams.filter((e) => !examIds.has(e.id)),
    materials: settings.materials.filter((m) => !examIds.has(m.examId)),
  });
  /** Keys are JSON arrays; the material id sits at `index`. */
  const withoutMaterialKeys = <T>(items: Record<string, T>, index: number) =>
    Object.fromEntries(
      Object.entries(items).filter(([key]) => !materialIds.has((JSON.parse(key) as string[])[index])),
    );
  const planWithout = (plan: Plan): Plan => {
    const sessions = plan.sessions.filter(
      (s) => !examIds.has(s.examId) && !materialIds.has(s.materialId),
    );
    const kept = new Set(sessions.map((s) => s.id));
    const removed = new Set(plan.sessions.filter((s) => !kept.has(s.id)).map((s) => s.id));
    return {
      ...plan,
      sessions,
      shortfalls: plan.shortfalls.filter((s) => !materialIds.has(s.materialId)),
      ...(plan.settingsSnapshot ? { settingsSnapshot: settingsWithout(plan.settingsSnapshot) } : {}),
      ...(plan.dailyBalanceMaterialIds
        ? { dailyBalanceMaterialIds: plan.dailyBalanceMaterialIds.filter((id) => !materialIds.has(id)) }
        : {}),
      ...(plan.comparisonSessionIds
        ? { comparisonSessionIds: plan.comparisonSessionIds.filter((id) => !removed.has(id)) }
        : {}),
      ...(plan.progressBaseline
        ? {
            progressBaseline: {
              records: withoutMaterialKeys(plan.progressBaseline.records, 1),
              shortfalls: withoutMaterialKeys(plan.progressBaseline.shortfalls, 0),
              sessions: Object.fromEntries(
                Object.entries(plan.progressBaseline.sessions).filter(([id]) => !removed.has(id)),
              ),
            },
          }
        : {}),
      ...(plan.adjustmentBasis
        ? {
            adjustmentBasis: {
              ...plan.adjustmentBasis,
              records: withoutMaterialKeys(plan.adjustmentBasis.records, 1),
              sessions: plan.adjustmentBasis.sessions.filter(
                (s) => !examIds.has(s.examId) && !materialIds.has(s.materialId),
              ),
            },
          }
        : {}),
    };
  };
  const baselines = state.studyDayBaselines && Object.fromEntries(
    Object.entries(state.studyDayBaselines).map(([day, baseline]) => [
      day,
      { ...baseline, rows: baseline.rows.filter((row) => !examIds.has(row.examId) && !materialIds.has(row.materialId)) },
    ]),
  );
  const offsets = state.dayOffsets && Object.fromEntries(
    Object.entries(state.dayOffsets)
      .map(([day, rows]) => [day, rows.filter((row) => !materialIds.has(row.materialId))] as const)
      .filter(([, rows]) => rows.length),
  );
  const exam = state.draft.exam as { id?: string } | undefined;
  const material = state.draft.material as { id?: string } | undefined;
  const staleExam = !!exam?.id && examIds.has(exam.id);
  const staleMaterial = !!material?.id && materialIds.has(material.id);
  return {
    ...state,
    settings: settingsWithout(state.settings),
    records: state.records.filter((r) => !materialIds.has(r.materialId)),
    plan: state.plan && planWithout(state.plan),
    history: state.history.map(planWithout),
    // A pending proposal was calculated with the finished exam; it must be made again.
    proposal: null,
    ...(baselines ? { studyDayBaselines: baselines } : {}),
    ...(state.dayOffsets
      ? { dayOffsets: offsets && Object.keys(offsets).length ? offsets : undefined }
      : {}),
    // An open edit form of a removed item would add it back on save.
    draft: staleExam || staleMaterial
      ? {
          ...state.draft,
          ...(staleExam ? { exam: undefined } : {}),
          ...(staleMaterial ? { material: undefined } : {}),
        }
      : state.draft,
  };
}
