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
