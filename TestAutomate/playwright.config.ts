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
    // Cross-browser / mobile projects (JIRA191-SCN-30) — limited to the JIRA-191 spec so
    // the rest of the suite keeps running on chromium only.
    // Requires: npx playwright install firefox webkit
    {
      name: 'firefox',
      // Headed Firefox intermittently hangs inside the login click when several Firefox windows
      // run at once (3 of 8 failed in parallel, 8 of 8 passed one at a time).
      workers: 1,
      testMatch: /JIRA-19[13]\.spec\.ts|JIRA-190-TC\.spec\.ts|JIRA-19[13]-TC\.spec\.ts/,
      grep: /@JIRA191-SCN-30|@JIRA193-SCN-29|@JIRA190-TC-036|@JIRA191-TC-029|@JIRA193-TC-029/,
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      testMatch: /JIRA-19[13]\.spec\.ts|JIRA-190-TC\.spec\.ts|JIRA-19[13]-TC\.spec\.ts/,
      grep: /@JIRA191-SCN-30|@JIRA193-SCN-29|@JIRA190-TC-036|@JIRA191-TC-029|@JIRA193-TC-029/,
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'mobile-iphone',
      testMatch: /JIRA-19[13]\.spec\.ts|JIRA-190-TC\.spec\.ts|JIRA-19[13]-TC\.spec\.ts/,
      grep: /@JIRA191-SCN-30|@JIRA193-SCN-29|@JIRA190-TC-036|@JIRA191-TC-029|@JIRA193-TC-029/,
      use: { ...devices['iPhone 13'] },
    },
    // JIRA192-SCN-28 — 375x667 mobile viewport.
    {
      name: 'mobile-375x667',
      testMatch: /JIRA-19[13]\.spec\.ts|JIRA-190-TC\.spec\.ts|JIRA-19[13]-TC\.spec\.ts/,
      grep: /@JIRA191-SCN-30|@JIRA193-SCN-29|@JIRA190-TC-036|@JIRA191-TC-029|@JIRA193-TC-029/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true },
    },
    // JIRA191-TC-029 (review F-04/Q7): real Microsoft Edge. Requires Edge installed.
    {
      name: 'edge',
      testMatch: /JIRA-19[13]-TC\.spec\.ts/,
      grep: /@JIRA191-TC-029|@JIRA193-TC-029/,
      use: { ...devices['Desktop Edge'], channel: 'msedge' },
    },
  ],
});
