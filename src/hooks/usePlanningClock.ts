import { useEffect, useState } from 'react';
import { today } from '../domain/model';

/** Refresh presentation at minute boundaries without saving or changing the plan. */
export function usePlanningClock() {
  const read = () => {
    const now = new Date();
    return { date: today(), minute: now.getHours() * 60 + now.getMinutes() };
  };
  const [value, setValue] = useState(read);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      const next = read();
      setValue((old) => old.date === next.date && old.minute === next.minute ? old : next);
      clearTimeout(timer);
      timer = setTimeout(refresh, 60_000 - Date.now() % 60_000 + 1);
    };
    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  return value;
}
