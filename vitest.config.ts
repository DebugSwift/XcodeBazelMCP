import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Don't write the persistent command log to the developer's home during tests.
    env: { BAZEL_IOS_COMMAND_LOG_DISABLE: '1' },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/index.ts'],
      reporter: ['text', 'text-summary', 'lcov'],
      thresholds: {
        'src/core/scaffold.ts': { statements: 80 },
        'src/core/workflows.ts': { statements: 80 },
        'src/core/workspace.ts': { statements: 80 },
        'src/core/bazel.ts': { statements: 80 },
        'src/core/upgrade.ts': { statements: 80 },
        'src/runtime/config.ts': { statements: 80 },
        'src/utils/output.ts': { statements: 80 },
        'src/tools/bazel-tools.ts': { statements: 80 },
        'src/tools/helpers.ts': { statements: 80 },
      },
    },
  },
});
