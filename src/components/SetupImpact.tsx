import { ScheduleKind, Settings } from '../domain/model';
import {
  answerSchedule,
  scheduleCount,
  scheduleInfo,
  scheduleKinds,
  scheduleStatus,
  setupIssues,
} from '../domain/setupIssues';
import { Props } from './common';
import { StudyCoverageGap } from '../domain/studyCoverage';

export function StudyCoverageNotice({
  settings,
  from,
  onConfigure,
  actionLabel = 'この期間の学習枠を追加',
  onReviewGoal,
}: {
  settings: Settings;
  from?: string;
  onConfigure?: (gap: StudyCoverageGap) => void;
  actionLabel?: string;
  onReviewGoal?: (gap: StudyCoverageGap, topic: 'material' | 'exam') => void;
}) {
  const issues = setupIssues(settings, from).filter((i) => i.studyGap);
  if (!issues.length) return null;
  return (
    <section className="warning" aria-label="学習枠の未登録期間" role="note">
      <h3>目標日までの学習枠を確認してください</h3>
      {issues.map((i) => (
        <div key={i.id} className="setup-issue">
          <b>{i.title}</b>
          {onConfigure && <button onClick={() => onConfigure(i.studyGap!)}>{actionLabel}</button>}
          {i.longTerm && (
            <>
              <p>{i.action}</p>
              {onReviewGoal && (
                <div className="actions">
                  <button onClick={() => onReviewGoal(i.studyGap!, 'material')}>
                    周回数を見直す
                  </button>
                  <button onClick={() => onReviewGoal(i.studyGap!, 'exam')}>目標日を見直す</button>
                </div>
              )}
            </>
          )}
        </div>
      ))}
      <p>{issues[0].impact}</p>
      {!issues.some((i) => i.longTerm) && <small>{issues[0].action}</small>}
    </section>
  );
}

export function SkipImpact({ kind }: { kind: ScheduleKind }) {
  return (
    <div className="warning skip-impact" role="note">
      <h3>「あとで設定する」を選ぶと</h3>
      <p>{scheduleInfo[kind].impact}</p>
      <small>
        登録済みの予定は引き続き除きます。あとで入力・確認したら、計画案を作り直してください。
      </small>
    </div>
  );
}
export function SetupImpact({
  settings,
  onConfigure,
  onConfigureStudy,
  from,
  onReviewStudyGoal,
}: {
  settings: Settings;
  onConfigure?: (kind: ScheduleKind) => void;
  onConfigureStudy?: (gap: StudyCoverageGap) => void;
  from?: string;
  onReviewStudyGoal?: (gap: StudyCoverageGap, topic: 'material' | 'exam') => void;
}) {
  const issues = setupIssues(settings, from);
  if (!issues.length) return null;
  return (
    <section className="setup-impact" aria-label="未設定項目と計画への影響">
      <StudyCoverageNotice
        settings={settings}
        from={from}
        onConfigure={onConfigureStudy}
        onReviewGoal={onReviewStudyGoal}
      />
      {(['error', 'warning'] as const).map((severity) => {
        const items = issues.filter((i) => i.severity === severity && !i.studyGap);
        if (!items.length) return null;
        return (
          <div
            className={severity === 'error' ? 'error' : 'warning'}
            role={severity === 'error' ? 'alert' : 'note'}
            key={severity}
          >
            <h3>
              {severity === 'error'
                ? '計画を作るために必要な情報がありません'
                : '未設定・未確認の情報による注意'}
            </h3>
            {items.map((i) => (
              <div key={i.id} className="setup-issue">
                <b>{i.title}</b>
                <p>{i.impact}</p>
                <small>{i.action}</small>
                {i.kind && onConfigure && (
                  <button onClick={() => onConfigure(i.kind!)}>
                    {scheduleInfo[i.kind].label}を確認する
                  </button>
                )}
              </div>
            ))}
          </div>
        );
      })}
    </section>
  );
}
export function ScheduleReview({ state, update }: Props) {
  return (
    <section className="card">
      <h2>予定の確認状況</h2>
      <p>
        「予定がない」と「まだ確認していない」を区別します。入力が終わったら確認済みにしてください。確認済みにしても承認済みの計画は変わらないため、計画案を作り直してください。
      </p>
      {scheduleKinds.map((kind) => {
        const status = scheduleStatus(state.settings, kind);
        const count = scheduleCount(state.settings, kind);
        return (
          <div className="schedule-review" key={kind}>
            <div className="row">
              <b>{scheduleInfo[kind].label}</b>
              <span className="badge">
                {status === 'none'
                  ? '予定なし'
                  : status === 'registered'
                    ? '登録済み'
                    : status === 'deferred'
                      ? 'あとで設定'
                      : '未確認'}
              </span>
            </div>
            {(status === 'deferred' || status === 'unknown') && <p>{scheduleInfo[kind].impact}</p>}
            <div className="actions">
              <button
                onClick={() =>
                  void update((s) => answerSchedule(s, kind, count ? 'registered' : 'none'))
                }
              >
                {count ? '登録内容を確認済みにする' : '予定がないことを確認'}
              </button>
              <button onClick={() => void update((s) => answerSchedule(s, kind, 'deferred'))}>
                あとで見直す
              </button>
            </div>
          </div>
        );
      })}
    </section>
  );
}
