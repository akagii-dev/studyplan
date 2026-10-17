/** One option of the segmented switch; the current view is filled in the action gray. */
const option = (active: boolean) =>
  `min-h-11 min-w-11 max-w-full rounded-none [border:0] px-3.5 py-[9px] text-[1rem] whitespace-normal wrap-anywhere ${
    active ? 'active bg-action font-[650] text-on-action [box-shadow:none]' : 'bg-transparent text-ink hover:enabled:bg-soft'}`;

export function ScheduleViewSwitch({ calendar, onSwitch }: { calendar: boolean; onSwitch: () => void }) {
  return <div className="ms-auto flex max-w-full flex-wrap overflow-hidden rounded-control border border-control bg-surface p-0 whitespace-nowrap max-[600px]:ms-0" role="group" aria-label="予定の表示切替">
    <button className={option(!calendar)} data-return-focus="schedule-week" aria-pressed={!calendar} onClick={() => { if (calendar) onSwitch(); }}>週間予定</button>
    <button className={option(calendar)} data-return-focus="schedule-calendar" aria-pressed={calendar} onClick={() => { if (!calendar) onSwitch(); }}>カレンダー表示</button>
  </div>;
}
