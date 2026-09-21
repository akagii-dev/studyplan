import { Suspense, lazy, useState } from 'react';
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
import { SetupImpact } from '../components/SetupImpact';
import { Startup } from '../components/Startup';
import { Tutorial } from '../components/Tutorial';
import { Warning, WarningSettings, WarningsProvider } from '../components/Warnings';
import { WeeklyReport } from '../components/WeeklyReport';
import { Session, today } from '../domain/model';
import { dateTime, stalePlan } from '../domain/planAudit';
import { propose } from '../domain/planning';
import { requirePlanningInputs } from '../domain/setupIssues';
import { usePersistentAppState } from '../hooks/usePersistentAppState';
import { AppShell } from './AppShell';
import { Dashboard } from './Dashboard';
import { Page } from './navigation';
const Backup = lazy(() =>
  import('../components/Backup').then((module) => ({ default: module.Backup })),
);
export default function App() {
  const [page, setPage] = useState<Page>('dashboard');
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
  const onRecord = (session: Session) => {
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
          {page === 'dashboard' && state.plan && (
            <SetupImpact
              settings={state.settings}
              onConfigure={() => setPage('availability')}
              onConfigureStudy={() => setPage('replan')}
            />
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
              <Dashboard {...props} navigate={setPage} generate={generate} onAdd={addItem} />
            )}{' '}
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
                <Availability {...props} />
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
                onRecord={onRecord}
                onReplan={() => setPage('replan')}
              />
            )}
            {page === 'calendar' && (
              <Calendar {...props} onRecord={onRecord} onReplan={() => setPage('replan')} />
            )}{' '}
            {page === 'commute' && (
              <CommuteSettings {...props} onReview={() => setPage('replan')} />
            )}
            {page === 'warnings' && <WarningSettings {...props} />}
            {page === 'progress' && <Progress {...props} />}{' '}
            {page === 'history' && <History {...props} />}{' '}
            {page === 'report' && (
              <WeeklyReport state={state} saving={saving > 0} readSaved={readSaved} />
            )}
            {page === 'tutorial' && <Tutorial navigate={setPage} />}
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
