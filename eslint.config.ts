import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

export default [
  {
    files: ['packages/*/src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project:    './tsconfig.base.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      ...tsPlugin.configs['strict-type-checked'].rules,
      '@typescript-eslint/no-explicit-any':       'error',
      '@typescript-eslint/consistent-type-imports':'error',
      '@typescript-eslint/no-floating-promises':  'error',
      'no-console':                               'off',   // scanners log progress
    },
  },
  {
    // Dashboard: allow JSX, relax some node-specific rules
    files: ['packages/dashboard/src/**/*.tsx'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    // Test files: allow any, looser assertions
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
];
