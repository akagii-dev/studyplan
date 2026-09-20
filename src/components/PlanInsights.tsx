import { Warning } from './Warnings';
import { useMemo } from 'react';
import { AppState, Plan, addDays, remaining, today } from '../domain/model';
import { datesBetween, generatePlan, capacityForWeek } from '../domain/planning';
import { startOfWeek } from '../domain/calendar';
import { dateTime } from '../domain/planAudit';
import { duration } from './common';
import { PLAN_CALCULATION_VERSION, sessionPolicy } from '../domain/sessionPolicy';

export function PlanInsights({
  state,
  plan,
  preview = false,
}: {
  state: AppState;
  plan: Plan;
  preview?: boolean;
}) {
  const settings = plan.settingsSnapshot;
  const reference = useMemo(() => {
    if (!preview || !settings) return null;
    const when = new Date(plan.createdAt);
    const minute =
      plan.notBefore ?? (plan.from === today() ? when.getHours() * 60 + when.getMinutes() : 0);
    try {
      return generatePlan(
        { ...state, settings: { ...settings, buffer: 0 } },
        plan.from,
        true,
        minute,
        'earliest',
      );
    } catch {
      return null;
    }
  }, [preview, settings, plan.id, state.records, state.plan]);
  const last = plan.capacities.at(-1)?.date ?? plan.from;
  const days = datesBetween(plan.from, last);
  const weeks = useMemo(() => {
    if (!settings || (plan.calculationVersion ?? 0) < 7) return [];
    return [...new Set(days.map(startOfWeek))].map((date) =>
      capacityForWeek(settings, date, plan.sessions),
    );
  }, [plan, settings]);
  return (
    <section className="card plan-insights" aria-label="計画の条件と一日の問題数">
      <h3>計画の条件</h3>
      <p>
        計画作成：{dateTime(plan.createdAt)}
        <br />
        使用した設定の最終更新：{dateTime(plan.settingsUpdatedAt)}
      </p>
      {plan.calculationVersion !== PLAN_CALCULATION_VERSION && (
        <Warning id="planinsights-0" title="以前の計算方式の計画です" version={plan.id}>
          以前の計算方式で保存した計画です。現在の計算条件（所要時間・通学など）で案を作り直せます。再計画で確認してください。
        </Warning>
      )}
      {settings ? (
        <>
          <div className="note">
            連続で最長 {duration(settings.block)} ／ 休憩 {duration(settings.rest)} ／ 授業前後 各
            {duration(settings.classTransition ?? 0)} ／{' '}
            {(plan.calculationVersion ?? 0) >= 7 ? '週の余裕率' : '余裕率'}{' '}
            {Math.round(settings.buffer * 100)}%
            {(plan.calculationVersion ?? 0) >= 6 && ' ／ 授業間10分以下は移動時間'}
          </div>
          <p>計画開始：{plan.from}。目標日当日は通常教材を割り当てません。</p>
          {weeks.length > 0 && (
            <details>
              <summary>週全体の割当上限を確認</summary>
              <p>
                月〜日の学習可能時間に余裕率を適用します。固定・保持予定と復習も含めて共有し、日ごとの余裕時間は予約しません。
              </p>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>週</th>
                      <th>学習可能時間</th>
                      <th>割当上限</th>
                      <th>予定済み</th>
                      <th>未割当容量</th>
                    </tr>
                  </thead>
                  <tbody>
                    {weeks.map((w) => (
                      <tr key={w.from}>
                        <td>
                          {w.from}〜{w.to}
                        </td>
                        <td>{duration(w.focus)}</td>
                        <td>{duration(w.limit)}</td>
                        <td>{duration(w.used)}</td>
                        <td>{duration(w.unallocated)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
          {settings.commute?.enabled && (
            <p>
              通学：{settings.commute.from}〜{settings.commute.to} ／{' '}
              {settings.commute.mode === 'classDays'
                ? '授業日のみ'
                : settings.commute.weekdays
                    .map((d) => ['日', '月', '火', '水', '木', '金', '土'][d])
                    .join('・')}{' '}
              ／ 往路 {settings.commute.outboundMinutes}分・復路 {settings.commute.returnMinutes}分
            </p>
          )}
          {plan.calculationVersion === PLAN_CALCULATION_VERSION && (
            <p>
              予定の下限 {sessionPolicy(settings).minimum}分 ／ まとまりの目安{' '}
              {sessionPolicy(settings).preferred}分
            </p>
          )}
          {preview && (
            <div className="buffer-reference">
              <h3>バッファーなし（余裕率0%）なら、いつ終わる？</h3>
              <p>余裕率だけを0%にした参考日です。現在の計画は変わりません。</p>
              <table>
                <thead>
                  <tr>
                    <th>試験 / 学習期間</th>
                    <th>通常計画の教材終了予定</th>
                    <th>余裕率0%の参考終了日</th>
                  </tr>
                </thead>
                <tbody>
                  {settings.exams.map((e) => {
                    const ms = settings.materials.filter((m) => m.examId === e.id);
                    const need = ms.reduce(
                      (n, m) =>
                        n +
                        m.rounds.reduce(
                          (a, _, i) => a + remaining({ ...state, settings }, m.id, i),
                          0,
                        ),
                      0,
                    );
                    const finish = (p: Plan | null) => {
                      if (!ms.length) return '教材が未登録';
                      if (!need) return '完了済み';
                      if (!p) return '算出できません';
                      if (p.conflicts.length) return '固定予定・復習枠の競合を確認';
                      const shortage = p.shortfalls
                        .filter((x) => ms.some((m) => m.id === x.materialId))
                        .reduce((n, x) => n + x.count, 0);
                      return shortage
                        ? `期限内に未配置 ${shortage}問`
                        : (p.sessions
                            .filter(
                              (x) => x.examId === e.id && x.kind === 'study' && x.date >= p.from,
                            )
                            .at(-1)?.date ?? '対象なし');
                    };
                    return (
                      <tr key={e.id}>
                        <td>
                          {e.name}
                          <small className="block">
                            {e.start}〜{addDays(e.target, -e.reviewDays - 1)}
                            <br />
                            目標 {e.target} ／ 別枠の復習 {e.reviewDays}日
                          </small>
                        </td>
                        <td>{finish(plan)}</td>
                        <td>{finish(reference)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <details>
            <summary>適用期間・授業・予定を確認</summary>
            {settings.windows.map((w) => (
              <p key={w.id}>
                {w.kind === 'study'
                  ? '学習可能枠'
                  : w.kind === 'class'
                    ? '授業・学習不可'
                    : '定期予定・学習不可'}
                ：{w.name} ／ {w.from}〜{w.to}
              </p>
            ))}
          </details>
        </>
      ) : (
        <Warning id="planinsights-1" title="計画に使用した設定の記録がありません" version={plan.id}>
          この計画は旧バージョンで作成され、使用した設定の記録がありません。現在の設定で計画案を作成すると記録されます。
        </Warning>
      )}
      <details open={preview}>
        <summary>一日の予定問題数（全試験で共有）</summary>
        <div
          className="daily-plan-table"
          role="region"
          aria-label="一日の予定問題数の表"
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                <th>日付</th>
                <th>合計</th>
                <th>試験ごとの問題数</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => {
                const sessions = plan.sessions.filter((x) => x.date === d && x.kind === 'study');
                return (
                  <tr key={d}>
                    <td>{d}</td>
                    <td>{sessions.reduce((n, x) => n + x.count, 0)}問</td>
                    <td>
                      {(settings ?? state.settings).exams
                        .map((e) => ({
                          name: e.name,
                          count: sessions
                            .filter((x) => x.examId === e.id)
                            .reduce((n, x) => n + x.count, 0),
                        }))
                        .filter((x) => x.count)
                        .map((x) => `${x.name} ${x.count}問`)
                        .join(' ／ ') || '通常教材の予定なし'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <small>これは予定の問題数です。0問の実績や未報告とは別に表示しています。</small>
      </details>
    </section>
  );
}
