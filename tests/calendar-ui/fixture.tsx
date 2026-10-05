import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Calendar } from '../../src/components/Calendar';
import { progressContractFixture, contractDay } from '../fixtures/progressContract';
import { createCalendarFile } from '../../src/domain/icalendar';
import '../../src/style.css';

// Isolated UI harness: no application bootstrap, SQLite, or production state.
function Fixture() {
  const [state, setState] = useState(() => {
    const state = progressContractFixture();
    state.calendarDensity = { month: 'compact', week: 'standard', list: 'detailed' };
    return state;
  });
  Object.assign(window, { calendarFixture: { state, createCalendarFile } });
  return <div className="app-shell"><main><div className="main-content">
    <Calendar state={state} update={async transform => { setState(transform); }}
      initialDate={contractDay} initialView="list" onRecord={() => {}} onReplan={() => {}} />
  </div></main></div>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
