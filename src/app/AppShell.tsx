import { Leaf } from 'lucide-react';
import { ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { version } from '../../package.json';
import { Props } from '../components/common';
import { today, weekday } from '../domain/model';
import { demoMode } from '../demo';
import { lanMode } from '../lan';
import { Page, navigation, pageNames } from './navigation';
/** Sidebar navigation button; on phones the sidebar becomes a bottom bar with stacked labels. */
const navButton = (active: boolean) =>
  `min-h-11 justify-start gap-3 rounded-control px-3 py-2.5 text-[14px] whitespace-nowrap [border:0] [&_svg]:shrink-0 max-[700px]:grid max-[700px]:min-h-12 max-[700px]:w-full max-[700px]:min-w-0 max-[700px]:grid-cols-[minmax(0,1fr)] max-[700px]:place-items-center max-[700px]:justify-center max-[700px]:gap-0.5 max-[700px]:px-px max-[700px]:py-[5px] max-[700px]:text-[11px] max-[700px]:whitespace-normal max-[700px]:focus-visible:outline-offset-[-3px] ${
    active
      ? 'active bg-soft font-bold text-accent [box-shadow:inset_4px_0_var(--accent)] hover:enabled:bg-soft hover:enabled:text-accent max-[700px]:rounded-none max-[700px]:bg-transparent max-[700px]:[box-shadow:inset_0_3px_var(--accent)] max-[700px]:hover:enabled:bg-transparent'
      : 'bg-transparent font-medium text-muted hover:enabled:bg-soft/50 hover:enabled:text-ink'}`;

export function AppShell({
  state,
  update,
  page,
  setPage,
  onBack,
  backLabel,
  restorePosition,
  blocked,
  recovering,
  saving,
  saved,
  error,
  dismissError,
  externalUpdate,
  reloadExternal,
  connectionError,
  checkConnection,
  children,
}: Props & {
  page: Page;
  setPage: (page: Page) => void;
  onBack?: () => void;
  backLabel?: string;
  restorePosition?: { top: number; key: number; focus: HTMLElement | null; focusKey?: string } | null;
  blocked: boolean;
  recovering: boolean;
  saving: number;
  saved: boolean;
  error: string;
  dismissError: () => void;
  externalUpdate: boolean;
  reloadExternal: () => void;
  connectionError: string;
  checkConnection: () => void;
  children: ReactNode;
}) {
  const pageHeading = useRef<HTMLHeadingElement>(null);
  const keyboardInput = useRef(false);
  const [keyboardNavigation, setKeyboardNavigation] = useState(false);
  const navigationPage = page === 'calendar' ? 'future' : page;
  const active = { name: pageNames[page] };
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
    // Pointer navigation keeps focus in place; keyboard navigation restores its destination.
    const focusNavigation = keyboardInput.current;
    const frame = requestAnimationFrame(() => {
      const retained = restorePosition?.focus;
      const target = retained?.isConnected && retained.getClientRects().length
        ? retained
        : restorePosition?.focusKey
          ? [...document.querySelectorAll<HTMLElement>('[data-return-focus]')]
              .find((element) => element.dataset.returnFocus === restorePosition.focusKey)
          : null;
      if (restorePosition && target) {
        window.scrollTo({ top: restorePosition.top, left: 0, behavior: 'instant' });
        if (focusNavigation) target.focus({ preventScroll: true });
      } else {
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
        if (focusNavigation) pageHeading.current?.focus({ preventScroll: true });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [page, restorePosition?.key]);

  return (
    <div
      className={`app-shell flex min-h-[100vh] max-[700px]:[--sidebar-width:0px] ${state.sidebarCollapsed ? 'sidebar-collapsed [--sidebar-width:12px]' : '[--sidebar-width:226px] max-[1100px]:[--sidebar-width:196px]'}`}
      data-input-mode={keyboardNavigation ? 'keyboard' : 'pointer'}
      onPointerDownCapture={() => { keyboardInput.current = false; setKeyboardNavigation(false); }}
      onKeyDownCapture={() => { keyboardInput.current = true; setKeyboardNavigation(true); }}
      inert={blocked || undefined}
    >
      <button
        className="sidebar-toggle fixed top-0 left-[calc(var(--sidebar-width)-12px)] z-3 h-[100dvh] w-3 rounded-none bg-surface p-0 text-[11px] text-accent [border-color:currentColor_var(--border)_currentColor_currentColor] [border-style:none_solid_none_none] [border-width:0_1px_0_0] hover:enabled:border-accent hover:enabled:bg-soft focus-visible:outline-offset-[-3px] active:enabled:bg-accent active:enabled:text-surface max-[700px]:hidden"
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
      <aside id="app-sidebar" className={`sidebar fixed top-0 right-auto bottom-0 left-0 z-2 w-[calc(var(--sidebar-width)-12px)] flex-col overflow-y-auto bg-surface py-[29px] pr-2 pl-5 [border-right:0] max-[1150px]:py-[26px] max-[1150px]:pl-3.5 max-[700px]:top-auto max-[700px]:right-0 max-[700px]:z-4 max-[700px]:h-auto max-[700px]:w-full max-[700px]:border-t max-[700px]:border-t-line max-[700px]:p-1 max-[700px]:pb-[calc(4px+env(safe-area-inset-bottom,0px))] ${state.sidebarCollapsed ? 'hidden max-[700px]:flex' : 'flex'}`}>
        <a
          className="mx-[5px] mt-[2px] mb-[43px] flex items-center gap-[11px] text-ink no-underline max-[700px]:m-0 max-[700px]:mb-5 max-[700px]:hidden max-[700px]:gap-1.5"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage('dashboard');
          }}
        >
          <div className="grid size-9 place-items-center rounded-[10px] bg-accent text-on-accent [:root[data-theme='lime']_&]:border-[#6e8e29] [:root[data-theme='lime']_&]:bg-[#b5dc49] [:root[data-theme='lime']_&]:text-[#293a13]">
            <Leaf size={24} />
          </div>
          <span className="text-[20px] leading-[1.1] font-bold tracking-[-0.02em] max-[900px]:text-[19px] max-[700px]:text-[16px]">StudyPlan</span>
        </a>
        <nav className="flex flex-col gap-1 max-[700px]:grid max-[700px]:grid-cols-[repeat(4,minmax(0,1fr))] max-[700px]:gap-0">
          {navigation.map((n) => (
              <button
                key={n.id}
                aria-label={n.name}
                title={n.name}
                className={navButton(navigationPage === n.id)}
                aria-current={navigationPage === n.id ? 'page' : undefined}
                onClick={() => setPage(n.id)}
              >
                <n.icon size={18} />
                <span className="text-left whitespace-normal max-[700px]:text-center">{n.name}</span>
              </button>
            ))}
        </nav>
        <div className="mt-auto px-3 pt-[27px] pb-0 max-[700px]:hidden max-[700px]:px-1 max-[700px]:pt-5">
          <div className="flex items-center gap-[7px] text-[11px] text-muted [&_span]:size-1.5 [&_span]:rounded-[50%] [&_span]:bg-muted">
            <span />
            {demoMode ? 'デモ・このブラウザーに保存' : lanMode ? 'Windowsに保存' : 'この端末に保存'}
          </div>
          <small>StudyPlan v{version}</small>
        </div>
      </aside>
      <main className="ml-[var(--sidebar-width)] w-[calc(100%-var(--sidebar-width))] min-w-0 max-[700px]:ml-0 max-[700px]:w-full max-[700px]:pb-[calc(72px+env(safe-area-inset-bottom,0px))]">
        <header className="flex h-14 items-center justify-end border-b border-b-line bg-surface px-[38px] text-[12px] text-muted max-[1150px]:px-[25px] max-[700px]:h-auto max-[700px]:min-h-[60px] max-[700px]:flex-wrap max-[700px]:gap-2 max-[700px]:px-3">
          <span className={`save-status ${saving ? 'pending text-warning' : 'text-muted'}`} role="status">
            {recovering
              ? '保存未確認'
              : connectionError
                ? 'Windowsへの接続を確認できません'
              : saving
                ? '保存中…'
                : saved
                  ? lanMode ? '✓ Windowsに保存済み' : '✓ 保存済み'
                  : '○ まだ保存されていません'}
          </span>
        </header>
        <div className="@container m-auto max-w-[1450px] px-[38px] pt-[34px] pb-[50px] max-[1150px]:px-[25px] max-[1150px]:py-7 max-[700px]:px-3 max-[700px]:pt-[18px] max-[700px]:pb-8">
          {demoMode && (
            <p className="mx-0 mt-0 mb-[1.25rem] rounded-control border border-line border-l-4 border-l-accent bg-surface px-[1rem] py-[0.75rem] text-[14px] text-ink" role="status">
              公開デモです。入力内容はこのブラウザー内だけに保存され、デスクトップ版とは共有されません。
            </p>
          )}
          <div className={`flex items-center justify-between ${(page === 'future' || page === 'calendar') ? 'future-heading mb-2 max-w-[900px] flex-nowrap gap-3 [&>div]:min-w-0' : 'mb-7 max-[700px]:mb-[18px] max-[700px]:flex-wrap max-[700px]:gap-2'}`}>
            <div>
              {onBack && <button className="detail-back mb-[0.5rem]" onClick={onBack}>← {backLabel}へ戻る</button>}
              <h1 className="max-[700px]:text-[24px]" ref={pageHeading} tabIndex={-1}>
                {active.name}
              </h1>
            </div>
            {['dashboard', 'today'].includes(page) && (
              <span className="text-[11px] text-muted max-[900px]:hidden">
                {today().replaceAll('-', ' / ')}（
                {['日', '月', '火', '水', '木', '金', '土'][weekday(today())]}）
              </span>
            )}
          </div>
          {error && (
            <div className="error-banner mb-5 flex justify-between rounded-[7px] border border-error-line bg-error-bg p-3 text-[12px] whitespace-pre-line text-error flex-col items-start gap-2" role="alert">
              <span className="max-w-full wrap-anywhere">{error}</span>
              <button className="min-h-11 shrink-0 whitespace-nowrap" onClick={dismissError}>閉じる</button>
            </div>
          )}
          {externalUpdate && (
            <div className="note" role="status">
              別の端末で更新されました。 <button onClick={reloadExternal}>最新を読み込む</button>
            </div>
          )}
          {connectionError && (
            <div className="error-banner mb-5 flex justify-between rounded-[7px] border border-error-line bg-error-bg p-3 text-[12px] whitespace-pre-line text-error items-center" role="status">
              <span>Windowsに接続できません。配信PCとWi-Fiを確認してください。</span>
              <button onClick={checkConnection}>再接続</button>
            </div>
          )}
          {children}
        </div>
      </main>
    </div>
  );
}
