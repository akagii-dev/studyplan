import { Meals } from './components/Meals';
import { DailyTime } from './components/DailyTime';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  BookOpen,
  DatabaseBackup,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  FileText,
  GraduationCap,
  History as HistoryIcon,
  LayoutDashboard,
  Leaf,
  ListChecks,
  RefreshCw,
  Settings2,
} from 'lucide-react';
import { AppState, Session, addDays, completed, remaining, today, weekday } from './domain/model';
import { propose, datesBetween, capacityForDate } from './domain/planner';
import { sameSettings, stalePlan, dateTime } from './domain/planAudit';
import { NumericDraftProvider } from './components/NumberInput';
import { loadState, saveState, exportBackup, restoreBackup } from './store';
const Backup = lazy(() =>
  import('./components/Backup').then((module) => ({ default: module.Backup })),
);
import { useCloseAfterSave } from './useCloseAfterSave';
import { Availability, Buffer, Exams, Focus, Materials } from './components/Setup';
import { GuidedSetup, beginAddition, Addition } from './components/GuidedSetup';
import { RegistrationStatus } from './components/RegistrationStatus';
import { Calendar } from './components/Calendar';
import { Progress, History } from './components/Progress';
import { Replan } from './components/Replan';
import { Props, duration } from './components/common';
import { requirePlanningInputs } from './domain/setupIssues';
import { SetupImpact } from './components/SetupImpact';
import { Tutorial } from './components/Tutorial';
import { Startup } from './components/Startup';
import { SaveRecovery } from './components/SaveRecovery';
import { WeeklyReport } from './components/WeeklyReport';
import { version } from '../package.json';
type Page =
  | 'today'
  | 'dashboard'
  | 'setup'
  | 'addExam'
  | 'addMaterial'
  | 'exams'
  | 'materials'
  | 'availability'
  | 'focus'
  | 'calendar'
  | 'progress'
  | 'history'
  | 'report'
  | 'backup'
  | 'tutorial'
  | 'replan';
const navigation = [
  { id: 'dashboard', name: 'ホーム', icon: LayoutDashboard },
  { id: 'today', name: '今日のスケジュール', icon: CalendarDays },
  { id: 'calendar', name: '学習カレンダー', icon: CalendarDays },
  { id: 'progress', name: '進捗を記録', icon: CheckCircle2 },
  { id: 'history', name: '記録履歴', icon: HistoryIcon },
  { id: 'report', name: '週間レポート', icon: FileText },
  { id: 'replan', name: '再計画の確認', icon: RefreshCw },
  { id: 'exams', name: '試験・目標', icon: GraduationCap },
  { id: 'materials', name: '教材・進捗', icon: BookOpen },
  { id: 'availability', name: '時間枠・時間割', icon: CalendarDays },
  { id: 'focus', name: '連続時間・余裕率', icon: Settings2 },
  { id: 'setup', name: '対話式の初期設定', icon: ListChecks },
  { id: 'backup', name: 'バックアップ', icon: DatabaseBackup },
  { id: 'tutorial', name: 'チュートリアル', icon: CircleHelp },
] as const;
export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const dataRef = useRef<AppState | null>(null);
  const revision = useRef(0);
  const saveGeneration = useRef(0);
  const queue = useRef(Promise.resolve());
  const pendingSaves = useRef(0);
  const [page, setPage] = useState<Page>('dashboard');
  const pageHeading = useRef<HTMLHeadingElement>(null);
  const ready = state !== null;
  const [error, setError] = useState('');
  const [startupError, setStartupError] = useState('');
  const [loading, setLoading] = useState(true);
  const loadRequest = useRef<Promise<void> | null>(null);
  const mounted = useRef(false);
  const [saving, setSaving] = useState(0);
  const [saved, setSaved] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const exclusive = useRef(false);
  const unconfirmed = useRef(false);
  const recoveryRequest = useRef<Promise<void> | null>(null);
  const [recovery, setRecovery] = useState<{ checking: boolean; detail: string } | null>(null);
  const { closing, closeWithoutSaving } = useCloseAfterSave(
    queue,
    pendingSaves,
    saveGeneration,
    unconfirmed,
    setError,
  );
  useEffect(() => {
    document.documentElement.dataset.theme = state?.theme ?? 'mint';
  }, [state?.theme]);
  useLayoutEffect(() => {
    if (!ready) return;
    // Only navigation/loading moves focus; background saves must not interrupt typing.
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    pageHeading.current?.focus({ preventScroll: true });
  }, [page, ready]);
  const initialize = useCallback(() => {
    if (loadRequest.current) return;
    setLoading(true);
    loadRequest.current = loadState()
      .then((e) => {
        if (!mounted.current) return;
        dataRef.current = e.data;
        revision.current = e.revision;
        setState(e.data);
        setSaved(e.revision > 0);
        setStartupError('');
      })
      .catch((e) => {
        if (mounted.current) setStartupError(String(e));
      })
      .finally(() => {
        loadRequest.current = null;
        if (mounted.current) setLoading(false);
      });
  }, []);
  useEffect(() => {
    mounted.current = true;
    initialize();
    return () => {
      mounted.current = false;
    };
  }, [initialize]);
  const readSavedState = () => {
    if (recoveryRequest.current) return recoveryRequest.current;
    setRecovery({ checking: true, detail: '' });
    const request = loadState()
      .then((stored) => {
        revision.current = stored.revision;
        dataRef.current = stored.data;
        setState(stored.data);
        setSaved(stored.revision > 0);
        unconfirmed.current = false;
        setRecovery(null);
        setError(
          '保存済みの内容を読み直しました。最後の変更を確認し、反映されていない場合は入力し直してください。',
        );
      })
      .catch((error) => setRecovery({ checking: false, detail: String(error) }))
      .finally(() => {
        recoveryRequest.current = null;
      });
    recoveryRequest.current = request;
    return request;
  };
  const update: Props['update'] = (fn) => {
    if (unconfirmed.current)
      return Promise.reject(new Error('保存状態を確認できるまで編集できません。'));
    if (exclusive.current) return Promise.reject(new Error('復元が終わるまでお待ちください。'));
    let next: AppState;
    try {
      next = fn(dataRef.current!);
      if (!sameSettings(dataRef.current!.settings, next.settings)) {
        next = {
          ...next,
          settingsUpdatedAt:
            next.settingsUpdatedAt !== dataRef.current!.settingsUpdatedAt
              ? next.settingsUpdatedAt
              : new Date().toISOString(),
          proposal: null,
        };
      }
    } catch (e) {
      setError(String(e));
      return Promise.reject(e);
    }
    dataRef.current = next;
    setState(next);
    pendingSaves.current += 1;
    setSaving((n) => n + 1);
    const generation = saveGeneration.current;
    const task = queue.current
      .then(async () => {
        if (generation !== saveGeneration.current)
          throw new Error(
            '直前の保存に失敗したため、続く変更は保存していません。再入力してください。',
          );
        const result = await saveState(next, revision.current);
        revision.current = result.revision;
        setSaved(true);
      })
      .catch(async (e) => {
        if (generation !== saveGeneration.current) throw e;
        saveGeneration.current += 1;
        unconfirmed.current = true;
        setError(String(e));
        await readSavedState();
        throw e;
      })
      .finally(() => {
        pendingSaves.current -= 1;
        setSaving((n) => n - 1);
      });
    queue.current = task.catch(() => {});
    return task;
  };
  const restore = async (text?: string) => {
    if (unconfirmed.current) throw new Error('保存状態を確認できるまで復元できません。');
    if (exclusive.current) throw new Error('復元が進行中です。');
    exclusive.current = true;
    setRestoring(true);
    pendingSaves.current += 1;
    setSaving((n) => n + 1);
    const generation = saveGeneration.current;
    const task = queue.current
      .then(async () => {
        if (generation !== saveGeneration.current)
          throw new Error('直前の保存に失敗したため復元を中止しました。');
        const result = await restoreBackup(revision.current, text);
        revision.current = result.revision;
        dataRef.current = result.data;
        setState(result.data);
        setSaved(true);
        setError('');
      })
      .catch(async (e) => {
        saveGeneration.current += 1;
        unconfirmed.current = true;
        setError(String(e));
        await readSavedState();
        throw e;
      })
      .finally(() => {
        exclusive.current = false;
        setRestoring(false);
        pendingSaves.current -= 1;
        setSaving((n) => n - 1);
      });
    queue.current = task.catch(() => {});
    return task;
  };
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
    if (kind === 'exams') addItem('addExam');
    else if (kind === 'materials') addItem('addMaterial');
    else setPage('availability');
  };
  if (!state) return <Startup error={startupError} loading={loading} retry={initialize} />;
  const props = { state, update };
  const active = navigation.find((n) => n.id === page) ?? {
    name: page === 'addExam' ? '試験を追加' : '教材を追加',
  };
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
      <div className="app-shell" inert={closing || restoring || !!recovery || undefined}>
        <aside className="sidebar">
          <a
            className="brand"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setPage('dashboard');
            }}
          >
            <div>
              <Leaf size={24} />
            </div>
            <span>
              StudyPlan<small>学びの計画室</small>
            </span>
          </a>
          <div className="workspace-label">MY STUDY SPACE</div>
          <nav>
            {navigation.map((n) => (
              <button
                key={n.id}
                className={`${page === n.id ? 'active' : ''} ${n.id === 'exams' ? 'nav-divider' : ''}`}
                aria-current={page === n.id ? 'page' : undefined}
                onClick={() => setPage(n.id)}
              >
                <n.icon size={18} />
                {n.name}
                {n.id === 'replan' && state.proposal && <span className="nav-dot" />}
              </button>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <label className="theme-picker">
              カラーテーマ
              <select
                aria-label="カラーテーマ"
                value={state.theme ?? 'mint'}
                onChange={(e) =>
                  void update((s) => ({ ...s, theme: e.target.value as AppState['theme'] }))
                }
              >
                <option value="mint">ミントグリーン</option>
                <option value="sky">ペールブルー</option>
                <option value="lime">ライム</option>
              </select>
            </label>
            <div className="local-indicator">
              <span />
              この端末に保存
            </div>
            <small>StudyPlan v{version}</small>
            <p>
              あなたのペースで、
              <br />
              目標までの道のりを。
            </p>
          </div>
        </aside>
        <main>
          <header className="topbar">
            <div>
              マイワークスペース <ChevronRight size={13} /> <strong>{active.name}</strong>
            </div>
            <span className={`save-status ${saving ? 'pending' : ''}`} role="status">
              {recovery
                ? '保存未確認'
                : saving
                  ? '保存中…'
                  : saved
                    ? '✓ 保存済み'
                    : '○ まだ保存されていません'}
            </span>
          </header>
          <div className="main-content">
            <div className="page-heading">
              <div>
                <div className="eyebrow">
                  {page === 'dashboard' ? 'MAKE ROOM FOR LEARNING' : 'YOUR STUDY PLAN'}
                </div>
                <h1 ref={pageHeading} tabIndex={-1}>
                  {page === 'dashboard' ? '学びを、日々の暮らしに。' : active.name}
                </h1>
                {page === 'dashboard' && <p>目標は大きく、一歩は自分のペースで。</p>}
              </div>
              <span className="today-label">
                {today().replaceAll('-', ' / ')}（
                {['日', '月', '火', '水', '木', '金', '土'][weekday(today())]}）
              </span>
            </div>
            {error && (
              <div className="error-banner" role="alert">
                <span>{error}</span>
                <button onClick={() => setError('')}>閉じる</button>
              </div>
            )}
            {typeof state.draft.replanError === 'string' && state.draft.replanError && (
              <div className="warning" role="status">
                {state.draft.replanError}
              </div>
            )}
            {page === 'dashboard' && state.plan && (
              <SetupImpact settings={state.settings} onConfigure={() => setPage('availability')} />
            )}
            {['dashboard', 'today', 'calendar', 'replan'].includes(page) &&
              stalePlan(state.plan, state.settings) && (
                <div className="warning" role="status">
                  <b>保存済みの計画と現在の設定が一致していません。</b>
                  <p>
                    設定や計算方式の変更は、新しい案を承認すると反映されます。現在の設定の最終更新：
                    {dateTime(state.settingsUpdatedAt)}
                  </p>
                  {page !== 'replan' && (
                    <button onClick={generate}>現在の設定で計画案を作成</button>
                  )}
                </div>
              )}
            <NumericDraftProvider state={state} update={update} scope={numericScope}>
              {page === 'dashboard' && (
                <Dashboard {...props} navigate={setPage} generate={generate} onAdd={addItem} />
              )}{' '}
              {page === 'setup' && <GuidedSetup {...props} onGenerate={generate} />}{' '}
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
              {page === 'materials' && (
                <Materials {...props} onAdd={() => addItem('addMaterial')} />
              )}{' '}
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
              {page === 'progress' && <Progress {...props} />}{' '}
              {page === 'history' && <History {...props} />}{' '}
              {page === 'report' && (
                <WeeklyReport
                  state={state}
                  saving={saving > 0}
                  readSaved={async () => {
                    await queue.current;
                    if (unconfirmed.current)
                      throw new Error('保存状態を確認してから書き出してください。');
                    return (await loadState()).data;
                  }}
                />
              )}
              {page === 'tutorial' && <Tutorial navigate={setPage} />}
              {page === 'backup' && (
                <Suspense fallback={<p>読み込んでいます…</p>}>
                  <Backup
                    state={state}
                    saving={saving > 0}
                    saved={saved}
                    onRestore={restore}
                    onExport={async (path) => {
                      await queue.current;
                      await exportBackup(path);
                    }}
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
          </div>
        </main>
      </div>
    </>
  );
}
function Dashboard({
  state,
  navigate,
  generate,
  onAdd,
}: Props & { navigate: (p: Page) => void; generate: () => void; onAdd: (mode: Addition) => void }) {
  const s = state.settings;
  const done = s.materials.reduce(
    (n, m) => n + m.rounds.reduce((a, _, i) => a + completed(state, m.id, i), 0),
    0,
  );
  const total = s.materials.reduce((n, m) => n + m.total * m.rounds.length, 0);
  const required = s.materials.reduce(
    (n, m) => n + m.rounds.reduce((a, r, i) => a + remaining(state, m.id, i) * r.minutes, 0),
    0,
  );
  const week = addDays(today(), -((weekday(today()) + 6) % 7));
  const caps = (() => {
    try {
      return datesBetween(week, addDays(week, 6)).map((d) => capacityForDate(s, d));
    } catch {
      return null;
    }
  })();
  return (
    <>
      <div className="hero">
        <div>
          <span className="pill">
            <Leaf size={14} /> CONTINUE AT YOUR OWN PACE
          </span>
          <h2>
            {s.exams.length ? '目標までの道のりを、少しずつ。' : 'あなたに合う計画を、ここから。'}
          </h2>
          <p>
            {s.exams.length
              ? '今日の学習と、これからの余裕を確かめましょう。'
              : '試験、使う教材、勉強できる時間。質問に答えるだけで、無理のない計画を組み立てます。'}
          </p>
          <button className="primary" onClick={() => navigate(state.plan ? 'progress' : 'setup')}>
            {state.plan ? '今日の進捗を記録' : '質問に答えて計画をつくる'}
            <ChevronRight size={17} />
          </button>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="orbit" />
          <BookOpen size={70} strokeWidth={1} />
          <span className="art-star one">✧</span>
          <span className="art-star two">✦</span>
          <span className="art-caption">ONE STEP AT A TIME</span>
        </div>
      </div>
      <div className="actions addition-actions">
        <button onClick={() => onAdd('addExam')}>
          <GraduationCap size={17} />
          試験を追加
        </button>
        <button onClick={() => onAdd('addMaterial')}>
          <BookOpen size={17} />
          教材を追加
        </button>
      </div>
      <div className="metrics">
        <div className="metric-card">
          <span>
            <GraduationCap size={17} />
            目指している試験
          </span>
          <strong>
            {s.exams.length}
            <small>つ</small>
          </strong>
          <p>一つの計画で、まとめて管理</p>
        </div>
        <div className="metric-card">
          <span>
            <CheckCircle2 size={17} />
            教材全体の進捗
          </span>
          <strong>
            {total ? Math.round((done / total) * 100) : 0}
            <small>%</small>
          </strong>
          <p>
            {done} / {total}問 完了
          </p>
          <progress aria-label="教材全体の進捗" max={total || 1} value={done} />
        </div>
        <div className="metric-card">
          <span>
            <BookOpen size={17} />
            残りの必要学習量
          </span>
          <strong className="smaller">{duration(required)}</strong>
          <p>周回ごとの残数 × 推定時間</p>
        </div>
      </div>
      <DailyTime settings={s} date={today()} />
      <div className="dashboard-grid">
        <section className="card">
          <div className="row">
            <h2>学習中の目標</h2>
            <button className="text-button" onClick={() => navigate('exams')}>
              目標を編集
              <ChevronRight size={14} />
            </button>
          </div>
          {!s.exams.length ? (
            <div className="empty">
              <GraduationCap size={28} />
              <h3>最初の目標を決めましょう</h3>
              <p>複数の試験も、あとから追加できます。</p>
            </div>
          ) : (
            s.exams.map((e) => {
              const ms = s.materials.filter((m) => m.examId === e.id);
              const t = ms.reduce((n, m) => n + m.total * m.rounds.length, 0);
              const d = ms.reduce(
                (n, m) => n + m.rounds.reduce((a, _, i) => a + completed(state, m.id, i), 0),
                0,
              );
              return (
                <div className="goal-row" key={e.id}>
                  <i style={{ background: e.color }} />
                  <div>
                    <div className="row">
                      <h3>{e.name}</h3>
                      <b>{t ? Math.round((d / t) * 100) : 0}%</b>
                    </div>
                    <p>
                      目標 {e.target} · 教材 {ms.length}冊
                    </p>
                    <progress
                      aria-label={`${e.name}の進捗`}
                      style={{ accentColor: e.color }}
                      value={d}
                      max={t || 1}
                    />
                  </div>
                </div>
              );
            })
          )}
          <div className="actions">
            <button onClick={() => navigate('calendar')}>
              カレンダーを見る
              <ChevronRight size={15} />
            </button>
            {s.exams.length > 0 && <button onClick={generate}>計画案を作成</button>}
          </div>
        </section>
        <section className="card week-summary">
          <div className="eyebrow">THIS WEEK</div>
          <h2>今週の学習時間</h2>
          <p>
            {week}〜{addDays(week, 6)}
          </p>
          {(['free', 'focus'] as const).map((k, i) => (
            <div className="capacity-row" key={k}>
              <span>{['① 空き枠', '② 学習可能量', '③ 計画割当可能量'][i]}</span>
              <b>{caps ? duration(caps.reduce((n, c) => n + c[k], 0)) : '設定を確認'}</b>
            </div>
          ))}
          <small>現在の設定から算出・授業と予定を除外済み</small>
        </section>
      </div>
      {state.plan?.shortfalls.length ? (
        <div className="warning">
          <b>
            未配置の課題があります：{state.plan.shortfalls.reduce((n, x) => n + x.count, 0)}問 /{' '}
            {duration(state.plan.shortfalls.reduce((n, x) => n + x.minutes, 0))}
          </b>
          <p>目標日や時間枠を見直し、再計画画面で不足を確認してください。</p>
        </div>
      ) : null}
      <div className="help-line">
        <CircleHelp size={16} />
        <span>計画はいつでも見直せます。進捗を記録すると、残りの学習を組み直す案が届きます。</span>
      </div>
    </>
  );
}
