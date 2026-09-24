import { AppState, addDays, weekday, today, completed } from './model';
import { startOfWeek } from './calendar';
import { stalePlan } from './planAudit';
import { studyCoverageGaps, StudyCoverageGap, isLongTermStudyGap } from './studyCoverage';
import { calendarQuantity, materialUnit } from './calendarQuantity';
import { progressView } from './progressView';

export interface ReportProgress {
  unit: string;
  total: number;
  done: number;
  remaining: number;
  weekPlanned: number | null;
  weekDone: number;
  recordCount: number;
}
export interface WeeklyReport {
  from: string;
  to: string;
  asOf: string;
  generatedAt: string;
  totals: ReportProgress[];
  recordCount: number;
  exams: (ReportProgress & { name: string; target: string })[];
  rounds: (ReportProgress & { exam: string; material: string; round: number })[];
  days: {
    date: string;
    quantities: ReturnType<typeof calendarQuantity>['totals'];
    status: string;
  }[];
  unreported: {
    date: string;
    material: string;
    round: number;
    planned: number | null;
    unit: string;
  }[];
  hasPlan: boolean;
  hasWeekPlan: boolean;
  planCreatedAt: string | null;
  settingsChanged: boolean;
  studyCoverageGaps: StudyCoverageGap[];
  longTermStudyWarning: boolean;
  markdown: string;
  filename: string;
}
export function dailyReportDetails(state: AppState, date: string, reference = today()) {
  return calendarQuantity(state, date, reference)
    .rows.map((row) => ({
      ...row,
      done: row.reported ? row.actual : null,
      progress: progressView(row, date, reference),
    }))
    .sort((a, b) => a.materialId.localeCompare(b.materialId) || a.round - b.round);
}
export const reportRate = (value: number, total: number | null) =>
  total !== null && total > 0 ? `${((value / total) * 100).toFixed(1)}%` : '—';
const validDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
};
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const nullableSum = (values: (number | null)[]) =>
  values.some((v) => v === null) ? null : sum(values as number[]);
const aggregate = (rows: ReportProgress[], unit: string): ReportProgress => ({
  unit,
  total: sum(rows.map((r) => r.total)),
  done: sum(rows.map((r) => r.done)),
  remaining: sum(rows.map((r) => r.remaining)),
  weekPlanned: nullableSum(rows.map((r) => r.weekPlanned)),
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
  const current = { ...state, records };
  const quantities = Array.from({ length: 7 }, (_, i) =>
    calendarQuantity(current, addDays(from, i), asOf),
  );
  const weekRows = quantities.flatMap((day) => day.rows.map((row) => ({ ...row, date: day.date })));
  const rounds = state.settings.materials.flatMap((m) =>
    m.rounds.map((_, round) => {
      const unit = materialUnit(m.unit);
      const matching = weekRows.filter(
        (row) => row.materialId === m.id && row.round === round && row.unit === unit,
      );
      const done = completed(current, m.id, round);
      return {
        materialId: m.id,
        examId: m.examId,
        exam: state.settings.exams.find((e) => e.id === m.examId)?.name ?? '',
        material: m.name,
        round: round + 1,
        unit,
        total: m.total,
        done,
        remaining: m.total - done,
        weekPlanned: nullableSum(matching.map((row) => row.planned)),
        weekDone: sum(matching.map((row) => row.actual)),
        recordCount: weekly.filter((r) =>
          matching.some(
            (row) =>
              row.date === r.date && row.materialId === r.materialId && row.round === r.round,
          ),
        ).length,
      };
    }),
  );
  const units = [...new Set([...rounds.map((r) => r.unit), ...weekRows.map((r) => r.unit)])];
  const totals = units.map((unit) => ({
    ...aggregate(
      rounds.filter((r) => r.unit === unit),
      unit,
    ),
    weekPlanned: nullableSum(weekRows.filter((r) => r.unit === unit).map((r) => r.planned)),
    weekDone: sum(weekRows.filter((r) => r.unit === unit).map((r) => r.actual)),
    recordCount: weekly.filter((r) =>
      weekRows.some(
        (row) =>
          row.unit === unit &&
          row.materialId === r.materialId &&
          row.round === r.round &&
          row.date === r.date,
      ),
    ).length,
  }));
  const exams = state.settings.exams.flatMap((e) =>
    units
      .filter(
        (unit) =>
          rounds.some((r) => r.examId === e.id && r.unit === unit) ||
          weekRows.some((r) => r.examId === e.id && r.unit === unit),
      )
      .map((unit) => ({
        name: e.name,
        target: e.target,
        ...aggregate(
          rounds.filter((r) => r.examId === e.id && r.unit === unit),
          unit,
        ),
        weekPlanned: nullableSum(
          weekRows.filter((r) => r.examId === e.id && r.unit === unit).map((r) => r.planned),
        ),
        weekDone: sum(
          weekRows.filter((r) => r.examId === e.id && r.unit === unit).map((r) => r.actual),
        ),
        recordCount: weekly.filter((r) =>
          weekRows.some(
            (row) =>
              row.examId === e.id &&
              row.unit === unit &&
              row.materialId === r.materialId &&
              row.round === r.round &&
              row.date === r.date,
          ),
        ).length,
      })),
  );
  const unreported = weekRows
    .filter(
      (row) =>
        progressView(row, row.date, asOf).reportStatus === 'unreported' &&
        (row.planned === null || row.planned > 0),
    )
    .map((row) => ({
      date: row.date,
      material: row.name,
      round: row.round + 1,
      planned: row.planned,
      unit: row.unit,
    }));
  const days = quantities.map((day) => {
    const views = day.rows.map((row) => progressView(row, day.date, asOf));
    const missing = views.filter((v) => v.reportStatus === 'unreported').length;
    const zero = views.filter((v) => v.hasReport && v.actual === 0).length;
    const states = [
      views.some((v) => v.hasReport && v.actual > 0) ? '記録あり' : '',
      zero ? `0実績報告 ${zero}件` : '',
      missing ? `未報告 ${missing}件` : '',
      day.date > asOf && views.length ? 'これから' : '',
    ].filter(Boolean);
    return {
      date: day.date,
      quantities: day.totals,
      status: states.join('・') || '予定・記録なし',
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
    hasWeekPlan: quantities.some((day) => day.known),
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
  const amounts = (value: number | null, unit: string) =>
    value === null ? '—' : `${value}${cell(unit)}`;
  const all = (format: (t: ReportProgress) => string, empty = '—') =>
    r.totals
      .map((t) => `${r.totals.length > 1 ? `${cell(t.unit)}：` : ''}${format(t)}`)
      .join(' / ') || empty;
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
    `| 週間の追加完了数 | ${all((t) => (t.recordCount ? amounts(t.weekDone, t.unit) : '記録なし'), '記録なし')} |`,
    `| 週間の学習予定 | ${r.hasWeekPlan ? all((t) => amounts(t.weekPlanned, t.unit)) : '—'} |`,
    `| 週間予定に対する記録割合 | ${all((t) => (t.recordCount ? reportRate(t.weekDone, t.weekPlanned) : '—'))} |`,
    `| 全体の完了数（出力時点） | ${all((t) => `${t.done} / ${t.total}${cell(t.unit)}`)} |`,
    `| 全体の進捗率（出力時点） | ${all((t) => reportRate(t.done, t.total))} |`,
    `| 全体の残り | ${all((t) => amounts(t.remaining, t.unit))} |`,
    `| この週の記録が全体の総量に占める割合 | ${all((t) => (t.recordCount ? reportRate(t.weekDone, t.total) : '—'))} |`,
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
        `| ${cell(e.name)} | ${e.target} | ${amounts(e.weekPlanned, e.unit)} | ${e.recordCount ? `${e.weekDone}${cell(e.unit)}` : '記録なし'} | ${e.done} / ${e.total}${cell(e.unit)} | ${reportRate(e.done, e.total)} | ${e.remaining}${cell(e.unit)} |`,
    ),
    '',
    '## 教材・周回ごとの進捗',
    '',
    '| 試験 | 教材 | 周回 | 週の記録 | 全体の完了 / 総数 | 残り |',
    '| --- | --- | ---: | ---: | ---: | ---: |',
    ...r.rounds.map(
      (m) =>
        `| ${cell(m.exam)} | ${cell(m.material)} | ${m.round}周目 | ${m.recordCount ? `${m.weekDone}${cell(m.unit)}` : '記録なし'} | ${m.done} / ${m.total}${cell(m.unit)} | ${m.remaining}${cell(m.unit)} |`,
    ),
    '',
    '## 日別の予定・実績',
    '',
    '| 日付 | 実績 / 予定 | 報告状態 |',
    '| --- | --- | --- |',
    ...r.days.map(
      (d) =>
        `| ${d.date}（${'日月火水木金土'[weekday(d.date)]}） | ${
          d.quantities
            .map((q) => {
              const view = progressView(q, d.date, r.asOf);
              return cell([view.text, view.supplement].filter(Boolean).join(' '));
            })
            .join(' · ') || '—'
        } | ${d.status} |`,
    ),
    '',
    '## 未報告の予定',
    '',
    ...(r.unreported.length
      ? r.unreported.map(
          (g) =>
            `- ${g.date}：${cell(g.material)}・${g.round}周目（当日予定 ${amounts(g.planned, g.unit)}）`,
        )
      : ['対象期間の過去・今日の予定に未報告はありません。']),
    '',
    '同じ日・教材・周回の予定はまとめて判定します。未来の日の予定は未報告に含めません。',
    '',
    '## 集計に使った計画',
    '',
    r.hasPlan
      ? `承認済み計画の作成日時：${r.planCreatedAt}。保存済みの日別予定・確定計画・履歴を使用しています。`
      : r.hasWeekPlan
        ? '保存済みの日別予定・計画履歴と実績を集計しています。'
        : 'この週の元の予定を取得できません。実績のみを表示します。',
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
    '承認待ち案は含めません。取得できない元の予定量は「—」で表示します。問題数のない別枠の復習は予定問題数に含めません。',
    '割合は同じ単位の数量ベースです。異なる単位は合算しません。教材ごとの難しさ・所要時間の差や、実際の学習時間は表しません。',
    '',
  ];
  return lines.join('\n');
}
