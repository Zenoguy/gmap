import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react() as any],
  test: {
    name:        'dashboard',
    root:        './src',
    include:     ['../tests/**/*.test.ts', '../tests/**/*.test.tsx'],
    environment: 'happy-dom',
  },
});
