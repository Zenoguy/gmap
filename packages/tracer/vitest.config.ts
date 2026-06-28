import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name:        'tracer',
    root:        './src',
    include:     ['../tests/**/*.test.ts'],
    environment: 'node',
  },
});
