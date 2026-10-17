import { ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { version } from '../../package.json';
import { Props } from '../components/common';
import { today, weekday } from '../domain/model';
import { demoMode } from '../demo';
import { lanMode } from '../lan';
import { Page, navigation, pageNames, pageTitles } from './navigation';
/**
 * A tab on the black band. The current page sits on a slanted signal-color plate drawn behind
 * the label, so the label and its focus ring stay upright. On phones the band moves to the bottom.
 */
const tilts = ['-rotate-[4deg]', 'rotate-[3deg]', '-rotate-[2deg]', 'rotate-[5deg]'];
const navButton = (active: boolean, index: number) =>
  `relative isolate min-h-11 rounded-none bg-transparent px-4 text-[17px] whitespace-nowrap [border:0] ${tilts[index % tilts.length]} before:absolute before:inset-y-1 before:inset-x-0 before:-z-1 before:-skew-x-[16deg] before:transition-[background-color] before:duration-150 hover:enabled:bg-transparent max-[700px]:min-h-14 max-[700px]:w-full max-[700px]:min-w-0 max-[700px]:px-px max-[700px]:text-[13px] max-[700px]:before:inset-x-1 max-[700px]:focus-visible:outline-offset-[-3px] ${
    active
      ? 'active scale-115 font-display font-black italic text-band before:bg-surface before:shadow-[4px_4px_0_var(--accent)] hover:enabled:text-band'
      : 'font-display font-black italic text-on-band hover:enabled:before:bg-accent'}`;

/** Ransom-note title: each character cut out on its own plate, as in the game's menus. */
const cutouts = [
  'bg-ink text-surface -rotate-[5deg] text-[1.1em]',
  'border-[3px] border-ink bg-surface text-ink rotate-[4deg]',
  'bg-accent text-on-accent -rotate-[2deg] text-[1.2em]',
  'bg-ink text-surface rotate-[6deg] text-[0.95em]',
  'border-[3px] border-ink bg-surface text-ink -rotate-[6deg] text-[1.05em]',
];

export function AppShell({
  state,
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
      className="app-shell min-h-[100vh]"
      data-input-mode={keyboardNavigation ? 'keyboard' : 'pointer'}
      onPointerDownCapture={() => { keyboardInput.current = false; setKeyboardNavigation(false); }}
      onKeyDownCapture={() => { keyboardInput.current = true; setKeyboardNavigation(true); }}
      inert={blocked || undefined}
    >
      <header className="app-header flex h-16 items-center gap-10 border-b-4 border-b-accent bg-band px-16 text-on-band max-[1150px]:gap-6 max-[1150px]:px-8 max-[700px]:h-auto max-[700px]:min-h-14 max-[700px]:gap-3 max-[700px]:px-4">
        <a
          className="text-[17px] font-display font-black italic tracking-[0.02em] text-on-band no-underline"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage('dashboard');
          }}
        >
          Study<span className="text-accent">/</span>Plan
        </a>
        <nav id="app-sidebar" aria-label="主な画面" className="flex gap-7 max-[700px]:fixed max-[700px]:right-0 max-[700px]:bottom-0 max-[700px]:left-0 max-[700px]:z-4 max-[700px]:grid max-[700px]:grid-cols-[repeat(4,minmax(0,1fr))] max-[700px]:gap-0 max-[700px]:overflow-x-clip max-[700px]:border-t-4 max-[700px]:border-t-accent max-[700px]:bg-band max-[700px]:pb-[env(safe-area-inset-bottom,0px)]">
          {navigation.map((n, index) => (
            <button
              key={n.id}
              className={navButton(navigationPage === n.id, index)}
              aria-current={navigationPage === n.id ? 'page' : undefined}
              aria-label={n.name}
              onClick={() => setPage(n.id)}
            >
              <span lang="en">{n.label}</span>
            </button>
          ))}
        </nav>
        <span className={`save-status ms-auto text-[12px] ${saving ? 'pending font-bold text-on-band' : 'text-band-muted'}`} role="status">
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
      <main className="min-w-0 max-[700px]:pb-[calc(64px+env(safe-area-inset-bottom,0px))]">
        {/* Content sits on a white paper panel with a hard ink shadow over the red page. */}
        <div className="@container mx-auto mt-10 mb-12 max-w-[1280px] border-4 border-band bg-surface shadow-[12px_12px_0_var(--band)] px-16 pt-12 pb-12 max-[1359px]:mx-8 max-[700px]:mx-2 max-[700px]:mt-4 max-[700px]:shadow-[6px_6px_0_var(--band)] max-[1150px]:px-8 max-[1150px]:pt-8 max-[700px]:px-4 max-[700px]:pt-5 max-[700px]:pb-8">
          {demoMode && (
            <p className="mx-0 mt-0 mb-[1.25rem] border-b border-b-line pb-[0.75rem] text-[14px] text-muted" role="status">
              公開デモです。入力内容はこのブラウザー内だけに保存され、デスクトップ版とは共有されません。
            </p>
          )}
          <div className={`flex items-center justify-between ${(page === 'future' || page === 'calendar') ? 'future-heading mb-2 max-w-[900px] flex-nowrap gap-3 [&>div]:min-w-0' : 'mb-7 max-[700px]:mb-[18px] max-[700px]:flex-wrap max-[700px]:gap-2'}`}>
            <div>
              {onBack && <button className="detail-back mb-[0.5rem]" onClick={onBack}>← {backLabel}へ戻る</button>}
              <h1 className="mt-2 mb-2 text-[42px] font-display font-black italic max-[700px]:text-[28px]" aria-label={active.name} ref={pageHeading} tabIndex={-1}>
                {[...pageTitles[page]].map((char, index) => (
                  <span key={index} className={`inline-block px-1.5 leading-[1.3] ${index ? '-ms-0.5' : ''} ${cutouts[index % cutouts.length]}`}>{char}</span>
                ))}
              </h1>
            </div>
            {['dashboard', 'today'].includes(page) && (
              <span className="-skew-x-[12deg] bg-band px-3 py-1 font-display text-[13px] font-black italic text-on-band tabular-nums max-[900px]:hidden">
                {today().replaceAll('-', ' / ')}（
                {['日', '月', '火', '水', '木', '金', '土'][weekday(today())]}）
              </span>
            )}
          </div>
          {error && (
            <div className="error-banner mb-5 flex justify-between border-l-8 border-error-line bg-error-bg p-3 text-[13px] font-bold whitespace-pre-line text-on-error-bg flex-col items-start gap-2" role="alert">
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
            <div className="error-banner mb-5 flex justify-between border-l-8 border-error-line bg-error-bg p-3 text-[13px] font-bold whitespace-pre-line text-on-error-bg items-center" role="status">
              <span>Windowsに接続できません。配信PCとWi-Fiを確認してください。</span>
              <button onClick={checkConnection}>再接続</button>
            </div>
          )}
          {children}
          <p className="mt-12 mb-0 text-[12px] text-muted">
            {demoMode ? 'デモ・このブラウザーに保存' : lanMode ? 'Windowsに保存' : 'この端末に保存'} · StudyPlan v{version}
          </p>
        </div>
      </main>
    </div>
  );
}
