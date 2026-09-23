import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { SettingsHub } from '../src/app/SettingsHub';
import { beginAddition } from '../src/components/guided-setup';
import { warningVersion } from '../src/components/Warnings';
import { addDays, initialState, today } from '../src/domain/model';
import { setupIssues } from '../src/domain/setupIssues';

function view(state = initialState()) {
  return renderToStaticMarkup(createElement(SettingsHub, {
    state,
    update: async () => {},
    navigate: () => {},
    addExam: () => {},
    addMaterial: () => {},
    editItem: () => {},
    openAvailability: () => {},
    generate: () => {},
  }));
}

it('初期状態は必須3項目を先頭に示し、未設定の通常状態をエラー通知にしない', () => {
  const html = view();
  expect(html.indexOf('基本設定')).toBeLessThan(html.indexOf('追加の条件'));
  expect(html).toContain('0/3');
  expect(html).toContain('追加の条件 · 要確認 4件');
  expect(html.indexOf('試験・目標')).toBeLessThan(html.indexOf('その他の設定'));
  expect(html).not.toContain('試験・目標の一覧');
  expect(html).toContain('先に試験を追加');
  expect(html).toContain('時間枠を設定');
  expect(html).not.toContain('role="alert"');
});

it('登録値が壊れていれば件数だけで完了扱いせず、対象の修正入口を示す', () => {
  const state = initialState();
  state.settings.exams = [{
    id: 'exam', name: '試験', start: today(), target: addDays(today(), -1),
    priority: 2, color: '#287569', reviewDays: 0,
  }];
  state.settings.materials = [{
    id: 'material', examId: 'exam', name: '問題集', total: 0, order: 1,
    rounds: [{ completed: 0, minutes: 2 }],
  }];
  state.settings.windows = [{
    id: 'study', kind: 'study', name: '学習枠', from: today(), to: today(),
    weekdays: [1], start: 1200, end: 1100,
  }];
  const html = view(state);
  expect(html).toContain('0/3');
  expect(html.match(/修正が必要/g)).toHaveLength(3);
  expect(html).toContain('試験を修正');
  expect(html).toContain('教材を修正');
  expect(html).toContain('時間枠を修正');
  expect(html).toContain('日付と復習期間を確認');
  expect(html).toContain('問題数と所要時間を確認');
  expect(html).toContain('期間・曜日・時間帯を確認');
});

it('3項目の数は登録・削除した現在の値から計算する', () => {
  const state = initialState();
  state.settings.exams = [{
    id: 'exam', name: '試験', start: today(), target: addDays(today(), 3),
    priority: 2, color: '#287569', reviewDays: 0,
  }];
  state.settings.materials = [{
    id: 'material', examId: 'exam', name: '問題集', total: 10, order: 1,
    rounds: [{ completed: 0, minutes: 2 }],
  }];
  state.settings.windows = [{
    id: 'study', kind: 'study', name: '学習枠', from: today(), to: addDays(today(), 2),
    weekdays: [0, 1, 2, 3, 4, 5, 6], start: 1080, end: 1140,
  }];
  expect(view(state)).toContain('3/3');
  expect(view(state)).toContain('試験・目標の一覧・編集');
  expect(view(state)).toContain('教材の一覧・編集');
  expect((beginAddition(state, 'addMaterial').draft.addMaterial as { step: string }).step).toBe('material.name');
  const material = state.settings.materials[0];
  state.settings.materials = [];
  expect(view(state)).toContain('2/3');
  state.settings.windows = [];
  expect(view(state)).toContain('1/3');
  state.settings.exams = [];
  state.settings.materials = [material];
  const orphan = view(state);
  expect(orphan).toContain('0/3');
  expect(orphan).toContain('先に試験を追加');
});

it('通知非表示と予定なしを異なる状態として表示する', () => {
  const state = initialState();
  const issue = setupIssues(state.settings).find((item) => item.id === 'class')!;
  state.ignoredWarnings = {
    'setup-class': { title: issue.title, version: warningVersion(issue), ignoredAt: new Date().toISOString() },
  };
  const html = view(state);
  expect(html).toContain('大学の授業');
  expect(html).toContain('未確認');
  expect(html).toContain('通知非表示');
  expect(html).toContain('予定なし');
});
