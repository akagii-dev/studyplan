import { createContext, ReactNode, useContext, useRef, useState } from 'react';
import type { AppState } from '../domain/model';

export type UiStyle = NonNullable<AppState['uiStyle']>;

const UiStyleContext = createContext<{ game: boolean; switchUi: (to: UiStyle) => Promise<void> }>({
  game: false,
  switchUi: async () => {},
});

/** True while the game UI is chosen; game-only parts (rewards, screen time, clear stamps) render only then. */
export const useGameUi = () => useContext(UiStyleContext).game;
export const useUiSwitch = () => useContext(UiStyleContext);

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/**
 * Switching the look goes behind a short loading curtain: the curtain closes, the choice is saved
 * and applied, the game faces load, then the curtain opens. Reduced motion skips the movement.
 */
export function UiStyleProvider({
  style,
  update,
  children,
}: {
  style: UiStyle;
  update: (change: (state: AppState) => AppState) => Promise<unknown>;
  children: ReactNode;
}) {
  const [curtain, setCurtain] = useState<{ to: UiStyle; phase: 'in' | 'out' } | null>(null);
  const running = useRef(false);
  async function switchUi(to: UiStyle) {
    if (to === style || running.current) return;
    running.current = true;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    try {
      setCurtain({ to, phase: 'in' });
      await wait(still ? 0 : 240);
      await update((state) => ({ ...state, uiStyle: to }));
      // The display faces are bundled but load on first use; reveal once they are ready.
      const faces = to === 'game' && document.fonts
        ? Promise.all([document.fonts.load('italic 900 1em Montserrat'), document.fonts.load('900 1em "Zen Kaku Gothic New"', 'あ')])
        : Promise.resolve();
      await Promise.all([Promise.race([faces, wait(1200)]), wait(still ? 0 : 360)]);
      setCurtain({ to, phase: 'out' });
      await wait(still ? 0 : 280);
    } finally {
      setCurtain(null);
      running.current = false;
    }
  }
  return (
    <UiStyleContext.Provider value={{ game: style === 'game', switchUi }}>
      {children}
      {curtain && <SwitchCurtain to={curtain.to} closing={curtain.phase === 'out'} />}
    </UiStyleContext.Provider>
  );
}

/** The loading screen between the two looks: a slanted ink wipe toward the game UI, a fade toward the Fresh UI. */
function SwitchCurtain({ to, closing }: { to: UiStyle; closing: boolean }) {
  const game = to === 'game';
  return (
    <div
      className={`ui-switch-curtain fixed inset-0 z-50 grid cursor-progress place-items-center overflow-hidden motion-reduce:animate-none ${
        game
          ? `${closing ? 'animate-curtain-wipe-out' : 'animate-curtain-wipe-in'} bg-[#15130f] text-[#f6f3ec]`
          : `${closing ? 'animate-curtain-fade-out' : 'animate-curtain-fade-in'} bg-surface text-ink`
      }`}
      role="status"
      aria-label="表示を切り替えています"
    >
      {game ? (
        <>
          <span className="absolute inset-y-0 right-[18%] w-[9%] -skew-x-[18deg] bg-[#c8231a]" aria-hidden="true" />
          <span className="relative -skew-x-[10deg] font-display text-[40px] font-black italic tracking-[0.04em]" aria-hidden="true" lang="en">
            NOW LOADING<span className="text-[#ff5a46]">…</span>
          </span>
        </>
      ) : (
        <span className="grid justify-items-center gap-3 text-[15px] font-bold" aria-hidden="true">
          StudyPlan
          <span className="h-0.5 w-24 overflow-hidden bg-line">
            <span className="block h-full w-1/3 animate-curtain-bar bg-accent motion-reduce:animate-none" />
          </span>
        </span>
      )}
    </div>
  );
}
