import { useId, useState } from 'react';
import { demoMode } from '../demo';
import { todayStudyRows } from '../domain/todayProgress';
import { type AppState } from '../domain/model';
import { AnimatedProgress, ProgressRing } from './AnimatedProgress';

function StudyProgressItem({ row, shape }: { row: ReturnType<typeof todayStudyRows>[number]; shape: 'circle' | 'line' }) {
  const id = useId();
  const { target, recorded, text } = row.progress;
  const ratio = target === null ? null : Math.min(1, recorded / target);
  const title = <strong id={id} title={row.materialName}>{row.materialName}</strong>;
  const amount = <span>{target === null ? text : `${recorded}/${target}${row.unit} · ${text}`}</span>;
  return <li className={`today-study-progress-item ${shape}`}>
    {shape === 'circle' ? <div className="today-study-circle">
      {ratio !== null && <ProgressRing percent={ratio * 100} label={`${row.materialName} ${row.round + 1}周目・${recorded}/${target}${row.unit}・${text}`} animate={false} showPercentage={false} />}
      <div className="today-study-circle-center">
        {title}<span>{row.round + 1}周目</span>{amount}
      </div>
    </div> : <>
      {title}<span>{row.round + 1}周目</span>
      {target !== null && <AnimatedProgress label={`${row.materialName} ${row.round + 1}周目・${recorded}/${target}${row.unit}・${text}`} value={recorded} max={target} animate={false} />}
      {amount}
    </>}
    {shape === 'circle' && row.materialName.length > 40 && <span className="today-study-full-name" aria-hidden="true">{row.materialName}</span>}
  </li>;
}

export function TodayStudyProgress({ state }: { state: AppState }) {
  const [open, setOpen] = useState(true);
  const [shape, setShape] = useState<'circle' | 'line'>('circle');
  const rows = todayStudyRows(state);
  return <details className="card today-study-progress" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>今日の学習進捗</summary>
    {demoMode && <div className="segmented" role="group" aria-label="進捗の表示形式">
      <button type="button" aria-pressed={shape === 'circle'} className={shape === 'circle' ? 'active' : ''} onClick={() => setShape('circle')}>円型</button>
      <button type="button" aria-pressed={shape === 'line'} className={shape === 'line' ? 'active' : ''} onClick={() => setShape('line')}>直線型</button>
    </div>}
    {rows.length ? <ul className={`today-study-progress-list ${shape}`}>
      {rows.map(row => <StudyProgressItem key={JSON.stringify([row.materialId, row.round])} row={row} shape={shape} />)}
    </ul> : <p>今日の学習予定はありません。</p>}
  </details>;
}
