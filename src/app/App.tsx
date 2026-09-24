import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Calendar } from '../components/Calendar';
import { CommuteSettings } from '../components/CommuteSettings';
import { Addition, GuidedSetup, beginAddition } from '../components/guided-setup';
import { Meals } from '../components/Meals';
import { NumericDraftProvider } from '../components/NumberInput';
import { History, Progress } from '../components/Progress';
import { RegistrationStatus } from '../components/RegistrationStatus';
import { Replan } from '../components/Replan';
import { SaveRecovery } from '../components/SaveRecovery';
import { Availability, Buffer, Exams, Focus, Materials } from '../components/setup';
import { Startup } from '../components/Startup';
import { Tutorial } from '../components/Tutorial';
import { Warning, WarningSettings, WarningsProvider } from '../components/Warnings';
import { WeeklyReport } from '../components/WeeklyReport';
import { CalendarView, Session, addDays, today } from '../domain/model';
import { dateTime, stalePlan } from '../domain/planAudit';
import { propose } from '../domain/planning';
import { currentProgressAdjustment } from '../domain/progressAdjustment';
import { requirePlanningInputs } from '../domain/setupIssues';
import { usePersistentAppState } from '../hooks/usePersistentAppState';
import { AppShell } from './AppShell';
import { Dashboard } from './Dashboard';
import { upcomingSunday } from '../domain/calendar';
import { Future } from './Future';
import { AvailabilityTarget, SettingsHub } from './SettingsHub';
import { Page, pageNames } from './navigation';
const Backup = lazy(() =>
  import('../components/Backup').then((module) => ({ default: module.Backup })),
);
const mainPages = new Set<Page>(['dashboard', 'future', 'history', 'settings']);
const directDetails = new Set<Page>(['calendar', 'report', 'tutorial', 'progress', 'replan', 'today']);
const directPage = (): Page => {
  const hash = window.location.hash.slice(1) as Page;
  return directDetails.has(hash) ? hash : 'dashboard';
};
const fallbackFor = (page: Page): Page =>
  page === 'calendar' || page === 'replan' ? 'future' :
    page === 'progress' ? 'history' : page === 'today' ? 'dashboard' : 'settings';
type ReturnPoint = { page: Page; top: number; focus: HTMLElement | null; focusKey?: string };
export default function App() {
  const [page, setPageState] = useState<Page>(directPage);
  const [restorePosition, setRestorePosition] = useState<(ReturnPoint & { key: number }) | null>(null);
  const [origin, setOrigin] = useState<ReturnPoint | null>(null);
  const originStack = useRef<ReturnPoint[]>([]);
  const [futureWeek, setFutureWeek] = useState(() => upcomingSunday(today()));
  const [calendarMode, setCalendarMode] = useState<'content' | 'quantity'>('content');
  const [calendarDate, setCalendarDate] = useState(today());
  const [calendarRevealDay, setCalendarRevealDay] = useState(false);
  const [calendarView, setCalendarView] = useState<CalendarView>('month');
  const [calendarFilter, setCalendarFilter] = useState('all');
  const [tutorialStep, setTutorialStep] = useState(0);
  const [reportDayOpen, setReportDayOpen] = useState(false);
  const [availabilityTarget, setAvailabilityTarget] = useState<AvailabilityTarget | null>(null);
  const setPage = (destination: Page, keepAvailability = false) => {
    if (destination === page) return;
    if (page === 'report') setReportDayOpen(false);
    if (destination === 'calendar' && page !== 'future') setCalendarRevealDay(false);
    if (mainPages.has(destination)) originStack.current = [];
    else {
      const focus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      originStack.current.push({ page, top: window.scrollY, focus,
        focusKey: focus?.dataset.returnFocus });
    }
    setOrigin(originStack.current.at(-1) ?? null);
    setRestorePosition(null);
    if (!keepAvailability) setAvailabilityTarget(null);
    setPageState(destination);
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${directDetails.has(destination) ? `#${destination}` : ''}`);
  };
  const goBack = () => {
    const previous = originStack.current.pop() ?? { page: fallbackFor(page), top: 0, focus: null };
    setOrigin(originStack.current.at(-1) ?? null);
    setAvailabilityTarget(null);
    setRestorePosition({ ...previous, key: Date.now() });
    setPageState(previous.page);
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${directDetails.has(previous.page) ? `#${previous.page}` : ''}`);
  };
  useEffect(() => {
    const onHashChange = () => {
      originStack.current = [];
      setOrigin(null);
      setRestorePosition(null);
      setPageState(directPage());
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  const [settingsInputTarget, setSettingsInputTarget] = useState<'addExam' | 'addMaterial' | 'exam' | 'material' | null>(null);
  useEffect(() => {
    if (!settingsInputTarget) return;
    const expectedPage = settingsInputTarget === 'exam' ? 'exams' :
      settingsInputTarget === 'material' ? 'materials' : settingsInputTarget;
    if (page !== expectedPage) return;
    const selector = settingsInputTarget === 'exam' || settingsInputTarget === 'material'
      ? `[data-settings-edit="${settingsInputTarget}"]`
      : '.guided-setup input:not([type="hidden"]), .guided-setup select';
    const target = document.querySelector<HTMLElement>(selector);
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: 'center' });
    setSettingsInputTarget(null);
  }, [page, settingsInputTarget]);
  const {
    state,
    update,
    error,
    setError,
    startupError,
    loading,
    initialize,
    saving,
    saved,
    restoring,
    recovery,
    closing,
    closeWithoutSaving,
    readSavedState,
    restore,
    readSaved,
    exportSaved,
  } = usePersistentAppState();
  const generate = () => {
    void update((s) => {
      requirePlanningInputs(s.settings);
      return propose(
        s,
        today(),
        s.plan
          ? '変更した設定をもとに、今後の課題を再配分します。'
          : '登録した目標・教材・時間枠から最初の統合計画を作成しました。',
      );
    })
      .then(() => setPage('replan'))
      .catch(() => {});
  };
  const reviewAdjustment = () => {
    if (state?.proposal) {
      setPage('replan');
      return;
    }
    void update((current) => propose(current, addDays(today(), 1), '実績を踏まえた今後の予定を確認します。'))
      .then(() => setPage('replan'))
      .catch(() => {});
  };
  const onRecord = (session: Pick<Session, 'date' | 'materialId' | 'round'>) => {
    void update((s) => ({
      ...s,
      draft: {
        ...s.draft,
        progress: {
          date: session.date,
          materialId: session.materialId,
          round: session.round,
          choice: '',
          custom: '',
        },
      },
    })).then(() => setPage('progress'));
  };
  const addItem = (mode: Addition, examId?: string) => {
    void update((s) => beginAddition(s, mode, examId))
      .then(() => setPage(mode))
      .catch(() => {});
  };
  const openAvailability = (target: AvailabilityTarget, itemId?: string) => {
    setAvailabilityTarget(target);
    if (target === 'meals' || itemId) {
      void update((current) => ({
        ...current,
        draft: {
          ...current.draft,
          ...(target === 'meals' ? { mealOpen: true } : {}),
          ...(itemId && target === 'exception'
            ? { exception: current.settings.exceptions.find((exception) => exception.id === itemId) }
            : itemId
              ? { window: current.settings.windows.find((window) => window.id === itemId) }
              : {}),
        },
      }))
        .then(() => setPage('availability', true))
        .catch(() => setAvailabilityTarget(null));
    } else setPage('availability', true);
  };
  const editSettingItem = (kind: 'exam' | 'material', id: string) => {
    setSettingsInputTarget(kind);
    void update((current) => {
      const item = kind === 'exam'
        ? current.settings.exams.find((exam) => exam.id === id)
        : current.settings.materials.find((material) => material.id === id);
      return item
        ? { ...current, draft: { ...current.draft, [kind]: item } }
        : current;
    })
      .then(() => setPage(kind === 'exam' ? 'exams' : 'materials'))
      .catch(() => {});
  };
  const configureRegistration = (kind: string) => {
    if (kind === 'commute') {
      setPage('commute');
      return;
    }
    if (kind === 'exams') addItem('addExam');
    else if (kind === 'materials') addItem('addMaterial');
    else setPage('availability');
  };
  if (!state) return <Startup error={startupError} loading={loading} retry={initialize} />;
  const props = { state, update };
  const guided = state.draft[page === 'setup' ? 'guided' : page] as
    | { step?: string; roundIndex?: number; material?: { id: string }; exam?: { id: string } }
    | undefined;
  const numericScope = ['setup', 'addExam', 'addMaterial'].includes(page)
    ? `${page}/${guided?.step ?? 'exam.name'}/${guided?.roundIndex ?? 0}/${guided?.material?.id ?? ''}/${guided?.exam?.id ?? ''}`
    : `${page}/${(state.draft.material as { id?: string })?.id ?? ''}/${(state.draft.exam as { id?: string })?.id ?? ''}`;
  return (
    <>
      {recovery && !closing && !restoring && (
        <SaveRecovery
          {...recovery}
          retry={() => void readSavedState()}
          closeWithoutSaving={closeWithoutSaving}
        />
      )}
      {(closing || restoring) && (
        <div
          className="save-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={closing ? '保存して終了' : 'データの復元'}
        >
          <section className="card">
            <h2>{closing ? '保存してから終了します…' : 'データを復元しています…'}</h2>
          </section>
        </div>
      )}
      <WarningsProvider {...props}>
        <AppShell
          {...props}
          page={page}
          setPage={setPage}
          onBack={!mainPages.has(page) && !(page === 'report' && reportDayOpen) ? goBack : undefined}
          backLabel={origin ? pageNames[origin.page] : pageNames[fallbackFor(page)]}
          restorePosition={restorePosition?.page === page ? restorePosition : null}
          blocked={closing || restoring || !!recovery}
          recovering={!!recovery}
          saving={saving}
          saved={saved}
          error={error}
          dismissError={() => setError('')}
        >
          {typeof state.draft.replanError === 'string' && state.draft.replanError && (
            <Warning
              id="replan-error"
              title="再計画を確認してください"
              version={state.draft.replanError}
            >
              {state.draft.replanError}
            </Warning>
          )}
          {['dashboard', 'today', 'calendar', 'replan'].includes(page) &&
            stalePlan(state.plan, state.settings) && (
              <Warning
                id="stale-plan"
                title="保存済みの計画と現在の設定が一致していません。"
                version={[state.plan?.id, state.settings]}
              >
                <p>
                  設定や計算方式の変更は、新しい案を承認すると反映されます。現在の設定の最終更新：
                  {dateTime(state.settingsUpdatedAt)}
                </p>
                {page !== 'replan' && <button onClick={generate}>現在の設定で計画案を作成</button>}
              </Warning>
            )}
          <NumericDraftProvider state={state} update={update} scope={numericScope}>
            {page === 'dashboard' && (
              <Dashboard {...props} navigate={setPage} onReview={reviewAdjustment} />
            )}{' '}
            {page === 'future' && (
              <Future {...props} initialWeek={futureWeek} onWeekChange={setFutureWeek} onCalendar={(date, revealDay = !!date) => { setCalendarDate(date ?? today()); if (date) { setCalendarView('month'); setCalendarFilter('all'); } setCalendarRevealDay(revealDay); setPage('calendar'); }} onProposal={() => setPage('replan')} />
            )}
            {(page === 'settings' || originStack.current.some((entry) => entry.page === 'settings')) && (
              <div hidden={page !== 'settings'}>
                <SettingsHub
                {...props}
                navigate={(destination) =>
                  destination === 'availability' ? openAvailability('study') : setPage(destination)
                }
                addExam={() => {
                  setSettingsInputTarget('addExam');
                  addItem('addExam');
                }}
                addMaterial={() => {
                  setSettingsInputTarget('addMaterial');
                  addItem('addMaterial');
                }}
                editItem={editSettingItem}
                openAvailability={openAvailability}
                generate={generate}
                />
              </div>
            )}
            {page === 'setup' && (
              <GuidedSetup {...props} onGenerate={generate} onConfigure={configureRegistration} />
            )}{' '}
            {(page === 'exams' || page === 'materials') && (
              <RegistrationStatus
                state={state}
                onGenerate={generate}
                onReview={() => setPage('replan')}
                onConfigure={configureRegistration}
              />
            )}
            {page === 'exams' && (
              <Exams
                {...props}
                onAdd={() => addItem('addExam')}
                onAddMaterial={(id) => addItem('addMaterial', id)}
              />
            )}{' '}
            {page === 'materials' && <Materials {...props} onAdd={() => addItem('addMaterial')} />}{' '}
            {(page === 'addExam' || page === 'addMaterial') &&
              (page === 'addMaterial' && !state.settings.exams.length ? (
                <section className="card">
                  <h2>先に試験を追加しましょう</h2>
                  <button className="primary" onClick={() => addItem('addExam')}>
                    試験を追加
                  </button>
                </section>
              ) : (
                <GuidedSetup
                  key={page}
                  {...props}
                  mode={page}
                  onGenerate={generate}
                  onClose={() => setPage(page === 'addExam' ? 'exams' : 'materials')}
                  onAddMaterial={(id) => addItem('addMaterial', id)}
                  onReview={() => setPage('replan')}
                  onConfigure={configureRegistration}
                />
              ))}
            {page === 'availability' && (
              <>
                <Availability {...props} focusTarget={availabilityTarget} />
                <Meals {...props} />
              </>
            )}{' '}
            {page === 'focus' && (
              <>
                <Focus {...props} />
                <Buffer {...props} />
              </>
            )}{' '}
            {page === 'today' && (
              <Calendar
                {...props}
                todayOnly
                initialDate={today()}
                onRecord={onRecord}
                onReplan={() => setPage('replan')}
              />
            )}
            {page === 'calendar' && (
              <Calendar {...props} initialMode={calendarMode} onModeChange={setCalendarMode} initialDate={calendarDate} initialView={calendarView} onViewChange={setCalendarView} initialFilter={calendarFilter} onFilterChange={setCalendarFilter} revealDay={calendarRevealDay} onDetailChange={setCalendarRevealDay} onDateChange={setCalendarDate} onRecord={onRecord} onReplan={() => setPage('replan')} />
            )}{' '}
            {page === 'commute' && (
              <CommuteSettings {...props} onReview={() => setPage('replan')} />
            )}
            {page === 'warnings' && <WarningSettings {...props} />}
            {page === 'progress' && (
              <Progress
                {...props}
                onHistory={() => setPage('history')}
                onReplan={() => (currentProgressAdjustment(state)?.status === 'failed' ? setPage('future') : state.proposal ? setPage('replan') : generate())}
              />
            )}{' '}
            {page === 'history' && (
              <History
                {...props}
                onReplan={() => (currentProgressAdjustment(state)?.status === 'failed' ? setPage('future') : state.proposal ? setPage('replan') : generate())}
                onRecordPast={() => setPage('progress')}
              />
            )}{' '}
            {page === 'report' && (
              <WeeklyReport state={state} saving={saving > 0} readSaved={readSaved} onDetailChange={setReportDayOpen} />
            )}
            {page === 'tutorial' && <Tutorial navigate={setPage} step={tutorialStep} onStepChange={setTutorialStep} onClose={goBack} />}
            {page === 'backup' && (
              <Suspense fallback={<p>読み込んでいます…</p>}>
                <Backup
                  state={state}
                  saving={saving > 0}
                  saved={saved}
                  onRestore={restore}
                  onExport={exportSaved}
                />
              </Suspense>
            )}
            {page === 'replan' && <Replan {...props} onCalendar={() => setPage('calendar')} />}{' '}
            {['availability', 'focus'].includes(page) && (
              <div className="wizard-footer">
                <span>設定の変更は保存済みの計画を自動で書き換えません。</span>
                <button data-submit className="primary" onClick={generate}>
                  設定から計画案を作成
                </button>
              </div>
            )}
          </NumericDraftProvider>
        </AppShell>
      </WarningsProvider>
    </>
  );
}
