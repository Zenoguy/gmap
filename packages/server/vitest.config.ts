import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name:        'server',
    root:        './src',
    include:     ['../tests/**/*.test.ts'],
    environment: 'node',
  },
});
