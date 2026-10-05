import { test, expect, Page } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { InventoryPage } from '../pages/InventoryPage';

// Scenarios from TestDesign/JIRA-192_PlaywrightScenarios.csv (SCN-1..SCN-29).
//
// JIRA-192 is a near-duplicate of JIRA-191, so most scenarios are mapped (tag + annotation
// "JIRA192-SCN-<n>") onto existing tests instead of being re-implemented:
//   tests/JIRA-191.spec.ts : SCN-1,2,3,5,6,7,8,9,10,11,12,13,14,17,18,19,20,21,22,23,24,26,27,28
//   tests/JIRA-1.spec.ts   : SCN-4, SCN-15, SCN-16
//   tests/JIRA-190.spec.ts : SCN-25
// Only SCN-29 (EDGE-8, other seeded users) has no equivalent with all required checks and is
// implemented here.

const TARGET = 'Sauce Labs Bolt T-Shirt';

async function login(page: Page, user: string, timeout?: number) {
  const loginPage = new LoginPage(page);
  const inventoryPage = new InventoryPage(page);
  await loginPage.open();
  const start = Date.now();
  await loginPage.login(user, 'secret_sauce');
  await expect(inventoryPage.inventoryList).toBeVisible({ timeout });
  return { inventoryPage, elapsed: Date.now() - start };
}

test.describe('JIRA-192 — Identify "Sauce Labs Bolt T-Shirt"', () => {
  test(
    '[JIRA192-SCN-29] Other seeded users (problem_user, performance_glitch_user)',
    { tag: ['@JIRA192-SCN-29', '@priority-low', '@risk-medium'] },
    async ({ page }) => {
      test.info().annotations.push({ type: 'Scenario ID', description: 'JIRA192-SCN-29' });

      for (const user of ['problem_user', 'performance_glitch_user']) {
        await test.step(user, async () => {
          await page.context().clearCookies();
          // Extended timeout: performance_glitch_user has induced latency.
          const timeout = user === 'performance_glitch_user' ? 15_000 : undefined;
          const { inventoryPage, elapsed } = await login(page, user, timeout);

          await inventoryPage.expectUrlContains('/inventory.html');
          const item = inventoryPage.inventoryItems.filter({ hasText: TARGET });
          await expect(item).toHaveCount(1);
          await expect(item).toBeVisible();

          if (user === 'problem_user') {
            const broken = await item
              .locator('img')
              .evaluate((img: HTMLImageElement) => !img.complete || img.naturalWidth === 0);
            test.info().annotations.push({
              type: 'problem_user defect',
              description: `target product image broken (naturalWidth check): ${broken}`,
            });
          }
          test.info().annotations.push({ type: `${user} login ms`, description: String(elapsed) });
        });
      }
    }
  );
});
