import { QuantityRow, QuantityTotal } from './calendarQuantity';

/** Presentation only. Never turns a missing report into a saved zero or offsets tasks. */
export function progressState(
  value: Pick<QuantityRow, 'planned' | 'actual' | 'reported' | 'unit'> &
    Partial<Pick<QuantityTotal, 'shortage' | 'partial' | 'currentRemaining' | 'restartPlanned'>>,
  date: string,
  reference: string,
) {
  const { planned, actual, reported: hasReport, unit } = value;
  const future = date > reference;
  const past = date < reference;
  const restartPlanned = past ? value.restartPlanned : undefined;
  const comparisonAvailable = planned !== null && restartPlanned === undefined;
  const currentRemaining = date === reference ? value.currentRemaining : undefined;
  const deficit =
    past && hasReport && comparisonAvailable
      ? (value.shortage ?? Math.max(0, planned - actual))
      : null;
  const partial = value.partial ?? !hasReport;
  const progressRatio =
    currentRemaining === undefined && restartPlanned === undefined && planned !== null && planned > 0 ? actual / planned : null;
  return {
    planned,
    actual,
    hasReport,
    deficit,
    progressRatio,
    comparisonAvailable,
    period: future ? ('future' as const) : past ? ('past' as const) : ('today' as const),
    reportStatus: future
      ? ('scheduled' as const)
      : !hasReport
        ? ('unreported' as const)
        : partial
          ? ('partial' as const)
          : ('reported' as const),
    warning: past && (!hasReport || partial || (deficit ?? 0) > 0),
    prefill: restartPlanned === undefined ? currentRemaining ?? (planned === null ? 0 : Math.max(0, planned - actual)) : 0,
    ...(currentRemaining === undefined ? {} : { currentRemaining }),
    ...(restartPlanned === undefined ? {} : { restartPlanned }),
    unit,
  };
}

export function progressView(
  value: Parameters<typeof progressState>[0],
  date: string,
  reference: string,
) {
  const state = progressState(value, date, reference);
  const { planned, actual, hasReport, deficit, unit } = state;
  const future = state.period === 'future';
  const text =
    state.restartPlanned !== undefined
      ? `予定 ${state.restartPlanned}${unit} · ${hasReport ? `実績 ${actual}${unit}` : '未報告'}`
      : state.currentRemaining !== undefined
      ? `${hasReport ? `実績 ${actual}${unit}` : '未報告'} · 今日の残り ${state.currentRemaining}${unit}`
      : future
        ? planned === null
          ? '予定なし'
          : `${planned}${unit}`
        : !hasReport
          ? planned === null
            ? '未報告'
            : `未報告 / ${planned}${unit}`
          : planned === null
            ? `${actual}${unit}`
            : `${actual}/${planned}${unit}`;
  return {
    ...state,
    text,
    supplement: [
      state.reportStatus === 'partial' ? '未報告あり' : '',
      (deficit ?? 0) > 0 ? `${deficit}${unit}不足` : '',
    ]
      .filter(Boolean)
      .join(' · '),
  };
}
