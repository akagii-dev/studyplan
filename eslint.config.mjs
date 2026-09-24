import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: [
      'dist/**',
      'release/**',
      '.test-data/**',
      'test-results/**',
      'playwright-report/**',
      'src-tauri/**',
    ],
  },
  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.ts', '*.config.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
      // Japanese full-width spacing in visible text is intentional, not code whitespace.
      'no-irregular-whitespace': ['error', { skipStrings: true, skipJSXText: true }],
    },
  },
  {
    files: [
      'src/app/{Dashboard,Future}.tsx',
      'src/components/{Calendar,CalendarDaySummary,CalendarQuantity,TodayRecorder,TodayStudyList,WeeklyReport}.tsx',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/domain/model'],
              importNames: ['actual', 'reported', 'completed'],
              message:
                '日別進捗はcalendarQuantity→progressState/progressViewを使用してください（docs/ARCHITECTURE.md）。',
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      'src/components/Calendar*.tsx',
      'src/app/Future.tsx',
      'src/components/WeeklyReport.tsx',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'ImportDeclaration[source.value=/\\/(planning|progress|TodayRecorder|Progress)$/]',
          message:
            '俯瞰・詳細画面には実績入力を複製せず、既存の記録画面へ誘導してください。計算用の日付列挙はplanner/intervalsから取得できます。',
        },
      ],
    },
  },
  {
    files: ['src/domain/planner/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '../model',
              importNames: ['today', 'uid'],
              message: '日時・IDはPlanningContextで受け取ってください。',
            },
          ],
          patterns: [
            'react',
            'react-*',
            '@tauri-apps/*',
            '**/store',
            '**/components/**',
            '**/hooks/**',
            '**/app/**',
            '**/planning',
          ],
        },
      ],
      'no-restricted-globals': ['error', 'window', 'document', 'localStorage'],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: '現在日時はPlanningContextで受け取ってください。',
        },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random' },
        { object: 'crypto', property: 'randomUUID' },
      ],
    },
  },
  {
    files: ['src/app/App.tsx', 'src/components/guided-setup/transitions.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ['**/store', '@tauri-apps/*'] }],
    },
  },
);
