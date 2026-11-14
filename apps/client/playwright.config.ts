import { defineConfig } from '@playwright/test';

/**
 * End-to-end run of the whole game on mocks: the dev launcher starts the server (in-memory
 * PGlite), the mock Telegram Bot API, the bot and the Vite client. Nothing external is needed.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 420_000,
  expect: { timeout: 30_000 },
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    locale: 'ru-RU',
    // WebGL in headless Chromium needs the software renderer.
    launchOptions: { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node tools/dev/dev.mjs',
    cwd: '../..',
    // Through the Vite proxy: ready only when both the client and the game server are up.
    url: 'http://localhost:5173/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { DATABASE_URL: 'pglite://memory', LOG_LEVEL: 'error' },
  },
});
