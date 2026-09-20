import { AppState } from '../domain/model';
import { sameSettings, stalePlan } from '../domain/planAudit';
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
    sameSettings(state.proposal.plan.settingsSnapshot, state.settings);
  return (
    <section className="registration-status" aria-label="登録と計画の状態">
      <h3>登録済み・計画への反映待ち</h3>
      <p>計画案を確認し、承認するとカレンダーが更新されます。</p>
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
          {ready ? '承認待ちの計画案を見る' : '追加・変更を含めた計画案を確認'}
        </button>
      )}
    </section>
  );
}
