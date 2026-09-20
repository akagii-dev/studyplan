import { Warning } from './Warnings';
import { useState, useEffect, useRef, useId, useLayoutEffect } from 'react';
import { ArrowRight, RefreshCw, Undo2, CheckCircle2 } from 'lucide-react';
import { Session, today, clock } from '../domain/model';
import { approve, propose, undoPlan } from '../domain/planner';
import { Empty, Props, duration } from './common';
import { SetupImpact } from './SetupImpact';
import { PLAN_CALCULATION_VERSION } from '../domain/sessionPolicy';
import { requirePlanningInputs, setupIssues } from '../domain/setupIssues';
import { PlanInsights } from './PlanInsights';
import { GuidedRevision } from './GuidedRevision';
import { beginRevision, settingChanges, sameRevisionBase } from '../domain/revision';
import { fixedTimeIssue, fixedIssueMessage, ConstraintIssue } from '../domain/planConstraints';
import {
  beginConstraintRepair,
  beginStudyCoverageRepair,
  beginStudyGoalReview,
  refreshProposal,
  releaseFixedAndRefresh,
} from '../domain/repairPlan';
import { StudyCoverageGap } from '../domain/studyCoverage';
export function Replan({ state, update, onCalendar }: Props & { onCalendar: () => void }) {
  const [ack, setAck] = useState(false);
  const [error, err] = useState('');
  const [undo, setUndo] = useState(false);
  const [editing, setEditing] = useState(false);
  const [result, setResult] = useState('');
  const [acting, setActing] = useState(false);
  const actingRef = useRef(false);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const conflictsHeading = useRef<HTMLHeadingElement>(null);
  const unreportedHeading = useRef<HTMLHeadingElement>(null);
  const approveButton = useRef<HTMLButtonElement>(null);
  const revisionView = useRef<HTMLDivElement>(null);
  const approvalStatusId = useId();
  const reveal = (element: HTMLElement | null) => {
    element?.scrollIntoView({ block: 'start', behavior: 'instant' });
    element?.focus({ preventScroll: true });
  };
  useLayoutEffect(() => {
    if (editing) reveal(revisionView.current);
  }, [editing]);
  useLayoutEffect(() => {
    if (result) reveal(resultHeading.current);
  }, [result]);
  const p = state.proposal;
  const plan = p?.plan;
  const displaySettings = plan?.settingsSnapshot ?? state.settings;
  const stale = !!p?.settingsBase && !sameRevisionBase(p.settingsBase, state.settings);
  const missingSettings = setupIssues(displaySettings).filter((i) => i.severity === 'error');
  useEffect(() => setAck(false), [plan?.id]);
  const summarize = (list: Session[]) => {
    const map = new Map<string, number>();
    for (const s of list)
      if (s.kind === 'study' && s.date >= today()) {
        const k = `${s.date}｜${s.materialId}｜${s.round}`;
        map.set(k, (map.get(k) || 0) + s.count);
      }
    return map;
  };
  const old = summarize(state.plan?.sessions ?? []);
  const label = (key: string) => {
    const [date, id, round] = key.split('｜');
    const m = displaySettings.materials.find((m) => m.id === id);
    const exam = displaySettings.exams.find((e) => e.id === m?.examId);
    return `${date}｜${exam?.name} / ${m?.name}｜${Number(round) + 1}周目`;
  };
  const next = summarize(plan?.sessions ?? []);
  const signature = (s: Session) =>
    JSON.stringify([
      s.date,
      s.start,
      s.end,
      s.examId,
      s.materialId,
      s.round,
      s.count,
      s.kind,
      s.fixed,
    ]);
  const previousSessions = (state.plan?.sessions ?? []).filter(
    (s) => s.date >= (plan?.from ?? today()),
  );
  const proposedSessions = (plan?.sessions ?? []).filter((s) => s.date >= (plan?.from ?? today()));
  const detailedChanges = [
    ...previousSessions
      .filter((s) => !proposedSessions.some((n) => signature(n) === signature(s)))
      .map((s) => ({ s, change: '削除' })),
    ...proposedSessions
      .filter((s) => !previousSessions.some((n) => signature(n) === signature(s)))
      .map((s) => ({ s, change: '追加' })),
  ].sort((a, b) => a.s.date.localeCompare(b.s.date) || a.s.start - b.s.start);
  const keys = [...new Set([...old.keys(), ...next.keys()])]
    .sort()
    .filter((k) => old.get(k) !== next.get(k));
  const act = async (fn: Parameters<Props['update']>[0], success = '') => {
    if (actingRef.current) return;
    actingRef.current = true;
    setActing(true);
    try {
      await update(fn);
      err('');
      setAck(false);
      setResult(success);
    } catch (e) {
      err(String(e));
    } finally {
      actingRef.current = false;
      setActing(false);
    }
  };
  const repair = async (issue?: ConstraintIssue) => {
    try {
      await update((s) => beginConstraintRepair(s, issue));
      setEditing(true);
      err('');
    } catch (e) {
      err(String(e));
    }
  };
  const repairStudy = async (gap: StudyCoverageGap) => {
    try {
      await update((s) => beginStudyCoverageRepair(s, gap));
      setEditing(true);
      err('');
    } catch (e) {
      err(String(e));
    }
  };
  const timeProblems = (plan?.sessions ?? []).flatMap((session) => {
    if (
      !session.fixed ||
      session.date < plan!.from ||
      (session.date === plan!.from && session.start < (plan!.notBefore ?? 0))
    )
      return [];
    const cap = plan!.capacities.find((c) => c.date === session.date);
    const issue = cap ? fixedTimeIssue(displaySettings, session, cap) : null;
    return issue
      ? [
          {
            session,
            issue,
            message: fixedIssueMessage(session, issue),
            legacy: `${session.date} ${session.start / 60}時の固定予定が現在の学習可能枠に収まりません。`,
          },
        ]
      : [];
  });
  const approvalBlocks = [
    ...(plan && plan.calculationVersion !== PLAN_CALCULATION_VERSION
      ? [
          {
            text: '余裕率を週全体の割当上限に適用する方式で案を作り直してください。',
            action: '時間を基準に案を更新する',
            run: () => void act((s) => refreshProposal(s)),
          },
        ]
      : []),
    ...(stale
      ? [
          {
            text: '案の作成後に設定が変わっています。',
            action: '現在の設定から案を作り直す',
            run: () =>
              void act((s) => {
                requirePlanningInputs(s.settings);
                return propose(s, today(), '現在の設定・残数で案を作り直しました。');
              }),
          },
        ]
      : []),
    ...(missingSettings.length
      ? [
          {
            text: missingSettings.map((i) => i.title).join('・'),
            action: '必要な設定を入力する',
            run: () => void repair(),
          },
        ]
      : []),
    ...(plan?.conflicts.length
      ? [
          {
            text: `予定の競合：${plan.conflicts.length}件`,
            action: '競合の理由と修正方法を確認',
            run: () => reveal(conflictsHeading.current),
          },
        ]
      : []),
    ...(p?.unreported.length && !ack
      ? [
          {
            text: `未報告の扱い：${p.unreported.length}件が未確認`,
            action: '未報告の予定を確認',
            run: () => reveal(unreportedHeading.current),
          },
        ]
      : []),
  ];
  if (editing && state.draft.revision)
    return (
      <div ref={revisionView} tabIndex={-1} className="approval-target">
        <GuidedRevision state={state} update={update} onClose={() => setEditing(false)} />
      </div>
    );
  return (
    <>
      {p && plan && (
        <section className="card replan-approval" aria-label="計画案の承認">
          <div className="row">
            <h2>計画案の承認</h2>
            <div className="actions">
              <button
                data-submit
                ref={approveButton}
                className="primary"
                aria-describedby={approvalBlocks.length ? approvalStatusId : undefined}
                disabled={acting || approvalBlocks.length > 0}
                onClick={() =>
                  act((s) => approve(s, ack), '計画を承認し、カレンダーに反映しました')
                }
              >
                この計画を承認する
              </button>
              <button
                disabled={acting}
                onClick={() =>
                  act(
                    (s) => ({ ...s, proposal: null }),
                    '計画案を破棄しました。登録内容と現在の計画はそのままです。',
                  )
                }
              >
                案を破棄する
              </button>
            </div>
          </div>
          {plan.shortfalls.length > 0 && (
            <p className="hint">
              未配置 {plan.shortfalls.reduce((n, s) => n + s.count, 0)}
              問は、この計画に含まれません。
            </p>
          )}
          {approvalBlocks.length > 0 && (
            <section className="approval-blockers" aria-label="承認前の確認">
              <h3 id={approvalStatusId}>承認には、次の確認が必要です</h3>
              <ul>
                {approvalBlocks.map((block) => (
                  <li key={block.action}>
                    <span>{block.text}</span>
                    <button onClick={block.run}>{block.action}</button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </section>
      )}
      <div className="row">
        <p>変更案を確認してから、計画へ反映します。</p>
        <div className="actions">
          <button
            className="primary"
            onClick={() => {
              if (state.draft.revision) setEditing(true);
              else void update(beginRevision).then(() => setEditing(true));
            }}
          >
            {state.draft.revision ? '対話の続きから見直す' : '対話で条件を見直す'}
          </button>
          <button disabled={!state.history.length} onClick={() => setUndo(true)}>
            <Undo2 size={16} />
            前の計画へ戻す
          </button>
          <button
            data-submit
            onClick={() =>
              act((s) => {
                requirePlanningInputs(s.settings);
                return propose(s, today(), '現在の設定・残数をもとに、今後の課題を再配分します。');
              })
            }
          >
            <RefreshCw size={16} />
            設定を変えずに再計画
          </button>
        </div>
      </div>
      {undo && (
        <div className="note">
          <p>
            前の計画に戻します。進捗記録と設定は現在の状態を保ちます。過去の計画は現在の設定と一致しない場合があります。
          </p>
          <div className="actions">
            <button
              onClick={() => {
                void act(undoPlan);
                setUndo(false);
              }}
            >
              計画を戻す
            </button>
            <button onClick={() => setUndo(false)}>やめる</button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <SetupImpact
        settings={displaySettings}
        onConfigureStudy={(gap) => void repairStudy(gap)}
        onReviewStudyGoal={(gap, topic) => {
          void update((s) => beginStudyGoalReview(s, gap, topic))
            .then(() => setEditing(true))
            .catch((e) => err(String(e)));
        }}
      />
      {stale && (
        <Warning
          id="replan-0"
          title="計画案の元の設定が変更されています"
          version={[state.proposal?.plan.id, state.settings]}
        >
          案を作ったあとに元の設定が変わりました。現在の設定から案を作り直してください。
        </Warning>
      )}
      {!p || !plan ? (
        result ? (
          <section className="card registration-status" role="status">
            <CheckCircle2 size={24} />
            <h2 ref={resultHeading} tabIndex={-1}>
              {result}
            </h2>
            <button className="primary" onClick={onCalendar}>
              カレンダーを見る
            </button>
          </section>
        ) : (
          <Empty>
            <RefreshCw />
            <p>まだ承認待ちの変更案はありません。</p>
          </Empty>
        )
      ) : (
        <>
          <section className="card">
            <div className="eyebrow">PLAN PREVIEW · 承認待ち</div>
            <h2>計画案</h2>
            <p>{p.reason}</p>
            {!p.settingsBase && (
              <div className="registration-status">
                <h3>登録内容をこの計画へ反映します</h3>
                {state.plan?.settingsSnapshot &&
                  settingChanges(state.plan.settingsSnapshot, displaySettings).length > 0 && (
                    <ul>
                      {settingChanges(state.plan.settingsSnapshot, displaySettings).map(
                        (change, i) => (
                          <li key={i}>{change}</li>
                        ),
                      )}
                    </ul>
                  )}
                <p>
                  承認するとカレンダーが更新されます。案を破棄しても、登録した試験・教材は残ります。
                </p>
              </div>
            )}
            {p.settingsBase && (
              <div className="note">
                <div>
                  <b>承認すると設定も更新します</b>
                  <ul>
                    {settingChanges(p.settingsBase, displaySettings).map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ul>
                  <small>破棄すると現在の設定と計画を保ちます。実績は変更しません。</small>
                </div>
              </div>
            )}
            <div className="metrics compact-metrics">
              <div>
                <span>これからの予定</span>
                <strong>
                  {plan.sessions
                    .filter((s) => s.date >= plan.from && s.kind === 'study')
                    .reduce((n, s) => n + s.count, 0)}
                  <small>問</small>
                </strong>
              </div>
              <div>
                <span>未配置の課題</span>
                <strong>
                  {plan.shortfalls.reduce((n, s) => n + s.count, 0)}
                  <small>問</small>
                </strong>
              </div>
              <div>
                <span>不足する学習量</span>
                <strong>{duration(plan.shortfalls.reduce((n, s) => n + s.minutes, 0))}</strong>
              </div>
            </div>
            {plan.conflicts.length > 0 && (
              <section className="confirmation-panel" aria-label="計画エラーの修正">
                <h3 ref={conflictsHeading} tabIndex={-1} className="approval-target">
                  計画を承認する前に、確認してください
                </h3>
                {plan.conflicts.map((message) => {
                  const problem = timeProblems.find(
                    (x) => x.message === message || x.legacy === message,
                  );
                  const historical = plan.sessions.find(
                    (s) =>
                      s.date === plan.from &&
                      s.start < (plan.notBefore ?? 0) &&
                      message ===
                        `${s.date} ${s.start / 60}時の固定予定が現在の学習可能枠に収まりません。`,
                  );
                  return (
                    <div className="plan-conflict" key={message}>
                      <p>
                        {historical
                          ? `${historical.date} ${clock(historical.start)}〜${clock(historical.end)}は開始済みの予定です。過去の予定を残して案を更新できます。`
                          : (problem?.message ?? message)}
                      </p>
                      {!historical && (
                        <div className="actions">
                          <button onClick={() => void repair(problem?.issue)}>条件を修正</button>
                          {problem && (
                            <button
                              onClick={() =>
                                void act((s) => releaseFixedAndRefresh(s, problem.session.id))
                              }
                            >
                              固定を解除して案を更新
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                <button onClick={() => void act((s) => refreshProposal(s))}>
                  今の時刻で案を更新
                </button>
              </section>
            )}
            {plan.shortfalls.length > 0 && (
              <Warning
                id="replan-1"
                title="条件内に収まらない課題があります"
                version={plan.shortfalls}
              >
                <h3>条件内に収まらない課題があります</h3>
                {plan.shortfalls.map((x) => (
                  <p key={`${x.materialId}-${x.round}`}>
                    {displaySettings.materials.find((m) => m.id === x.materialId)?.name} ·{' '}
                    {x.round + 1}周目：{x.count}問（{duration(x.minutes)}）
                    <small className="block">{x.reason}</small>
                  </p>
                ))}
                <p>
                  期限・学習可能枠・教材の量などを見直すか、不足を残したまま配置できた分を承認できます。
                </p>
              </Warning>
            )}
            {p.unreported.length > 0 && (
              <div className="confirmation-panel">
                <h3 ref={unreportedHeading} tabIndex={-1} className="approval-target">
                  未報告の予定を確認してください
                </h3>
                <p>
                  未報告を0問の実績には変換しません。実際に進めていた場合は先に記録してください。
                </p>
                <ul>
                  {p.unreported.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
                <label className="check">
                  <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                  未報告は記録を保留したまま、現在の残数を今後の枠へ再配置する
                </label>
                {ack && (
                  <div className="actions">
                    <button onClick={() => reveal(approveButton.current)}>承認操作へ戻る</button>
                  </div>
                )}
              </div>
            )}
          </section>
          <PlanInsights state={state} plan={plan} preview />
          <section className="card">
            <h3>変更内容</h3>
            <p className="hint">過去の予定と固定した予定を保持し、残りの学習日へ分散します。</p>
            {keys.length ? (
              <table>
                <thead>
                  <tr>
                    <th>日付 / 教材 / 周回</th>
                    <th>承認前</th>
                    <th></th>
                    <th>変更案</th>
                  </tr>
                </thead>
                <tbody>
                  {keys.map((k) => (
                    <tr key={k}>
                      <td>{label(k)}</td>
                      <td>{old.get(k) || 0}問</td>
                      <td>
                        <ArrowRight size={15} />
                      </td>
                      <td>{next.get(k) || 0}問</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p>
                問題数の変更はありません。設定の変更による時刻・復習枠の差も、以下で確認できます。
              </p>
            )}
            <details>
              <summary>時刻・復習を含む差分（{detailedChanges.length}件）</summary>
              <table>
                <thead>
                  <tr>
                    <th>変更</th>
                    <th>日付・時刻</th>
                    <th>内容</th>
                  </tr>
                </thead>
                <tbody>
                  {detailedChanges.map(({ s, change }, i) => (
                    <tr key={`${s.id}-${change}-${i}`}>
                      <td>{change}</td>
                      <td>
                        {s.date} {clock(s.start)}–{clock(s.end)}
                      </td>
                      <td>
                        {displaySettings.exams.find((e) => e.id === s.examId)?.name} /{' '}
                        {s.kind === 'review'
                          ? 'まとめの復習'
                          : `${displaySettings.materials.find((m) => m.id === s.materialId)?.name} ${s.round + 1}周目 ${s.count}問`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
            <details>
              <summary>変更案の時刻・固定・復習枠を確認</summary>
              <table>
                <thead>
                  <tr>
                    <th>日付</th>
                    <th>時間</th>
                    <th>内容</th>
                    <th>固定</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.sessions
                    .filter((s) => s.date >= plan.from)
                    .map((s) => (
                      <tr key={s.id}>
                        <td>{s.date}</td>
                        <td>
                          {Math.floor(s.start / 60)}:
                          {String(Math.floor(s.start % 60)).padStart(2, '0')}–
                          {Math.floor(s.end / 60)}:{String(Math.floor(s.end % 60)).padStart(2, '0')}
                        </td>
                        <td>
                          {s.kind === 'review'
                            ? `${displaySettings.exams.find((e) => e.id === s.examId)?.name} 復習`
                            : `${displaySettings.materials.find((m) => m.id === s.materialId)?.name} ${s.count}問`}
                        </td>
                        <td>{s.fixed ? '固定' : ''}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </details>
          </section>
        </>
      )}
    </>
  );
}
