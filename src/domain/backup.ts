import { backupSchema } from './backupSchema';
import type { AppState } from './model';

export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;
export interface BackupFile {
  format: 'StudyPlanBackup';
  version: 1;
  createdAt: string;
  appVersion: string;
  data: AppState;
}
export function parseBackup(text: string): BackupFile {
  if (new TextEncoder().encode(text).length > MAX_BACKUP_BYTES)
    throw new Error('バックアップは50MB以下のファイルを選んでください。');
  let value: unknown;
  try {
    value = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('ファイルを読み取れません。StudyPlanのバックアップを選んでください。');
  }
  const result = backupSchema.safeParse(value);
  if (!result.success) {
    const path = result.error.issues[0]?.path.join('.') || 'ファイル全体';
    throw new Error(
      `バックアップの形式に対応していないか、内容が壊れています（${path}）。現在のデータは変更していません。`,
    );
  }
  // Keep the original JSON, including optional fields written by this app version.
  return value as BackupFile;
}
export function backupSummary(state: AppState) {
  return {
    exams: state.settings.exams.length,
    materials: state.settings.materials.length,
    records: state.records.filter((r) => !r.cancelled).length,
    sessions: state.plan?.sessions.length ?? 0,
  };
}
