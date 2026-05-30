import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/desktop/_*.ts'],
    benchmark: {
      include: ['benchmarks/**/*.bench.ts'],
    },
  },
  resolve: {
    alias: [
      // Stub `electron` for desktop-module tests. Electron is a real
      // dependency of `apps/desktop` but is NOT installed in the
      // project root, so tests can't import { app, BrowserWindow,
      // ipcMain } from 'electron' directly. The stub provides the
      // surface the bridge module uses, plus accessors for tests
      // to drive it.
      {
        find: /^electron$/,
        replacement: resolve(__dirname, 'tests/desktop/_electron-stub.ts'),
      },
    ],
  },
});
