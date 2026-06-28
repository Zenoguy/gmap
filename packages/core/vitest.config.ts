import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name:        'core',
    root:        './src',
    include:     ['../tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider:  'v8',
      reporter:  ['text', 'lcov'],
    },
  },
});
