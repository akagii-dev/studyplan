import { ChevronRight, Leaf } from 'lucide-react';
import { ReactNode, useLayoutEffect, useRef } from 'react';
import { version } from '../../package.json';
import { Props } from '../components/common';
import { AppState, today, weekday } from '../domain/model';
import { demoMode } from '../demo';
import { Page, navigation } from './navigation';
export function AppShell({
  state,
  update,
  page,
  setPage,
  blocked,
  recovering,
  saving,
  saved,
  error,
  dismissError,
  children,
}: Props & {
  page: Page;
  setPage: (page: Page) => void;
  blocked: boolean;
  recovering: boolean;
  saving: number;
  saved: boolean;
  error: string;
  dismissError: () => void;
  children: ReactNode;
}) {
  const pageHeading = useRef<HTMLHeadingElement>(null);
  const active = navigation.find((n) => n.id === page) ?? {
    name: page === 'addExam' ? '試験を追加' : '教材を追加',
  };
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = state?.theme ?? 'mint';
    const preference = state?.appearance ?? 'light';
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.appearance =
        preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute(
          'content',
          getComputedStyle(document.documentElement).getPropertyValue('--page').trim(),
        );
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [state?.theme, state?.appearance]);
  useLayoutEffect(() => {
    // Only navigation/loading moves focus; background saves must not interrupt typing.
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    pageHeading.current?.focus({ preventScroll: true });
  }, [page]);

  return (
    <div
      className={`app-shell ${state.sidebarCollapsed ? 'sidebar-collapsed' : ''}`}
      inert={blocked || undefined}
    >
      <button
        className="sidebar-toggle"
        aria-label={state.sidebarCollapsed ? 'サイドバーを開く' : 'サイドバーを折りたたむ'}
        title={state.sidebarCollapsed ? 'サイドバーを開く' : 'サイドバーを折りたたむ'}
        aria-controls="app-sidebar"
        aria-expanded={!state.sidebarCollapsed}
        onClick={() =>
          void update((s) => ({ ...s, sidebarCollapsed: !s.sidebarCollapsed })).catch(() => {})
        }
      >
        <span aria-hidden="true">{state.sidebarCollapsed ? '▶' : '◀'}</span>
      </button>
      <aside id="app-sidebar" className="sidebar">
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
          <span>StudyPlan</span>
        </a>
        <nav>
          {navigation
            .filter((n) => !demoMode || n.id !== 'backup')
            .map((n) => (
              <button
                key={n.id}
                aria-label={n.name}
                title={n.name}
                className={`${page === n.id ? 'active' : ''} ${n.id === 'exams' ? 'nav-divider' : ''}`}
                aria-current={page === n.id ? 'page' : undefined}
                onClick={() => setPage(n.id)}
              >
                <n.icon size={18} />
                <span className="nav-label">{n.name}</span>
                {n.id === 'replan' && state.proposal && <span className="nav-dot" />}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <label className="theme-picker">
            表示モード
            <select
              aria-label="表示モード"
              value={state.appearance ?? 'light'}
              onChange={(e) =>
                void update((s) => ({
                  ...s,
                  appearance: e.target.value as AppState['appearance'],
                }))
              }
            >
              <option value="light">ライト</option>
              <option value="dark">ダーク</option>
              <option value="system">システム</option>
            </select>
          </label>
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
            {demoMode ? 'デモ・このブラウザーに保存' : 'この端末に保存'}
          </div>
          <small>StudyPlan v{version}</small>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div>
            マイワークスペース <ChevronRight size={13} /> <strong>{active.name}</strong>
          </div>
          <span className={`save-status ${saving ? 'pending' : ''}`} role="status">
            {recovering
              ? '保存未確認'
              : saving
                ? '保存中…'
                : saved
                  ? '✓ 保存済み'
                  : '○ まだ保存されていません'}
          </span>
        </header>
        <div className="main-content">
          {demoMode && (
            <p className="demo-banner" role="status">
              公開デモです。入力内容はこのブラウザー内だけに保存され、デスクトップ版とは共有されません。
            </p>
          )}
          <div className="page-heading">
            <div>
              <h1 ref={pageHeading} tabIndex={-1}>
                {active.name}
              </h1>
            </div>
            <span className="today-label">
              {today().replaceAll('-', ' / ')}（
              {['日', '月', '火', '水', '木', '金', '土'][weekday(today())]}）
            </span>
          </div>
          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button onClick={dismissError}>閉じる</button>
            </div>
          )}
          {children}
        </div>
      </main>
    </div>
  );
}
