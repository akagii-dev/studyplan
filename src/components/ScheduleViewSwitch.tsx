export function ScheduleViewSwitch({ calendar, onSwitch }: { calendar: boolean; onSwitch: () => void }) {
  return <div className="schedule-view-switch" role="group" aria-label="予定の表示切替">
    <button data-return-focus="schedule-week" aria-pressed={!calendar} onClick={() => { if (calendar) onSwitch(); }}>週間予定</button>
    <button data-return-focus="schedule-calendar" aria-pressed={calendar} onClick={() => { if (!calendar) onSwitch(); }}>カレンダー表示</button>
  </div>;
}
