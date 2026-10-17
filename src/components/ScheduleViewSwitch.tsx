/** One option of the switch; the current view is a slanted ink plate with a signal-color shadow. */
const option = (active: boolean) =>
  `min-h-11 min-w-11 max-w-full -skew-x-[10deg] rounded-none [border:0] px-3.5 py-[9px] text-[1rem] font-black whitespace-normal wrap-anywhere ${
    active ? 'active bg-ink text-surface shadow-[3px_3px_0_var(--accent)]' : 'bg-transparent text-ink'}`;

export function ScheduleViewSwitch({ calendar, onSwitch }: { calendar: boolean; onSwitch: () => void }) {
  return <div className="ms-auto flex max-w-full flex-wrap gap-1 p-1 whitespace-nowrap max-[600px]:ms-0" role="group" aria-label="予定の表示切替">
    <button className={option(!calendar)} data-return-focus="schedule-week" aria-pressed={!calendar} onClick={() => { if (calendar) onSwitch(); }}>週間予定</button>
    <button className={option(calendar)} data-return-focus="schedule-calendar" aria-pressed={calendar} onClick={() => { if (!calendar) onSwitch(); }}>カレンダー表示</button>
  </div>;
}
