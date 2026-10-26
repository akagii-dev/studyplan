import { AppState, initialState } from './model';
export function resetSetup(state: AppState, all = false): AppState {
  if (!all)
    return {
      ...state,
      draft: {
        ...state.draft,
        guided: undefined,
        numberEdits: Object.fromEntries(
          Object.entries((state.draft.numberEdits ?? {}) as Record<string, unknown>).filter(
            ([key]) => !key.startsWith('setup/') && !key.startsWith('meals/'),
          ),
        ),
        'outside-sleep': undefined,
        'outside-bath': undefined,
        mealStep: 0,
        mealClock: undefined,
      },
      step: 0,
    };
  const backup = structuredClone(state);
  delete backup.resetBackup;
  return {
    ...initialState(),
    theme: state.theme,
    appearance: state.appearance,
    uiStyle: state.uiStyle,
    // The phone keeps its passcode across a reset, so the app must keep it too.
    screenTime: state.screenTime,
    sidebarCollapsed: state.sidebarCollapsed,
    windowSize: state.windowSize,
    calendarDensity: state.calendarDensity,
    settingsUpdatedAt: new Date().toISOString(),
    resetBackup: backup,
  };
}
export function restoreReset(state: AppState): AppState {
  if (!state.resetBackup) throw new Error('復元できる初期化前のデータがありません。');
  return structuredClone(state.resetBackup);
}
