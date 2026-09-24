import { QuantityRow, QuantityTotal } from './calendarQuantity';

/** Presentation only. Never turns a missing report into a saved zero or offsets tasks. */
export function progressState(
  value: Pick<QuantityRow, 'planned' | 'actual' | 'reported' | 'unit'> &
    Partial<Pick<QuantityTotal, 'shortage' | 'partial'>>,
  date: string,
  reference: string,
) {
  const { planned, actual, reported: hasReport, unit } = value;
  const comparisonAvailable = planned !== null;
  const future = date > reference;
  const past = date < reference;
  const deficit =
    past && hasReport && comparisonAvailable
      ? (value.shortage ?? Math.max(0, planned - actual))
      : null;
  const partial = value.partial ?? !hasReport;
  const progressRatio = planned !== null && planned > 0 ? actual / planned : null;
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
    prefill: planned === null ? 0 : Math.max(0, planned - actual),
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
  const text = future
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
