import { test, expect, Page } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { InventoryPage } from '../pages/InventoryPage';
import { CartPage } from '../pages/CartPage';

// Scenarios generated from TestDesign/JIRA-191_PlaywrightScenarios.csv (SCN-1..SCN-31).
//
// Scenario IDs are source-qualified ("JIRA191-SCN-<n>") because the CSV's bare
// "SCN-<n>" numbering collides with the numbering used by JIRA-1 and JIRA-190.
//
// Scenarios that duplicate existing tests were mapped (tag + annotation) instead of
// being re-implemented:
//   JIRA191-SCN-4  -> tests/JIRA-1.spec.ts   '[SCN-9]...'  Standard user logs in successfully
//   JIRA191-SCN-15 -> tests/JIRA-1.spec.ts   '[SCN-23]...' Login fails with empty username
//   JIRA191-SCN-16 -> tests/JIRA-1.spec.ts   '[SCN-24]...' Login fails with empty password
//   JIRA191-SCN-28 -> tests/JIRA-190.spec.ts '[JIRA190-SCN-33]...' Injection strings in login
// All remaining scenarios are implemented below.
//
// JIRA191-SCN-30 (cross-browser / mobile) relies on extra Playwright projects declared
// in playwright.config.ts (firefox, webkit, mobile-iphone) restricted to this file.

const TARGET = 'Sauce Labs Bolt T-Shirt';
const TARGET_PRICE = 15.99;
const PASSWORD = 'secret_sauce';

function pagesOf(page: Page) {
  return {
    loginPage: new LoginPage(page),
    inventoryPage: new InventoryPage(page),
    cartPage: new CartPage(page),
  };
}

async function loginAs(page: Page, user = 'standard_user') {
  const pages = pagesOf(page);
  await pages.loginPage.open();
  await pages.loginPage.login(user, PASSWORD);
  return pages;
}

async function loginAsStandard(page: Page) {
  const pages = pagesOf(page);
  await pages.loginPage.open();
  await pages.loginPage.loginAsStandardUser();
  await pages.inventoryPage.expectLoaded();
  return pages;
}

function targetItem(inventoryPage: InventoryPage) {
  return inventoryPage.inventoryItems.filter({ hasText: TARGET });
}

/** Reads name / description / price / image src from the detail page (inline locators). */
async function readDetail(page: Page) {
  return {
    name: (await page.getByTestId('inventory-item-name').textContent())?.trim() ?? '',
    desc: (await page.getByTestId('inventory-item-desc').textContent())?.trim() ?? '',
    price: (await page.getByTestId('inventory-item-price').textContent())?.trim() ?? '',
    img: (await page.locator('img.inventory_details_img').getAttribute('src')) ?? '',
  };
}

async function readListEntry(item: ReturnType<typeof targetItem>) {
  return {
    name: (await item.getByTestId('inventory-item-name').textContent())?.trim() ?? '',
    desc: (await item.getByTestId('inventory-item-desc').textContent())?.trim() ?? '',
    price: (await item.getByTestId('inventory-item-price').textContent())?.trim() ?? '',
    img: (await item.locator('img').getAttribute('src')) ?? '',
  };
}

// TestDesign/JIRA-192_PlaywrightScenarios.csv (SCN-1..SCN-29) is a near-duplicate of the
// JIRA-191 CSV. Its scenarios are mapped onto the JIRA-191 tests below (same flow; a few
// tests were extended with the extra JIRA-192 assertions). JIRA192-SCN-<n> -> JIRA191 test:
//   1->1, 2->2, 3->3, 5->5, 6->6, 7->7, 8->8, 9->9, 10->10, 11->11, 12->12, 13->13, 14->14,
//   17->17, 18->18, 19->19, 20->20, 21->21, 22->27, 23->25, 24->26, 26->29, 27->31, 28->30.
// Other JIRA-192 mappings: SCN-4/15/16 -> tests/JIRA-1.spec.ts, SCN-25 -> tests/JIRA-190.spec.ts,
// SCN-29 -> tests/JIRA-192.spec.ts (new).
const ALSO_COVERS: Record<string, string[]> = {
  // JIRA-193 mappings (standard_user-independent flows): see tests/JIRA-193.spec.ts header.
  'JIRA191-SCN-1': ['JIRA192-SCN-1'],
  'JIRA191-SCN-2': ['JIRA192-SCN-2', 'JIRA193-SCN-2'],
  'JIRA191-SCN-3': ['JIRA192-SCN-3'],
  'JIRA191-SCN-5': ['JIRA192-SCN-5'],
  'JIRA191-SCN-6': ['JIRA192-SCN-6'],
  'JIRA191-SCN-7': ['JIRA192-SCN-7'],
  'JIRA191-SCN-8': ['JIRA192-SCN-8'],
  'JIRA191-SCN-9': ['JIRA192-SCN-9'],
  'JIRA191-SCN-10': ['JIRA192-SCN-10'],
  'JIRA191-SCN-11': ['JIRA192-SCN-11'],
  'JIRA191-SCN-12': ['JIRA192-SCN-12', 'JIRA193-SCN-13'],
  'JIRA191-SCN-13': ['JIRA192-SCN-13', 'JIRA193-SCN-14'],
  'JIRA191-SCN-14': ['JIRA192-SCN-14', 'JIRA193-SCN-15'],
  'JIRA191-SCN-17': ['JIRA192-SCN-17', 'JIRA193-SCN-18'],
  'JIRA191-SCN-18': ['JIRA192-SCN-18', 'JIRA193-SCN-19'],
  'JIRA191-SCN-19': ['JIRA192-SCN-19', 'JIRA193-SCN-20'],
  'JIRA191-SCN-20': ['JIRA192-SCN-20', 'JIRA193-SCN-21'],
  'JIRA191-SCN-21': ['JIRA192-SCN-21', 'JIRA193-SCN-22'],
  'JIRA191-SCN-25': ['JIRA192-SCN-23'],
  'JIRA191-SCN-26': ['JIRA192-SCN-24'],
  'JIRA191-SCN-27': ['JIRA192-SCN-22'],
  'JIRA191-SCN-29': ['JIRA192-SCN-26', 'JIRA193-SCN-27'],
  'JIRA191-SCN-30': ['JIRA192-SCN-28'],
  'JIRA191-SCN-31': ['JIRA192-SCN-27'],
};

function tagged(id: string, priority: string, risk: string, title: string) {
  const extra = ALSO_COVERS[id] ?? [];
  return {
    title: `[${id}]${extra.map((e) => `[${e}]`).join('')} ${title}`,
    details: { tag: [`@${id}`, ...extra.map((e) => `@${e}`), `@priority-${priority}`, `@risk-${risk}`] },
  };
}

function annotate(id: string) {
  for (const sid of [id, ...(ALSO_COVERS[id] ?? [])]) {
    test.info().annotations.push({ type: 'Scenario ID', description: sid });
  }
}

test.describe('JIRA-191 — Identify "Sauce Labs Bolt T-Shirt"', () => {
  // ---------------------------------------------------------------- TS
  {
    const t = tagged('JIRA191-SCN-1', 'high', 'medium', 'Login and identify Bolt T-Shirt on inventory');
    test(t.title, t.details, async ({ page }) => {
      annotate('JIRA191-SCN-1');
      const { inventoryPage } = await loginAsStandard(page);
      const item = targetItem(inventoryPage);
      await expect(item).toHaveCount(1);
      await expect(item).toBeVisible();
      await expect(item.getByTestId('inventory-item-name')).toHaveText(TARGET);
    });
  }

  {
    const t = tagged('JIRA191-SCN-2', 'high', 'high', 'Authentication gate before product identification');
    test(t.title, t.details, async ({ page }) => {
      annotate('JIRA191-SCN-2');
      const { loginPage, inventoryPage } = pagesOf(page);

      await test.step('Unauthenticated direct access redirects to login', async () => {
        await page.context().clearCookies();
        await loginPage.goto('/inventory.html');
        await expect(loginPage.loginButton).toBeVisible();
        await expect(targetItem(inventoryPage)).toHaveCount(0);
      });

      const cases: { user: string; pass: string; error?: RegExp }[] = [
        { user: 'invalid_user', pass: 'wrong_pass', error: /do not match any user/i },
        { user: 'locked_out_user', pass: PASSWORD, error: /locked out/i },
        { user: '', pass: '', error: /username is required/i },
        { user: 'standard_user', pass: PASSWORD },
      ];
      for (const { user, pass, error } of cases) {
        await test.step(`Credentials "${user}" / "${pass}"`, async () => {
          await page.context().clearCookies();
          await loginPage.open();
          await loginPage.login(user, pass);
          if (error) {
            await loginPage.expectLoginError(error);
            await expect(page).not.toHaveURL(/inventory\.html/);
          } else {
            await loginPage.expectUrlContains('/inventory.html');
          }
        });
      }
    });
  }

  {
    const t = tagged('JIRA191-SCN-3', 'medium', 'medium', 'Product details consistent between list and detail page');
    test(t.title, t.details, async ({ page }) => {
      annotate('JIRA191-SCN-3');
      const { inventoryPage } = await loginAsStandard(page);
      const item = targetItem(inventoryPage);
      const listed = await readListEntry(item);

      await item.getByTestId('inventory-item-name').click();
      await expect(page.getByTestId('inventory-item-name')).toHaveText(TARGET);
      const detail = await readDetail(page);

      expect(detail.name).toBe(listed.name);
      expect(detail.desc).toBe(listed.desc);
      expect(detail.price).toBe(listed.price);
      expect(detail.img).toBe(listed.img);
    });
  }

  // --------------------------------------------------------------- POS
  // JIRA191-SCN-4 (POS-1) is mapped onto tests/JIRA-1.spec.ts '[SCN-9]'.

  {
    const t = tagged('JIRA191-SCN-5', 'high', 'low', 'Product is displayed after login');
    test(t.title, t.details, async ({ page }) => {
      annotate('JIRA191-SCN-5');
      const { inventoryPage } = await loginAsStandard(page);
      const item = targetItem(inventoryPage);
      await expect(item).toHaveCount(1);
      await expect(item.locator('img')).toBeVisible();
      expect(await inventoryPage.getProductPrice(TARGET)).toBeCloseTo(TARGET_PRICE, 2);
      await expect(item.getByRole('button', { name: /add to cart/i })).toBeVisible();
    });
  }

  {
    const t = tagged('JIRA191-SCN-6', 'medium', 'low', 'Product name is an exact match');
    test(t.title, t.details, async ({ page }) => {
      annotate('JIRA191-SCN-6');
      const { inventoryPage } = await loginAsStandard(page);
      await expect(targetItem(inventoryPage).getByTestId('inventory-item-name')).toHaveText(TARGET);
    });
  }

  {
    const t = tagged('JIRA191-SCN-7', 'medium', 'low', 'Open product detail page by clicking name');
    test(t.title, t.details, async ({ page }) => {
      annotate('JIRA191-SCN-7');
      const { inventoryPage } = await loginAsStandard(page);
      await targetItem(inventoryPage).getByTestId('inventory-item-name').click();
      await inventoryPage.expectUrlContains('/inventory-item.html\\?id=1');
      await expect(page.getByTestId('inventory-item-name')).toHaveText(TARGET);
      await expect(page.getByTestId('inventory-item-desc')).toBeVisible();
      await expect(page.getByTestId('inventory-item-price')).toHaveText(`$${TARGET_PRICE}`);
      await expect(page.locator('img.inventory_details_img')).toBeVisible();
    });
  }

  {
    const t = tagged('JIRA191-SCN-8', 'low', 'low', 'Open product detail page by clicking image');
    test(t.title, t.details, async ({ page }) => {
      annotate('JIRA191-SCN-8');
      const { inventoryPage } = await loginAsStandard(page);
      const listed = await readListEntry(targetItem(inventoryPage));
      await targetItem(inventoryPage).getByRole('img', { name: TARGET }).click();
      await inventoryPage.expectUrlContains('/inventory-item.html\\?id=1');
      await expect(page.getByTestId('inventory-item-name')).toHaveText(TARGET);
      // JIRA192-SCN-8: same name, description and price as the name-link flow / list entry.
      const detail = await readDetail(page);
      expect(detail.name).toBe(listed.name);
      expect(detail.desc).toBe(listed.desc);
      expect(detail.price).toBe(`$${TARGET_PRICE}`);
    });
  }

  {
    const t = tagged('JIRA191-SCN-9', 'low', 'low', 'Back to products from detail page');
    test(t.title, t.details, async ({ page }) => {
      annotate('JIRA191-SCN-9');
      const { inventoryPage } = await loginAsStandard(page);
      await targetItem(inventoryPage).getByTestId('inventory-item-name').click();
      await page.getByTestId('back-to-products').click();
      await inventoryPage.expectUrlContains('/inventory.html');
      await inventoryPage.expectLoaded();
      // JIRA192-SCN-9: target is back on the list exactly once.
      await expect(targetItem(inventoryPage)).toHaveCount(1);
      await expect(targetItem(inventoryPage)).toBeVisible();
    });
  }

  {
    const t = tagged('JIRA191-SCN-10', 'medium', 'medium', 'Identify product after each sort order');
    test(t.title, t.details, async ({ page }) => {
      annotate('JIRA191-SCN-10');
      const { inventoryPage } = await loginAsStandard(page);
      const names = () => inventoryPage.inventoryItems.getByTestId('inventory-item-name').allTextContents();
      const initialNames = await names();
      const firstItem = () => inventoryPage.inventoryItems.first().getByTestId('inventory-item-name');
      // JIRA192-SCN-10: the first item (name/price) must change as the sort order changes.
      let previousFirst = (await firstItem().textContent()) ?? '';

      for (const option of ['za', 'lohi', 'hilo']) {
        await test.step(`Sort: ${option}`, async () => {
          await inventoryPage.sortDropdown.selectOption(option);
          const currentFirst = (await firstItem().textContent()) ?? '';
          expect(currentFirst, `first item should change after sorting by ${option}`).not.toBe(previousFirst);
          previousFirst = currentFirst;
          const item = targetItem(inventoryPage);
          await expect(item).toHaveCount(1);
          await expect(item).toBeVisible();

          if (option === 'za') {
            const sorted = await names();
            expect(sorted).toEqual([...sorted].sort((a, b) => b.localeCompare(a)));
            expect(sorted).not.toEqual(initialNames);
          } else {
            const prices = await inventoryPage.getDisplayedPrices();
            const expected = [...prices].sort((a, b) => (option === 'lohi' ? a - b : b - a));
            expect(prices).toEqual(expected);
          }
        });
      }
    });
  }

  {
    const t = tagged('JIRA191-SCN-11', 'medium', 'low', 'Add identified product to cart');
    test(t.title, t.details, async ({ page }) => {
      annotate('JIRA191-SCN-11');
      const { inventoryPage, cartPage } = await loginAsStandard(page);
      await inventoryPage.addProductToCart(TARGET);
      await expect(inventoryPage.removeFromCartButton(TARGET)).toBeVisible();
      await inventoryPage.expectCartBadgeCount(1);
      await inventoryPage.goToCart();
      await cartPage.expectItemCount(1);
      await cartPage.expectItemInCart(TARGET);
    });
  }

  // --------------------------------------------------------------- NEG
  {
    const t = tagged('JIRA191-SCN-12', 'high', 'low', 'Login with wrong password');
    test(t.title, t.details, async ({ page }) => {
      annotate('JIRA191-SCN-12');
      const { loginPage, inventoryPage } = pagesOf(page);
      await loginPage.open();
      await loginPage.login('standard_user', 'wrong_pass');
      await loginPage.expectLoginError(/Username and password do not match any user in this service/i);
      await expect(page).not.toHaveURL(/inventory\.html/);
      await expect(targetItem(inventoryPage)).toHaveCount(0);
    });
  }

  {
    const t = tagged('JIRA191-SCN-13', 'high', 'low', 'Login with unknown username');
    test(t.title, t.details, async ({ page }) => {
      annotate('JIRA191-SCN-13');
      const { loginPage } = pagesOf(page);
      await loginPage.open();
      await loginPage.login('invalid_user', PASSWORD);
      await loginPage.expectLoginError(/do not match any user/i);
      await loginPage.goto('/inventory.html');
      await loginPage.expectOnLoginPage();
    });
  }

  {
    const t = tagged('JIRA191-SCN-14', 'high', 'low', 'Login with locked_out_user');
    test(t.title, t.details, async ({ page }) => {
      annotate('JIRA191-SCN-14');
      const { loginPage, inventoryPage } = pagesOf(page);
      await loginPage.open();
      await loginPage.login('locked_out_user', PASSWORD);
      await loginPage.expectLoginError(/Sorry, this user has been locked out/i);
      await expect(page).not.toHaveURL(/inventory\.html/);
      await expect(inventoryPage.inventoryList).toBeHidden();
    });
  }

  // JIRA191-SCN-15 (NEG-4) and JIRA191-SCN-16 (NEG-5) are mapped onto
  // tests/JIRA-1.spec.ts '[SCN-23]' and '[SCN-24]'.

  {
    const t = tagged('JIRA191-SCN-17', 'high', 'medium', 'Direct access to inventory without login');
    test(t.title, t.details, async ({ page }) => {
      annotate('JIRA191-SCN-17');
      const { loginPage, inventoryPage } = pagesOf(page);
      await loginPage.goto('/inventory.html');
      await loginPage.expectOnLoginPage();
      await loginPage.expectLoginError(/You can only access '\/inventory\.html' when you are logged in/i);
      await expect(targetItem(inventoryPage)).toHaveCount(0);
      await expect(inventoryPage.inventoryList).toBeHidden();
    });
  }

  {
    const t = tagged('JIRA191-SCN-18', 'high', 'medium', 'Direct access to product detail without login');
    test(t.title, t.details, async ({ page }) => {
      annotate('JIRA191-SCN-18');
      const { loginPage } = pagesOf(page);
      await loginPage.goto('/inventory-item.html?id=1');
      await loginPage.expectOnLoginPage();
      await expect(loginPage.errorMessage).toBeVisible();
      await expect(page.getByTestId('inventory-item-name')).toHaveCount(0);
      await expect(page.getByTestId('inventory-item-price')).toHaveCount(0);
    });
  }

  {
    const t = tagged('JIRA191-SCN-19', 'low', 'low', 'Non-existent product name (near-matches)');
    test(t.title, t.details, async ({ page }) => {
      annotate('JIRA191-SCN-19');
      await loginAsStandard(page);
      for (const name of ['Sauce Labs Bolt Shirt', 'Sauce Labs Bolt T-Shirts']) {
        await expect(page.getByText(name, { exact: true })).toHaveCount(0);
      }
      await expect(page.getByText(TARGET, { exact: true })).toHaveCount(1);
    });
  }

  {
    const t = tagged('JIRA191-SCN-20', 'low', 'medium', 'Invalid product id on detail page');
    test(t.title, t.details, async ({ page }) => {
      annotate('JIRA191-SCN-20');
      const pageErrors: string[] = [];
      page.on('pageerror', (e) => pageErrors.push(e.message));
      const { inventoryPage } = await loginAsStandard(page);

      await inventoryPage.goto('/inventory-item.html?id=999');
      await expect(page.getByText(TARGET, { exact: true })).toHaveCount(0);
      await expect(page.getByText(`$${TARGET_PRICE}`)).toHaveCount(0);

      const notFound = page.getByText(/item not found/i);
      const copyShown = (await notFound.count()) > 0 ? await notFound.first().innerText() : '(no "Item not found" text)';
      test.info().annotations.push({
        type: 'Requirement gap',
        description: `Actual copy for invalid product id: ${copyShown}`,
      });
      expect(pageErrors, `Unexpected page errors: ${pageErrors.join('; ')}`).toHaveLength(0);
    });
  }

  {
    const t = tagged('JIRA191-SCN-21', 'high', 'medium', 'Session ended then revisit via browser Back');
    test(t.title, t.details, async ({ page }) => {
      annotate('JIRA191-SCN-21');
      const { loginPage, inventoryPage } = await loginAsStandard(page);
      await inventoryPage.logout();
      await loginPage.expectOnLoginPage();
      await page.goBack();
      await loginPage.expectOnLoginPage();
      await expect(inventoryPage.inventoryList).toBeHidden();
      await expect(targetItem(inventoryPage)).toHaveCount(0);
    });
  }

  // -------------------------------------------------------------- EDGE
  {
    const t = tagged('JIRA191-SCN-22', 'low', 'high', 'problem_user product display');
    test(t.title, t.details, async ({ page }) => {
      annotate('JIRA191-SCN-22');
      const { inventoryPage } = await loginAs(page, 'problem_user');
      await inventoryPage.expectLoaded();
      const item = targetItem(inventoryPage);
      await expect(item).toBeVisible();

      const listed = await readListEntry(item);
      await item.getByTestId('inventory-item-name').click();
      await page.getByTestId('inventory-item-name').waitFor();
      const detail = await readDetail(page);

      // Known-issue account: record defects instead of failing.
      for (const field of ['name', 'price', 'img'] as const) {
        if (listed[field] !== detail[field]) {
          test.info().annotations.push({
            type: 'problem_user defect',
            description: `${field} mismatch: list="${listed[field]}" detail="${detail[field]}"`,
          });
        }
      }
      const broken = await page.evaluate(() =>
        Array.from(document.images).filter((i) => !i.complete || i.naturalWidth === 0).length
      );
      if (broken > 0) {
        test.info().annotations.push({ type: 'problem_user defect', description: `${broken} broken image(s) on detail page` });
      }
    });
  }

  {
    const t = tagged('JIRA191-SCN-23', 'low', 'medium', 'performance_glitch_user latency tolerance');
    test(t.title, t.details, async ({ page }) => {
      annotate('JIRA191-SCN-23');
      const start = Date.now();
      const { inventoryPage } = await loginAs(page, 'performance_glitch_user');
      await inventoryPage.expectLoaded();
      await expect(targetItem(inventoryPage)).toBeVisible();
      test.info().annotations.push({ type: 'Elapsed ms', description: String(Date.now() - start) });
    });
  }

  {
    const t = tagged('JIRA191-SCN-24', 'low', 'medium', 'visual_user and error_user product display');
    test(t.title, t.details, async ({ page }) => {
      annotate('JIRA191-SCN-24');
      for (const user of ['visual_user', 'error_user']) {
        await test.step(user, async () => {
          await page.context().clearCookies();
          const { inventoryPage } = await loginAs(page, user);
          await inventoryPage.expectLoaded();
          const item = targetItem(inventoryPage);
          await expect(item).toBeVisible();
          await test.info().attach(`${user}-inventory`, {
            body: await page.screenshot(),
            contentType: 'image/png',
          });
          const price = await inventoryPage.getProductPrice(TARGET);
          test.info().annotations.push({
            type: `${user} observation`,
            description: `price=${price} (standard=${TARGET_PRICE}), items=${await inventoryPage.inventoryItems.count()}`,
          });
        });
      }
    });
  }

  {
    const t = tagged('JIRA191-SCN-25', 'medium', 'low', 'Product uniqueness among T-Shirt items');
    test(t.title, t.details, async ({ page }) => {
      annotate('JIRA191-SCN-25');
      const { inventoryPage } = await loginAsStandard(page);
      expect(await inventoryPage.inventoryItems.filter({ hasText: 'Bolt T-Shirt' }).count()).toBe(1);
      expect(await inventoryPage.inventoryItems.filter({ hasText: 'T-Shirt' }).count()).toBe(2);
      await expect(page.getByText(TARGET, { exact: true })).toHaveCount(1);
      // JIRA192-SCN-23: the red T-Shirt is a different item from the target.
      const red = inventoryPage.inventoryItems.filter({ hasText: 'Test.allTheThings() T-Shirt (Red)' });
      await expect(red).toHaveCount(1);
      await expect(red.getByTestId('inventory-item-name')).not.toHaveText(TARGET);
      await expect(targetItem(inventoryPage).filter({ hasText: 'Test.allTheThings()' })).toHaveCount(0);
    });
  }

  {
    const t = tagged('JIRA191-SCN-26', 'medium', 'low', 'Name-based locator independent of position');
    test(t.title, t.details, async ({ page }) => {
      annotate('JIRA191-SCN-26');
      const { inventoryPage } = await loginAsStandard(page);
      const indexOfTarget = async () =>
        (await inventoryPage.inventoryItems.getByTestId('inventory-item-name').allTextContents()).indexOf(TARGET);
      const seenIndexes = new Set<number>();

      for (const option of ['az', 'za', 'lohi', 'hilo']) {
        await test.step(`Sort ${option} then reload`, async () => {
          await inventoryPage.sortDropdown.selectOption(option);
          seenIndexes.add(await indexOfTarget());
          for (const reloaded of [false, true]) {
            if (reloaded) {
              await page.reload();
              await inventoryPage.expectLoaded();
            }
            const item = targetItem(inventoryPage);
            await expect(item).toHaveCount(1);
            expect((await readListEntry(item)).price).toBe(`$${TARGET_PRICE}`);
            await expect(item.locator('img')).toHaveAttribute('src', /bolt-shirt/);
          }
        });
      }
      expect(seenIndexes.size, 'Target position should vary across sort orders').toBeGreaterThan(1);
    });
  }

  {
    const t = tagged('JIRA191-SCN-27', 'medium', 'medium', 'Page refresh on inventory keeps session');
    test(t.title, t.details, async ({ page }) => {
      annotate('JIRA191-SCN-27');
      const { inventoryPage } = await loginAsStandard(page);
      await page.reload();
      await inventoryPage.expectUrlContains('/inventory.html');
      await expect(targetItem(inventoryPage)).toBeVisible();
      await expect(new LoginPage(page).loginButton).toBeHidden();
    });
  }

  // JIRA191-SCN-28 (EDGE-7) is mapped onto tests/JIRA-190.spec.ts '[JIRA190-SCN-33]'.

  {
    const t = tagged('JIRA191-SCN-29', 'low', 'low', 'Username case sensitivity and whitespace');
    test(t.title, t.details, async ({ page }) => {
      annotate('JIRA191-SCN-29');
      const { loginPage, inventoryPage } = pagesOf(page);

      await loginPage.open();
      await loginPage.login('Standard_User', PASSWORD);
      await loginPage.expectLoginError(/do not match any user/i);

      await loginPage.open();
      await loginPage.login(' standard_user ', PASSWORD);
      await expect(loginPage.errorMessage.or(inventoryPage.inventoryList)).toBeVisible();
      if (page.url().includes('inventory.html')) {
        test.info().annotations.push({
          type: 'Requirement gap',
          description: 'Username with surrounding whitespace was accepted (trimmed) and logged in',
        });
      } else {
        test.info().annotations.push({
          type: 'Requirement gap',
          description: 'Username with surrounding whitespace was rejected; trimming behavior unspecified',
        });
        await loginPage.goto('/inventory.html');
        await loginPage.expectOnLoginPage();
      }
    });
  }

  {
    // Runs on every project (chromium, firefox, webkit, mobile-iphone).
    const t = tagged('JIRA191-SCN-30', 'medium', 'medium', 'Cross-browser and mobile viewport rendering');
    test(t.title, t.details, async ({ page }, testInfo) => {
      annotate('JIRA191-SCN-30');
      const { inventoryPage } = await loginAsStandard(page);
      const name = targetItem(inventoryPage).getByTestId('inventory-item-name');
      await expect(name).toBeVisible();
      const box = await name.boundingBox();
      expect(box, 'name bounding box').not.toBeNull();
      expect(box!.width).toBeGreaterThan(0);
      const viewport = page.viewportSize();
      if (viewport) expect(box!.width).toBeLessThanOrEqual(viewport.width);
      // JIRA192-SCN-28: name text is not clipped.
      const clipped = await name.evaluate((el) => el.scrollWidth > el.clientWidth);
      expect(clipped, 'product name should not be clipped').toBe(false);
      await testInfo.attach(`inventory-${testInfo.project.name}`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
    });
  }

  {
    const t = tagged('JIRA191-SCN-31', 'low', 'low', 'Cart state does not affect identification');
    test(t.title, t.details, async ({ page }) => {
      annotate('JIRA191-SCN-31');
      const { inventoryPage, cartPage } = await loginAsStandard(page);
      await inventoryPage.addProductToCart(TARGET);
      await inventoryPage.goToCart();
      await cartPage.continueShoppingButton.click();
      // JIRA192-SCN-27: also revisit the inventory by direct navigation.
      await inventoryPage.goto('/inventory.html');
      const item = targetItem(inventoryPage);
      await expect(item).toHaveCount(1);
      await expect(item).toBeVisible();
      await expect(inventoryPage.removeFromCartButton(TARGET)).toBeVisible();
      await inventoryPage.expectCartBadgeCount(1);
    });
  }
});
