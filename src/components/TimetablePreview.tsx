import { useState } from 'react';
import { Settings, clock, weekday } from '../domain/model';
import { freeIntervalsForDate } from '../domain/planner';
import { unavailableEvents } from '../domain/planAudit';
import { weekdays, Field, duration } from './common';

export function TimetablePreview({
  settings,
  from,
  to,
  periodLabel = '時間割の適用',
}: {
  settings: Settings;
  from: string;
  to: string;
  periodLabel?: string;
}) {
  const [date, setDate] = useState(from);
  const validDate = date >= from && date <= to ? date : from;
  if (!from || !to || to < from) return null;
  const study = settings.windows.filter(
    (w) =>
      w.kind === 'study' &&
      w.from <= validDate &&
      validDate <= w.to &&
      w.weekdays.includes(weekday(validDate)),
  );
  const busy = unavailableEvents(settings, validDate);
  const available = freeIntervalsForDate(settings, validDate);
  return (
    <section className="timetable-preview" aria-label="授業を除いた学習枠の確認">
      <h3>選択したコマは「授業・学習不可」です</h3>
      <p>授業前後の移動・準備：各 {settings.classTransition ?? 0}分です。</p>
      <Field label="学習枠を確認する日">
        <input
          type="date"
          min={from}
          max={to}
          value={validDate}
          onChange={(e) => setDate(e.target.value)}
        />
      </Field>
      <p>
        {validDate}（{weekdays[weekday(validDate)]}）・{periodLabel}：{from}〜{to}
      </p>
      <dl className="availability-breakdown">
        <div>
          <dt>登録した学習可能枠</dt>
          <dd>
            {study.length
              ? study.map((w) => `${clock(w.start)}–${clock(w.end)}`).join(' / ')
              : 'この日の学習可能枠はありません'}
          </dd>
        </div>
        <div className="busy-time">
          <dt>授業・予定（学習不可）</dt>
          <dd>
            {busy.length
              ? busy
                  .map(
                    (b) =>
                      `${clock(b.start)}–${clock(b.end)} ${b.kind === 'class' ? '授業' : b.name}`,
                  )
                  .join(' / ')
              : '登録なし'}
          </dd>
        </div>
        <div className="free-time">
          <dt>除外後の学習枠</dt>
          <dd>
            {available.length
              ? available.map(([a, b]) => `${clock(a)}–${clock(b)}`).join(' / ')
              : '学習枠なし'}
            <b> 合計 {duration(available.reduce((n, [a, b]) => n + b - a, 0))}</b>
          </dd>
        </div>
      </dl>
      <small>このあと連続学習の長さ・休憩・余裕率を適用します。</small>
    </section>
  );
}
