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
);
