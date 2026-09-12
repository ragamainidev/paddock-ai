import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts', 'evals/**/*.test.ts'],
    environment: 'node',
    // The eval database is built once here, not once per worker: parallel
    // ingests of the same file lock each other out on a cold checkout.
    globalSetup: ['scripts/vitest-global-setup.ts'],
    // A run that collects no tests is a broken invocation, not a pass.
    passWithNoTests: false,
    coverage: {
      provider: 'v8',
      // Naming `include` is what makes coverage honest: every source file
      // under it is reported, not only the ones a test happened to import
      // (this vitest reports covered files alone when `include` is unset).
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.ts', 'src/**/fixtures/**', 'src/**/*.d.ts'],
      reporter: ['text', 'json-summary'],
    },
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
});
