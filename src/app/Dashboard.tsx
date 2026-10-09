import { ChevronRight } from 'lucide-react';
import { Props, duration } from '../components/common';
import { ShortfallDetails } from '../components/ShortfallDetails';
import { StudyNote } from '../components/StudyNote';
import { TodayRecorder, RecordTarget } from '../components/TodayRecorder';
import { today } from '../domain/model';
import { currentPlanReconciliation, currentProgressAdjustment } from '../domain/progressAdjustment';
import { Page } from './navigation';

export function Dashboard({
  state,
  update,
  navigate,
  onReview,
  recordTarget,
}: Props & { navigate: (page: Page) => void; onReview: () => void; recordTarget?: RecordTarget | null }) {
  if (!state.plan)
    return (
      <div className="daily-page max-w-[900px]"><section className="card">
        <h2>学習計画をつくる</h2>
        <button className="primary" onClick={() => navigate('setup')}>
          設定を始める <ChevronRight size={17} />
        </button>
      </section><StudyNote state={state} update={update} /></div>
    );

  const reconciliation = currentPlanReconciliation(state);
  const result = currentProgressAdjustment(state);
  const reviews = state.plan.sessions.filter((session) => session.date === today() && session.kind === 'review');
  return (
    <div className="daily-page max-w-[900px]">
      {reconciliation?.status === 'blocked' ? (
        <div className="daily-adjustment mb-4 rounded-[8px] bg-soft px-3.5 py-2.5" role="status">
          <strong>調整未反映・要確認。現在の計画を保持しています。</strong>
          {reconciliation.detail && <p>{reconciliation.detail}</p>}
          <button onClick={() => navigate('future')}>今後の予定を確認</button>
        </div>
      ) : (result?.status === 'review' || result?.status === 'failed') && (
        <div className="daily-adjustment mb-4 rounded-[8px] bg-soft px-3.5 py-2.5" role="status">
          {result.status === 'failed' ? '実績は保存されました。予定調整に失敗しました。' : '予定の確認が必要です。'}
          {result.status === 'failed' ? (
            <span className="actions">
              <button onClick={() => navigate('future')}>今後の予定を確認</button>
              <button onClick={() => navigate('settings')}>設定を確認</button>
            </span>
          ) : <button onClick={onReview}>計画案を確認</button>}
          {result.detail && <small className="mt-[5px] block">{result.detail}</small>}
        </div>
      )}
      <section className="card dashboard-today max-w-[900px] pt-3">
        <div className="dashboard-today-actions mb-4">
          <button type="button" className="border-accent text-accent" onClick={() => navigate('today')}>
            今日のスケジュール・時間内訳
          </button>
        </div>
        <TodayRecorder state={state} update={update} target={recordTarget} />
        {reviews.length > 0 && (
          <div className="daily-reviews mt-3.5 border-t border-line">
            {reviews.map((session) => (
              <div key={session.id} className="flex justify-between gap-3 py-3">
                <strong>{state.settings.exams.find((exam) => exam.id === session.examId)?.name ?? '試験'} · 復習</strong>
                <span>{duration(session.end - session.start)}</span>
              </div>
            ))}
          </div>
        )}
      </section>
      <ShortfallDetails state={state} onReview={onReview} />
      <StudyNote state={state} update={update} />
    </div>
  );
}
