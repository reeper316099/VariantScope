// Playwright config. Web tests run headless (no visible window); Electron tests run in
// background mode. Live public APIs are slow, so timeouts are generous but still bounded.
import { defineConfig } from '@playwright/test';

// Software WebGL so the 3D viewer works in headless Chrome without a GPU.
const WEBGL_ARGS = [
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
];

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 240_000,
  expect: { timeout: 20_000 },
  globalTimeout: 40 * 60_000,
  workers: 1,
  // Live public APIs can hiccup; CI gets one retry (a retried test is reported as "flaky").
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  projects: [
    {
      name: 'web',
      testMatch: /web.*\.spec\.js/,
      use: {
        baseURL: 'http://localhost:4180',
        // Locally use the installed Chrome (no browser download); CI installs Playwright's Chromium.
        channel: process.env.CI ? undefined : 'chrome',
        headless: true,
        launchOptions: { args: WEBGL_ARGS },
      },
    },
    { name: 'electron', testMatch: /electron\.spec\.js/ },
  ],
  webServer: {
    // The e2e build is the real web build plus read-only test hooks.
    command: 'npm run build:e2e && npx vite preview --mode e2e --port 4180 --strictPort',
    url: 'http://localhost:4180',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
