import { CalendarDays, History, Settings2, ListChecks } from 'lucide-react';

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

export const navigation = [
  { id: 'dashboard', name: '今日', icon: ListChecks },
  { id: 'future', name: '今後の予定', icon: CalendarDays },
  { id: 'history', name: '記録履歴', icon: History },
  { id: 'settings', name: '設定', icon: Settings2 },
] as const;

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
