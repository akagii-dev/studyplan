import { AppState, addDays, weekday } from './model';
import { startOfWeek } from './calendar';
import { stalePlan } from './planAudit';
import { studyCoverageGaps, StudyCoverageGap, isLongTermStudyGap } from './studyCoverage';
import { originalSessionCount } from './progressReflection';

export interface ReportProgress {
  total: number;
  done: number;
  remaining: number;
  weekPlanned: number;
  weekDone: number;
  recordCount: number;
}
export interface WeeklyReport {
  from: string;
  to: string;
  asOf: string;
  generatedAt: string;
  totals: ReportProgress;
  recordCount: number;
  exams: (ReportProgress & { name: string; target: string })[];
  rounds: (ReportProgress & { exam: string; material: string; round: number })[];
  days: { date: string; planned: number; done: number | null; status: string }[];
  unreported: { date: string; material: string; round: number; planned: number }[];
  hasPlan: boolean;
  planCreatedAt: string | null;
  settingsChanged: boolean;
  studyCoverageGaps: StudyCoverageGap[];
  longTermStudyWarning: boolean;
  markdown: string;
  filename: string;
}
export const reportRate = (value: number, total: number) =>
  total > 0 ? `${((value / total) * 100).toFixed(1)}%` : '—';
const validDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
};
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const aggregate = (rows: ReportProgress[]): ReportProgress => ({
  total: sum(rows.map((r) => r.total)),
  done: sum(rows.map((r) => r.done)),
  remaining: sum(rows.map((r) => r.remaining)),
  weekPlanned: sum(rows.map((r) => r.weekPlanned)),
  weekDone: sum(rows.map((r) => r.weekDone)),
  recordCount: sum(rows.map((r) => r.recordCount)),
});
const cell = (text: string) =>
  text
    // eslint-disable-next-line no-control-regex -- Keep control characters out of Markdown table cells.
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\\`*_[\]{}()#+.!|~-]/g, '\\$&');

/** The overall denominator is the current material configuration, not a historical snapshot. */
export function createWeeklyReport(
  state: AppState,
  selectedDate: string,
  now = new Date(),
): WeeklyReport {
  if (!validDate(selectedDate) || !Number.isFinite(now.getTime()))
    throw new Error('レポートの対象日を選んでください。');
  const pad = (n: number) => String(n).padStart(2, '0');
  const asOf = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  if (selectedDate > asOf) throw new Error('今日以前の日付を選んでください。');
  const from = startOfWeek(selectedDate),
    to = addDays(from, 6);
  if (!validDate(from) || !validDate(to)) throw new Error('この週の日付は書き出せません。');
  const inWeek = (date: string) => date >= from && date <= to;
  const records = state.records.filter((r) => !r.cancelled && r.date <= asOf);
  const weekly = records.filter((r) => inWeek(r.date));
  const sessions = (state.plan?.sessions ?? []).filter(
    (s) => s.kind === 'study' && originalSessionCount(state.plan, s) > 0 && inWeek(s.date),
  );
  const rounds = state.settings.materials.flatMap((m) =>
    m.rounds.map((r, round) => {
      const done =
        r.completed +
        sum(records.filter((x) => x.materialId === m.id && x.round === round).map((x) => x.count));
      return {
        materialId: m.id,
        examId: m.examId,
        exam: state.settings.exams.find((e) => e.id === m.examId)?.name ?? '',
        material: m.name,
        round: round + 1,
        total: m.total,
        done,
        remaining: m.total - done,
        weekPlanned: sum(
          sessions
            .filter((x) => x.materialId === m.id && x.round === round)
            .map((x) => originalSessionCount(state.plan, x)),
        ),
        weekDone: sum(
          weekly.filter((x) => x.materialId === m.id && x.round === round).map((x) => x.count),
        ),
        recordCount: weekly.filter((x) => x.materialId === m.id && x.round === round).length,
      };
    }),
  );
  const exams = state.settings.exams.map((e) => ({
    name: e.name,
    target: e.target,
    ...aggregate(rounds.filter((r) => r.examId === e.id)),
    weekPlanned: sum(
      sessions.filter((s) => s.examId === e.id).map((s) => originalSessionCount(state.plan, s)),
    ),
  }));
  const totals = aggregate(rounds);
  totals.weekPlanned = sum(sessions.map((s) => originalSessionCount(state.plan, s)));
  const key = (r: { date: string; materialId: string; round: number }) =>
    JSON.stringify([r.date, r.materialId, r.round]);
  const groups = new Map<
    string,
    { date: string; material: string; round: number; planned: number; started: boolean }
  >();
  for (const s of sessions) {
    const old = groups.get(key(s));
    groups.set(key(s), {
      date: s.date,
      material:
        state.settings.materials.find((m) => m.id === s.materialId)?.name ??
        state.plan?.settingsSnapshot?.materials.find((m) => m.id === s.materialId)?.name ??
        '教材',
      round: s.round + 1,
      planned: (old?.planned ?? 0) + originalSessionCount(state.plan, s),
      started:
        !!old?.started ||
        s.date < asOf ||
        (s.date === asOf && s.start <= now.getHours() * 60 + now.getMinutes()),
    });
  }
  const reportedKeys = new Set(weekly.map(key));
  const unreported = [...groups]
    .filter(([k, g]) => g.started && !reportedKeys.has(k))
    .map(([, g]) => g)
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) || a.material.localeCompare(b.material) || a.round - b.round,
    );
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(from, i);
    const dayRecords = weekly.filter((r) => r.date === date);
    const dayGroups = [...groups].filter(([, g]) => g.date === date);
    const zeroKeys = new Set(dayRecords.map(key));
    const zero = [...zeroKeys].filter(
      (k) => sum(dayRecords.filter((r) => key(r) === k).map((r) => r.count)) === 0,
    ).length;
    const missing = unreported.filter((g) => g.date === date).length;
    const future = dayGroups.filter(([k, g]) => !g.started && !reportedKeys.has(k)).length;
    const states = [
      dayRecords.some((r) => r.count > 0) ? '記録あり' : '',
      zero ? `0問報告 ${zero}件` : '',
      missing ? `未報告 ${missing}件` : '',
      future ? `これから ${future}件` : '',
    ].filter(Boolean);
    return {
      date,
      planned: sum(dayGroups.map(([, g]) => g.planned)),
      done: dayRecords.length ? sum(dayRecords.map((r) => r.count)) : null,
      status: states.join('・') || (date > asOf ? 'これから' : '予定・記録なし'),
    };
  });
  const report: WeeklyReport = {
    from,
    to,
    asOf,
    generatedAt: `${asOf} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
    totals,
    recordCount: weekly.length,
    exams,
    rounds,
    days,
    unreported,
    hasPlan: !!state.plan,
    planCreatedAt: state.plan?.createdAt ?? null,
    settingsChanged: stalePlan(state.plan, state.settings),
    studyCoverageGaps: state.plan?.settingsSnapshot
      ? studyCoverageGaps(state.plan.settingsSnapshot, asOf)
      : [],
    longTermStudyWarning:
      !!state.plan?.settingsSnapshot &&
      studyCoverageGaps(state.plan.settingsSnapshot, asOf).some((g) =>
        isLongTermStudyGap(state.plan!.settingsSnapshot!, g, asOf),
      ),
    markdown: '',
    filename: `StudyPlan-weekly-${from}.md`,
  };
  report.markdown = renderWeeklyReport(report);
  return report;
}

function renderWeeklyReport(r: WeeklyReport) {
  const t = r.totals;
  const lines = [
    '# StudyPlan 週間レポート',
    '',
    `対象週：${r.from}〜${r.to}（月曜〜日曜）`,
    `出力日時：${r.generatedAt}（端末の現地時刻）`,
    '',
    '## 週間の実績と全体の進捗',
    '',
    '| 指標 | 値 |',
    '| --- | --- |',
    `| 週間の追加完了数 | ${r.recordCount ? `${t.weekDone}問` : '記録なし'} |`,
    `| 週間の学習予定 | ${r.hasPlan ? `${t.weekPlanned}問` : '計画なし'} |`,
    `| 週間予定に対する記録割合 | ${r.recordCount ? reportRate(t.weekDone, t.weekPlanned) : '—'} |`,
    `| 全体の完了数（出力時点） | ${t.done} / ${t.total}問 |`,
    `| 全体の進捗率（出力時点） | ${reportRate(t.done, t.total)} |`,
    `| 全体の残り | ${t.remaining}問 |`,
    `| この週の記録が全体の総問題数に占める割合 | ${r.recordCount ? reportRate(t.weekDone, t.total) : '—'} |`,
    '',
    '全体は現在の教材・周回数と初期設定の完了数を含みます。過去の週を選んでも、全体の進捗は出力時点です。',
    '週間実績は記録対象日で集計し、訂正を反映・取消を除外します。未報告は0問として確定しません。',
    '',
    '## 試験ごとの比較',
    '',
    '| 試験 | 目標日 | 週の予定 | 週の記録 | 全体の完了 / 総数 | 全体の進捗 | 残り |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: |',
    ...r.exams.map(
      (e) =>
        `| ${cell(e.name)} | ${e.target} | ${e.weekPlanned}問 | ${e.recordCount ? `${e.weekDone}問` : '記録なし'} | ${e.done} / ${e.total}問 | ${reportRate(e.done, e.total)} | ${e.remaining}問 |`,
    ),
    '',
    '## 教材・周回ごとの進捗',
    '',
    '| 試験 | 教材 | 周回 | 週の記録 | 全体の完了 / 総数 | 残り |',
    '| --- | --- | ---: | ---: | ---: | ---: |',
    ...r.rounds.map(
      (m) =>
        `| ${cell(m.exam)} | ${cell(m.material)} | ${m.round}周目 | ${m.recordCount ? `${m.weekDone}問` : '記録なし'} | ${m.done} / ${m.total}問 | ${m.remaining}問 |`,
    ),
    '',
    '## 日別の予定・実績',
    '',
    '| 日付 | 予定問題数 | 追加完了数 | 報告状態 |',
    '| --- | ---: | ---: | --- |',
    ...r.days.map(
      (d) =>
        `| ${d.date}（${'日月火水木金土'[weekday(d.date)]}） | ${d.planned}問 | ${d.done === null ? '—（記録なし）' : `${d.done}問`} | ${d.status} |`,
    ),
    '',
    '## 未報告の予定',
    '',
    ...(r.unreported.length
      ? r.unreported.map(
          (g) => `- ${g.date}：${cell(g.material)}・${g.round}周目（当日予定 ${g.planned}問）`,
        )
      : ['開始時刻を過ぎた学習予定に未報告はありません。']),
    '',
    '同じ日・教材・周回の予定はまとめて判定します。これから始まる予定は未報告に含めません。',
    '',
    '## 集計に使った計画',
    '',
    r.hasPlan
      ? `承認済み計画の作成日時：${r.planCreatedAt}。出力時点で保存されている計画を使用しています。`
      : '承認済みの計画はありません。記録と全体の進捗のみを集計しています。',
    ...(r.settingsChanged
      ? [
          '注意：現在の設定と承認済み計画が一致していません。週間予定と全体の総問題数は異なる条件に基づきます。',
        ]
      : []),
    ...(r.studyCoverageGaps.length
      ? [
          '',
          '### 学習枠の未登録期間（承認済み計画の設定）',
          '',
          ...r.studyCoverageGaps.map((g) => `- ${cell(g.examName)}：${g.from}〜${g.to}`),
          '',
          'この期間は計算から除外され、登録済みの期間に学習が集中します。春休みなどの学習枠を追加し、再計画で確認してください。',
          '',
        ]
      : []),
    ...(r.longTermStudyWarning
      ? [
          '長期計画の一部が未設定です。登録済みの枠だけで全周回を配置するため、学習枠・周回数・目標日を見直してください。',
          '',
        ]
      : []),
    '承認待ち案は含めません。週の開始時点の計画を復元した比較ではありません。問題数のない別枠の復習は予定問題数に含めません。',
    '割合は問題数ベースです。教材ごとの難しさ・所要時間の差や、実際の学習時間は表しません。',
    '',
  ];
  return lines.join('\n');
}
