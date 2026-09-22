import { AppState } from '../domain/model';
import { samePlanningSettings, stalePlan } from '../domain/planAudit';
import { setupIssues } from '../domain/setupIssues';

export function RegistrationStatus({
  state,
  onGenerate,
  onReview,
  onConfigure,
}: {
  state: AppState;
  onGenerate: () => void;
  onReview: () => void;
  onConfigure: (kind: string) => void;
}) {
  if (!state.settings.exams.length && !state.settings.materials.length) return null;
  if (state.plan && !stalePlan(state.plan, state.settings)) return null;
  const missing = setupIssues(state.settings).filter((i) => i.severity === 'error');
  const ready =
    !!state.proposal?.plan.settingsSnapshot &&
    samePlanningSettings(state.proposal.plan.settingsSnapshot, state.settings);
  return (
    <section className="registration-status" aria-label="登録と計画の状態">
      <h3>計画に未反映</h3>
      <p>確定した変更は保存済みです。計画案を確認し、更新するとカレンダーへ反映します。</p>
      {missing.length ? (
        <>
          {missing.map((issue) => (
            <div key={issue.id}>
              <p>
                {issue.title}。{issue.impact}
              </p>
              <button onClick={() => onConfigure(issue.id)}>
                {issue.id === 'exams'
                  ? '試験を追加'
                  : issue.id === 'materials'
                    ? '教材を追加'
                    : '勉強できる時間を設定'}
              </button>
            </div>
          ))}
        </>
      ) : (
        <button className="primary" onClick={ready ? onReview : onGenerate}>
          {ready ? '承認待ちの計画案を見る' : 'この変更を含めて計画を見直す'}
        </button>
      )}
    </section>
  );
}
