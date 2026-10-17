export type Page =
  | 'dashboard'
  | 'future'
  | 'history'
  | 'settings'
  | 'commute'
  | 'warnings'
  | 'today'
  | 'setup'
  | 'addExam'
  | 'addMaterial'
  | 'exams'
  | 'materials'
  | 'availability'
  | 'focus'
  | 'calendar'
  | 'progress'
  | 'report'
  | 'backup'
  | 'tutorial'
  | 'replan';

/** `label` is the English word shown on the game UI tab; `name` stays the page's accessible name. */
export const navigation = [
  { id: 'dashboard', name: '今日', label: 'TODAY' },
  { id: 'future', name: '今後の予定', label: 'SCHEDULE' },
  { id: 'history', name: '記録履歴', label: 'LOG' },
  { id: 'settings', name: '設定', label: 'CONFIG' },
] as const;

/** English titles drawn on the game UI; `pageNames` stays the accessible name. */
export const pageTitles: Record<Page, string> = {
  dashboard: 'TODAY',
  future: 'SCHEDULE',
  history: 'LOG',
  settings: 'CONFIG',
  commute: 'COMMUTE',
  warnings: 'NOTICES',
  today: 'TODAY DETAIL',
  setup: 'SETUP',
  addExam: 'NEW EXAM',
  addMaterial: 'NEW BOOK',
  exams: 'EXAMS',
  materials: 'BOOKS',
  availability: 'TIME SLOTS',
  focus: 'FOCUS',
  calendar: 'CALENDAR',
  progress: 'EXTRA LOG',
  report: 'WEEKLY REPORT',
  backup: 'BACKUP',
  tutorial: 'TUTORIAL',
  replan: 'NEW PLAN',
};

export const pageNames: Record<Page, string> = {
  dashboard: '今日',
  future: '今後の予定',
  history: '記録履歴',
  settings: '設定',
  commute: '通学時間',
  warnings: '通知の管理',
  today: '今日の詳細',
  setup: '初期設定',
  addExam: '試験を追加',
  addMaterial: '教材を追加',
  exams: '試験・目標',
  materials: '教材・進捗',
  availability: '時間枠・時間割',
  focus: '連続時間・余裕率',
  calendar: '詳細カレンダー',
  progress: '予定外・過去日の記録',
  report: '週間レポート',
  backup: 'バックアップ',
  tutorial: 'チュートリアル',
  replan: '計画案の確認',
};
