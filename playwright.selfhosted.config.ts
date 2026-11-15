import { defineConfig, devices } from '@playwright/test';

// Self-hosted collaboration E2E (briefs/13-11-2026-self-hosted-collab-backend.md).
//
// Runs against the SHIPPED artifacts, not the dev server: the editor built
// with VITE_SELF_HOSTED=true (`npm run build:selfhosted` → dist-selfhosted/)
// and the bundled server (`npm run server:build` → dist-server/). Build both
// first. e2e/selfhosted/start-server.mjs seeds a fresh data root and serves
// on 127.0.0.1:4334 (editor) / 5174 (canvas sandbox) / 5175 (preview); the
// owner's Vite dev stack on [::1] keeps running alongside.
//
// Artifact: one trace + video per person for the whole run under
// test-results/selfhosted/run-artifacts/, the HTML report in
// playwright-report-selfhosted, and the server log attached to the last test.

export default defineConfig({
  testDir: './e2e/selfhosted',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  outputDir: 'test-results/selfhosted',
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-selfhosted' }]],
  use: {
    baseURL: 'http://127.0.0.1:4334',
    // Each person's browser context records its own trace + video for the
    // whole run (e2e/selfhosted/collab.spec.ts), so the fixtures don't.
    trace: 'off',
    video: 'off',
    viewport: { width: 1600, height: 1000 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 1000 } } }],
  webServer: {
    command: 'node e2e/selfhosted/start-server.mjs',
    url: 'http://127.0.0.1:4334/api/auth/session',
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
