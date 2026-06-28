import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name:        'vscode',
    root:        './src',
    include:     ['../tests/**/*.test.ts'],
    environment: 'node',
  },
});
