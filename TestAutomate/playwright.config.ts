import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: true,
  // Suite runs against the live, shared saucedemo.com demo instance rather than
  // a controlled test environment — one retry absorbs transient network/render
  // races (e.g. a submit click racing the app's own re-render) without masking
  // genuine functional failures, which still fail after the retry.
  retries: 1,
  // 'html' reporter clears and rewrites outputFolder on every run, so the
  // report always reflects only the latest run — nothing accumulates.
  reporter: [['html', { outputFolder: 'playwright-report', open: 'never' }], ['list']],

  use: {
    baseURL: 'https://www.saucedemo.com',
    // SauceDemo exposes stable selectors via `data-test`, not the Playwright
    // default `data-testid` — this makes every getByTestId() call in the
    // page objects match the right attribute.
    testIdAttribute: 'data-test',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
