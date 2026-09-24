import { useState } from 'react';
import { Props } from '../components/common';
import { warningVersion } from '../components/Warnings';
import { AppState, mealKeys, mealNames } from '../domain/model';
import { validateSettings } from '../domain/planning';
import {
  answerSchedule,
  scheduleCount,
  scheduleInfo,
  scheduleKinds,
  scheduleStatus,
  setupIssues,
} from '../domain/setupIssues';
import { demoMode } from '../demo';
import { pwaMode } from '../pwa';
import { PwaStatus } from '../components/PwaStatus';
import { Page } from './navigation';

export type AvailabilityTarget = 'study' | 'busy' | 'class' | 'exception' | 'meals';

const sections: { title: string; pages: { page: Page; label: string }[] }[] = [
  {
    title: 'その他の設定',
    pages: [
      { page: 'setup', label: '初期設定' },
      { page: 'focus', label: '連続時間・余裕率' },
      { page: 'commute', label: '通学時間' },
    ],
  },
  {
    title: '確認・管理',
    pages: [
      { page: 'today', label: '今日の時間内訳' },
      { page: 'replan', label: '計画案の確認' },
      { page: 'report', label: '週間レポート' },
      { page: 'warnings', label: '通知の管理' },
      { page: 'tutorial', label: '使い方' },
      { page: 'backup', label: 'バックアップ' },
    ],
  },
];

export function SettingsHub({
  state,
  update,
  navigate,
  addExam,
  addMaterial,
  editItem,
  openAvailability,
  generate,
}: Props & {
  navigate: (page: Page) => void;
  addExam: () => void;
  addMaterial: () => void;
  editItem: (kind: 'exam' | 'material', id: string) => void;
  openAvailability: (target: AvailabilityTarget, windowId?: string) => void;
  generate: () => void;
}) {
  const [attempted, setAttempted] = useState(false);
  const issues = setupIssues(state.settings);
  const missing = issues.filter((issue) => issue.severity === 'error');
  const validationErrors = validateSettings(state.settings);
  const missingMeals = mealKeys.filter((key) => !state.settings.meals?.[key]);
  const gaps = issues.filter((issue) => issue.studyGap);
  const warningFor = (id: string) => issues.find((entry) => entry.id === id);
  const hidden = (id: string) => {
    const issue = warningFor(id);
    return !!issue && state.ignoredWarnings?.[`setup-${id}`]?.version === warningVersion(issue);
  };
  const checkAndGenerate = () => {
    setAttempted(true);
    if (missing.length || validationErrors.length) {
      document.getElementById('settings-plan-check')?.scrollIntoView({ block: 'start' });
      return;
    }
    generate();
  };
  const setScheduleNone = (kind: (typeof scheduleKinds)[number]) =>
    void update((current) => answerSchedule(current, kind, 'none')).catch(() => {});
  const studyCount = state.settings.windows.filter((window) => window.kind === 'study').length;
  const invalidExam = state.settings.exams.find((exam) =>
    validationErrors.some((message) => message.startsWith(`${exam.name || '試験'}：`)));
  const invalidMaterial = state.settings.materials.find((material) =>
    validationErrors.some((message) => message.startsWith(`${material.name || '教材'}：`)));
  const invalidStudy = state.settings.windows.find((window) => window.kind === 'study' &&
    validationErrors.some((message) => message.startsWith(`${window.name}：`)));
  const readyCount = Number(!!state.settings.exams.length && !invalidExam) +
    Number(!!state.settings.materials.length && !invalidMaterial) +
    Number(!!studyCount && !invalidStudy);
  const attentionCount = Number(!!missingMeals.length) +
    scheduleKinds.filter((kind) => ['unknown', 'deferred'].includes(scheduleStatus(state.settings, kind))).length +
    gaps.length;
  const fixValidation = (message: string) => {
    const exam = state.settings.exams.find((item) => message.startsWith(`${item.name || '試験'}：`));
    if (exam) return editItem('exam', exam.id);
    const material = state.settings.materials.find((item) => message.startsWith(`${item.name || '教材'}：`));
    if (material) return state.settings.exams.length ? editItem('material', material.id) : addExam();
    const window = state.settings.windows.find((item) => message.startsWith(`${item.name}：`));
    if (window) return openAvailability(window.kind === 'class' ? 'class' : window.kind === 'study' ? 'study' : 'busy', window.id);
    const exception = state.settings.exceptions.find((item) => message.startsWith(`${item.name}：`));
    if (exception) return openAvailability('exception', exception.id);
    if (message.includes('食事')) return openAvailability('meals');
    if (message.includes('授業前後')) return openAvailability('class');
    navigate(message.includes('通学') ? 'commute' : 'focus');
  };

  return (
    <div className="settings-hub">
      <section className="card settings-primary" aria-label="基本設定">
        <h2>基本設定 <span className="settings-count">{readyCount}/3</span></h2>
        <div className="settings-rows">
          <div className={`settings-row ${invalidExam || (attempted && missing.some((issue) => issue.id === 'exams')) ? 'settings-row-error' : ''}`}>
            <div>
              <b>試験・目標</b>
              <span>{invalidExam ? '修正が必要' : state.settings.exams.length ? `${state.settings.exams.length}件設定済み` : '未登録'}</span>
              {invalidExam && <small>{validationErrors.find((message) => message.startsWith(`${invalidExam.name || '試験'}：`))}</small>}
            </div>
            <div className="settings-row-actions">
              <button onClick={invalidExam ? () => editItem('exam', invalidExam.id) : addExam}>
                {invalidExam ? '試験を修正' : '試験を追加'}
              </button>
              {!!state.settings.exams.length && <button aria-label="試験・目標の一覧・編集" onClick={() => navigate('exams')}>一覧・編集</button>}
            </div>
          </div>
          <div className={`settings-row ${invalidMaterial || (attempted && missing.some((issue) => issue.id === 'materials')) ? 'settings-row-error' : ''}`}>
            <div>
              <b>教材</b>
              <span>{invalidMaterial ? '修正が必要' : state.settings.materials.length ? `${state.settings.materials.length}件設定済み` : '未登録'}</span>
              {invalidMaterial && <small>{validationErrors.find((message) => message.startsWith(`${invalidMaterial.name || '教材'}：`))}</small>}
            </div>
            <div className="settings-row-actions">
              <button onClick={!state.settings.exams.length ? addExam : invalidMaterial ? () => editItem('material', invalidMaterial.id) : addMaterial}>
                {!state.settings.exams.length ? '先に試験を追加' : invalidMaterial ? '教材を修正' : '教材を追加'}
              </button>
              {!!state.settings.materials.length && <button aria-label="教材の一覧・編集" onClick={() => navigate('materials')}>一覧・編集</button>}
            </div>
          </div>
          <div className={`settings-row ${invalidStudy || (attempted && missing.some((issue) => issue.id === 'study')) ? 'settings-row-error' : ''}`}>
            <div>
              <b>勉強できる時間</b>
              <span>{invalidStudy ? '修正が必要' : studyCount ? `${studyCount}枠設定済み` : '未登録'}</span>
              {invalidStudy && <small>{validationErrors.find((message) => message.startsWith(`${invalidStudy.name}：`))}</small>}
            </div>
            <button onClick={() => openAvailability('study', invalidStudy?.id)}>
              {invalidStudy ? '時間枠を修正' : '時間枠を設定'}
            </button>
          </div>
        </div>
        <div id="settings-plan-check" className="settings-plan-check">
          {attempted && missing.length > 0 && (
            <p className="error" role="alert">未登録の項目を入力してください。</p>
          )}
          {attempted && !missing.length && validationErrors.length > 0 && (
            <div className="error" role="alert">
              <b>設定値を確認してください</b>
              <ul>
                {validationErrors.map((message, index) => (
                  <li key={`${message}-${index}`}>
                    <span>{message}</span>
                    <button onClick={() => fixValidation(message)}>修正する</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button className="primary" onClick={checkAndGenerate}>計画案を作成</button>
        </div>
      </section>

      <details className="card settings-extra">
        <summary>追加の条件{attentionCount ? ` · 要確認 ${attentionCount}件` : ''}</summary>
        <div className="settings-rows">
          <div className="settings-row">
            <div>
              <b>食事時間</b>
              <span>{missingMeals.length ? `${missingMeals.map((key) => mealNames[key]).join('・')}が未設定` : '設定済み'}</span>
              {hidden('meals') && <small>通知非表示</small>}
              {warningFor('meals') && <details><summary>影響</summary><p>{warningFor('meals')?.impact}</p></details>}
            </div>
            <button onClick={() => openAvailability('meals')}>設定・確認</button>
          </div>
          {scheduleKinds.map((kind) => {
            const status = scheduleStatus(state.settings, kind);
            const count = scheduleCount(state.settings, kind);
            return (
              <div className="settings-row" key={kind}>
                <div>
                  <b>{scheduleInfo[kind].label}</b>
                  <span>{status === 'registered' ? `${count}件設定済み` : status === 'none' ? '予定なし' : status === 'deferred' ? 'あとで設定' : '未確認'}</span>
                  {hidden(kind) && <small>通知非表示</small>}
                  {warningFor(kind) && <details><summary>影響</summary><p>{warningFor(kind)?.impact}</p></details>}
                </div>
                <div className="settings-row-actions">
                  <button onClick={() => openAvailability(kind)}>設定・確認</button>
                  {!count && (status === 'unknown' || status === 'deferred') &&
                    <button onClick={() => setScheduleNone(kind)}>予定なし</button>}
                </div>
              </div>
            );
          })}
          <div className="settings-row">
            <div>
              <b>学習枠の期間</b>
              <span>{!state.settings.exams.length ? '試験の設定後に確認' : !studyCount ? '学習枠の設定後に確認' : gaps.length ? `未登録 ${gaps.length}期間` : '設定済み'}</span>
              {gaps.some((gap) => hidden(gap.id)) && <small>通知非表示の期間あり</small>}
              {!!gaps.length && (
                <details>
                  <summary>期間と影響</summary>
                  <ul>{gaps.map((gap) => <li key={gap.id}>{gap.studyGap?.examName}：{gap.studyGap?.from}〜{gap.studyGap?.to}。{gap.impact}</li>)}</ul>
                </details>
              )}
            </div>
            <button onClick={() => openAvailability('study')}>設定・確認</button>
          </div>
        </div>
      </details>

      {sections.map((section) => (
        <section className="card" key={section.title}>
          <h2>{section.title}</h2>
          <div className="settings-links">
            {section.pages
              .filter(({ page }) => !demoMode || page !== 'backup')
              .map(({ page, label }) => (
                <button key={page} onClick={() => navigate(page)}>{label}</button>
              ))}
          </div>
        </section>
      ))}
      {pwaMode && <PwaStatus />}
      <section className="card">
        <h2>表示</h2>
        <div className="settings-display">
          <label>
            表示モード
            <select
              value={state.appearance ?? 'light'}
              onChange={(event) =>
                void update((current) => ({
                  ...current,
                  appearance: event.target.value as AppState['appearance'],
                }))
              }
            >
              <option value="light">ライト</option>
              <option value="dark">ダーク</option>
              <option value="system">システム</option>
            </select>
          </label>
          <label>
            カラーテーマ
            <select
              value={state.theme ?? 'mint'}
              onChange={(event) =>
                void update((current) => ({
                  ...current,
                  theme: event.target.value as AppState['theme'],
                }))
              }
            >
              <option value="mint">ミントグリーン</option>
              <option value="sky">ペールブルー</option>
              <option value="lime">ライム</option>
            </select>
          </label>
        </div>
      </section>
    </div>
  );
}
