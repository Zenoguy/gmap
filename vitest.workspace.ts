import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/core/vitest.config.ts',
  'packages/cli/vitest.config.ts',
  'packages/server/vitest.config.ts',
  'packages/dashboard/vitest.config.ts',
  'packages/vscode/vitest.config.ts',
  'packages/tracer/vitest.config.ts',
]);
