import {
  BellOff,
  BookOpen,
  Bus,
  CalendarDays,
  CheckCircle2,
  CircleHelp,
  DatabaseBackup,
  FileText,
  GraduationCap,
  History as HistoryIcon,
  LayoutDashboard,
  ListChecks,
  RefreshCw,
  Settings2,
} from 'lucide-react';
export type Page =
  | 'commute'
  | 'warnings'
  | 'today'
  | 'dashboard'
  | 'setup'
  | 'addExam'
  | 'addMaterial'
  | 'exams'
  | 'materials'
  | 'availability'
  | 'focus'
  | 'calendar'
  | 'progress'
  | 'history'
  | 'report'
  | 'backup'
  | 'tutorial'
  | 'replan';
export const navigation = [
  { id: 'dashboard', name: 'ホーム', icon: LayoutDashboard },
  { id: 'today', name: '今日のスケジュール', icon: CalendarDays },
  { id: 'calendar', name: '学習カレンダー', icon: CalendarDays },
  { id: 'progress', name: '進捗を記録', icon: CheckCircle2 },
  { id: 'history', name: '記録履歴', icon: HistoryIcon },
  { id: 'report', name: '週間レポート', icon: FileText },
  { id: 'replan', name: '再計画の確認', icon: RefreshCw },
  { id: 'exams', name: '試験・目標', icon: GraduationCap },
  { id: 'materials', name: '教材・進捗', icon: BookOpen },
  { id: 'availability', name: '時間枠・時間割', icon: CalendarDays },
  { id: 'commute', name: '通学時間', icon: Bus },
  { id: 'warnings', name: '警告の管理', icon: BellOff },
  { id: 'focus', name: '連続時間・余裕率', icon: Settings2 },
  { id: 'setup', name: '対話式の初期設定', icon: ListChecks },
  { id: 'backup', name: 'バックアップ', icon: DatabaseBackup },
  { id: 'tutorial', name: 'チュートリアル', icon: CircleHelp },
] as const;
