import { useState } from 'react';
import { todayStudyRows } from '../domain/todayProgress';
import { type AppState } from '../domain/model';
import { AnimatedProgress } from './AnimatedProgress';

function StudyProgressItem({ row }: { row: ReturnType<typeof todayStudyRows>[number] }) {
  const { target, recorded, text, complete } = row.progress;
  const percent = target === null || target <= 0 ? null : complete ? 100 :
    Math.max(0, Math.min(99, Math.floor(recorded / target * 100)));
  return <li className="today-study-progress-item">
    <div className="today-study-title">
      <div><strong>{row.materialName}</strong><span>{row.round + 1}周目</span></div>
      {percent !== null && <span className="today-study-percent" aria-hidden="true">{percent}%</span>}
    </div>
    {percent !== null && <AnimatedProgress label={
      row.materialName + ' ' + (row.round + 1) + '周目・' + recorded + '/' + target + row.unit + '・' + text
    } value={percent} max={100} animate={false} />}
    <span>{target === null ? text : recorded + '/' + target + row.unit + ' · ' + text}</span>
  </li>;
}

export function TodayStudyProgress({ state }: { state: AppState }) {
  const [open, setOpen] = useState(true);
  const rows = todayStudyRows(state);
  return <details className="card today-study-progress" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>今日の学習進捗</summary>
    {rows.length ? <ul className="today-study-progress-list">
      {rows.map(row => <StudyProgressItem key={JSON.stringify([row.materialId, row.round])} row={row} />)}
    </ul> : <p>今日の学習予定はありません。</p>}
  </details>;
}
