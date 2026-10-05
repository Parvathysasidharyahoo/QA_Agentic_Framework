import { test, expect, Page, Locator } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { InventoryPage } from '../pages/InventoryPage';
import { CartPage } from '../pages/CartPage';

// Scenarios from TestDesign/JIRA-193_PlaywrightScenarios.csv (SCN-1..SCN-31), classified by
// TestDesign/JIRA-193_Coverage.json. Scenario IDs are qualified ("JIRA193-SCN-<n>").
//
// Implemented here (visual_user session, or visual_user vs standard_user comparison):
//   partial -> completed: 1, 4, 5
//   not covered:          3, 6, 7, 8, 9, 10, 11, 12, 23, 24, 25, 28, 29, 30, 31
// Mapped onto existing tests (tag + annotation added there, nothing re-implemented):
//   JIRA193-SCN-2  -> tests/JIRA-191.spec.ts [JIRA191-SCN-2]
//   JIRA193-SCN-13 -> tests/JIRA-191.spec.ts [JIRA191-SCN-12]; tests/JIRA-1.spec.ts [SCN-22]
//   JIRA193-SCN-14 -> tests/JIRA-191.spec.ts [JIRA191-SCN-13]; tests/JIRA-1.spec.ts [SCN-21]
//   JIRA193-SCN-15 -> tests/JIRA-191.spec.ts [JIRA191-SCN-14]
//   JIRA193-SCN-16 -> tests/JIRA-1.spec.ts   [SCN-23]
//   JIRA193-SCN-17 -> tests/JIRA-1.spec.ts   [SCN-24]
//   JIRA193-SCN-18 -> tests/JIRA-191.spec.ts [JIRA191-SCN-17]; tests/JIRA-1.spec.ts [SCN-30]
//   JIRA193-SCN-19 -> tests/JIRA-191.spec.ts [JIRA191-SCN-18]
//   JIRA193-SCN-20 -> tests/JIRA-191.spec.ts [JIRA191-SCN-19]
//   JIRA193-SCN-21 -> tests/JIRA-191.spec.ts [JIRA191-SCN-20]
//   JIRA193-SCN-22 -> tests/JIRA-191.spec.ts [JIRA191-SCN-21]
//   JIRA193-SCN-26 -> tests/JIRA-190.spec.ts [JIRA190-SCN-33]
//   JIRA193-SCN-27 -> tests/JIRA-191.spec.ts [JIRA191-SCN-29]
// JIRA193-SCN-29 (cross-browser / mobile) runs on the extra projects in playwright.config.ts.

const TARGET = 'Sauce Labs Bolt T-Shirt';
const TARGET_PRICE = '$15.99';
const PASSWORD = 'secret_sauce';

async function loginAs(page: Page, user: string) {
  const loginPage = new LoginPage(page);
  const inventoryPage = new InventoryPage(page);
  await loginPage.open();
  await loginPage.login(user, PASSWORD);
  await inventoryPage.expectLoaded();
  return { loginPage, inventoryPage, cartPage: new CartPage(page) };
}

const loginVisual = (page: Page) => loginAs(page, 'visual_user');

function target(inventoryPage: InventoryPage): Locator {
  return inventoryPage.inventoryItems.filter({ hasText: TARGET });
}

function meta(id: string, priority: string, risk: string, title: string) {
  return {
    title: `[${id}] ${title}`,
    details: { tag: [`@${id}`, `@priority-${priority}`, `@risk-${risk}`] },
  };
}

function note(type: string, description: string) {
  test.info().annotations.push({ type, description });
}

async function readList(item: Locator) {
  return {
    name: ((await item.getByTestId('inventory-item-name').textContent()) ?? '').trim(),
    desc: ((await item.getByTestId('inventory-item-desc').textContent()) ?? '').trim(),
    price: ((await item.getByTestId('inventory-item-price').textContent()) ?? '').trim(),
    img: (await item.locator('img').getAttribute('src')) ?? '',
  };
}

async function readDetail(page: Page) {
  return {
    name: ((await page.getByTestId('inventory-item-name').textContent()) ?? '').trim(),
    desc: ((await page.getByTestId('inventory-item-desc').textContent()) ?? '').trim(),
    price: ((await page.getByTestId('inventory-item-price').textContent()) ?? '').trim(),
    img: (await page.locator('img.inventory_details_img').getAttribute('src')) ?? '',
  };
}

function diffs(label: string, a: Record<string, unknown>, b: Record<string, unknown>) {
  for (const key of Object.keys(a)) {
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) {
      note('visual_user difference', `${label} ${key}: standard=${JSON.stringify(a[key])} visual=${JSON.stringify(b[key])}`);
    }
  }
}

test.describe('JIRA-193 — Identify "Sauce Labs Bolt T-Shirt" as visual_user', () => {
  // ---------------------------------------------------------------- TS
  {
    const m = meta('JIRA193-SCN-1', 'high', 'medium', 'Login as visual_user and identify the product');
    test(m.title, m.details, async ({ page }) => {
      note('Scenario ID', 'JIRA193-SCN-1');
      const { inventoryPage } = await loginVisual(page);
      const item = target(inventoryPage);
      await expect(item).toHaveCount(1);
      await expect(item).toBeVisible();
      await expect(item.getByTestId('inventory-item-name')).toHaveText(TARGET);
    });
  }

  {
    const m = meta('JIRA193-SCN-3', 'medium', 'medium', 'Product identifiable despite visual differences vs standard_user');
    test(m.title, m.details, async ({ browser }) => {
      note('Scenario ID', 'JIRA193-SCN-3');
      const collect = async (user: string) => {
        const context = await browser.newContext();
        try {
          const page = await context.newPage();
          const { inventoryPage } = await loginAs(page, user);
          const item = target(inventoryPage);
          await expect(item).toHaveCount(1);
          const list = await readList(item);
          await item.getByTestId('inventory-item-name').click();
          await expect(page.getByTestId('inventory-item-name')).toHaveText(TARGET);
          return { list, detail: await readDetail(page) };
        } finally {
          await context.close();
        }
      };
      const standard = await collect('standard_user');
      const visual = await collect('visual_user');

      expect(visual.list.name).toBe(standard.list.name);
      expect(visual.detail.name).toBe(standard.detail.name);
      expect(visual.list.name).toBe(TARGET);
      diffs('list', standard.list, visual.list);
      diffs('detail', standard.detail, visual.detail);
    });
  }

  // --------------------------------------------------------------- POS
  {
    const m = meta('JIRA193-SCN-4', 'high', 'low', 'Login with visual_user');
    test(m.title, m.details, async ({ page }) => {
      note('Scenario ID', 'JIRA193-SCN-4');
      const loginPage = new LoginPage(page);
      const inventoryPage = new InventoryPage(page);
      await loginPage.open();
      await loginPage.login('visual_user', PASSWORD);
      await loginPage.expectUrlContains('/inventory.html');
      await inventoryPage.expectLoaded();
      await expect(loginPage.errorMessage).toBeHidden();
    });
  }

  {
    const m = meta('JIRA193-SCN-5', 'high', 'medium', 'Target product displayed for visual_user');
    test(m.title, m.details, async ({ page }) => {
      note('Scenario ID', 'JIRA193-SCN-5');
      const { inventoryPage } = await loginVisual(page);
      const item = target(inventoryPage);
      await expect(item).toHaveCount(1);
      await expect(item.locator('img')).toBeVisible();
      const price = item.getByTestId('inventory-item-price');
      await expect(price).toBeVisible();
      const actual = ((await price.textContent()) ?? '').trim();
      note('visual_user price', `actual=${actual} expected=${TARGET_PRICE} matches=${actual === TARGET_PRICE}`);
      await expect(item.getByRole('button', { name: /add to cart/i })).toBeVisible();
    });
  }

  {
    const m = meta('JIRA193-SCN-6', 'medium', 'low', 'Product name is an exact match');
    test(m.title, m.details, async ({ page }) => {
      note('Scenario ID', 'JIRA193-SCN-6');
      const { inventoryPage } = await loginVisual(page);
      const name = target(inventoryPage).getByTestId('inventory-item-name');
      await expect(name).toHaveText(TARGET);
      expect(((await name.textContent()) ?? '')).toBe(TARGET);
    });
  }

  {
    const m = meta('JIRA193-SCN-7', 'medium', 'low', 'Open product detail page by clicking name');
    test(m.title, m.details, async ({ page }) => {
      note('Scenario ID', 'JIRA193-SCN-7');
      const { inventoryPage } = await loginVisual(page);
      await target(inventoryPage).getByTestId('inventory-item-name').click();
      await inventoryPage.expectUrlContains('/inventory-item.html\\?id=1');
      await expect(page.getByTestId('inventory-item-name')).toHaveText(TARGET);
      await expect(page.getByTestId('inventory-item-desc')).toBeVisible();
      await expect(page.getByTestId('inventory-item-price')).toBeVisible();
    });
  }

  {
    const m = meta('JIRA193-SCN-8', 'low', 'low', 'Open product detail page by clicking image');
    test(m.title, m.details, async ({ page }) => {
      note('Scenario ID', 'JIRA193-SCN-8');
      const { inventoryPage } = await loginVisual(page);

      // Reference: name-link flow.
      await target(inventoryPage).getByTestId('inventory-item-name').click();
      await expect(page.getByTestId('inventory-item-name')).toHaveText(TARGET);
      const viaName = await readDetail(page);
      await page.getByTestId('back-to-products').click();
      await inventoryPage.expectLoaded();

      await target(inventoryPage).locator('img').click();
      await inventoryPage.expectUrlContains('/inventory-item.html\\?id=1');
      await expect(page.getByTestId('inventory-item-name')).toHaveText(TARGET);
      const viaImage = await readDetail(page);
      expect(viaImage.name).toBe(viaName.name);
      expect(viaImage.desc).toBe(viaName.desc);
      expect(viaImage.price).toBe(viaName.price);
      await expect(page.getByTestId('inventory-item-desc')).toBeVisible();
      await expect(page.getByTestId('inventory-item-price')).toBeVisible();
    });
  }

  {
    const m = meta('JIRA193-SCN-9', 'low', 'low', 'Back to products from detail page');
    test(m.title, m.details, async ({ page }) => {
      note('Scenario ID', 'JIRA193-SCN-9');
      const { inventoryPage } = await loginVisual(page);
      await target(inventoryPage).getByTestId('inventory-item-name').click();
      await inventoryPage.expectUrlContains('/inventory-item.html');
      await page.getByTestId('back-to-products').click();
      await inventoryPage.expectUrlContains('/inventory.html');
      await inventoryPage.expectLoaded();
      await expect(target(inventoryPage)).toHaveCount(1);
      await expect(target(inventoryPage)).toBeVisible();
    });
  }

  {
    const m = meta('JIRA193-SCN-10', 'medium', 'medium', 'Identify product after each sort order');
    test(m.title, m.details, async ({ page }) => {
      note('Scenario ID', 'JIRA193-SCN-10');
      const { inventoryPage } = await loginVisual(page);
      const names = () => inventoryPage.inventoryItems.getByTestId('inventory-item-name').allTextContents();
      let previous = await names();
      let orderChanged = false;
      for (const option of ['za', 'lohi', 'hilo']) {
        await test.step(`Sort: ${option}`, async () => {
          await inventoryPage.sortDropdown.selectOption(option);
          await expect(target(inventoryPage)).toHaveCount(1);
          await expect(target(inventoryPage)).toBeVisible();
          const current = await names();
          if (JSON.stringify(current) !== JSON.stringify(previous)) orderChanged = true;
          previous = current;
        });
      }
      expect(orderChanged, 'list order should change across sort options').toBe(true);
    });
  }

  {
    const m = meta('JIRA193-SCN-11', 'medium', 'low', 'Add identified product to cart');
    test(m.title, m.details, async ({ page }) => {
      note('Scenario ID', 'JIRA193-SCN-11');
      const { inventoryPage, cartPage } = await loginVisual(page);
      await inventoryPage.addProductToCart(TARGET);
      await expect(inventoryPage.removeFromCartButton(TARGET)).toHaveText(/remove/i);
      await inventoryPage.expectCartBadgeCount(1);
      await inventoryPage.goToCart();
      await cartPage.expectItemInCart(TARGET);
    });
  }

  {
    const m = meta('JIRA193-SCN-12', 'medium', 'medium', 'Visual comparison of target card vs standard_user baseline');
    test(m.title, m.details, async ({ browser }, testInfo) => {
      note('Scenario ID', 'JIRA193-SCN-12');
      const capture = async (user: string) => {
        const context = await browser.newContext();
        try {
          const page = await context.newPage();
          const { inventoryPage } = await loginAs(page, user);
          const item = target(inventoryPage);
          await expect(item).toBeVisible();
          const box = await item.boundingBox();
          const data = await readList(item);
          await testInfo.attach(`${user}-target-card`, { body: await item.screenshot(), contentType: 'image/png' });
          await expect(item.getByTestId('inventory-item-name')).toHaveText(TARGET);
          return { box, data };
        } finally {
          await context.close();
        }
      };
      const standard = await capture('standard_user');
      const visual = await capture('visual_user');

      expect(visual.data.name).toBe(standard.data.name);
      diffs('card', standard.data, visual.data);
      if (JSON.stringify(standard.box) !== JSON.stringify(visual.box)) {
        note('visual_user difference', `bounding box: standard=${JSON.stringify(standard.box)} visual=${JSON.stringify(visual.box)}`);
      }
    });
  }

  // -------------------------------------------------------------- EDGE
  {
    const m = meta('JIRA193-SCN-23', 'medium', 'low', 'Page refresh on inventory keeps session');
    test(m.title, m.details, async ({ page }) => {
      note('Scenario ID', 'JIRA193-SCN-23');
      const { inventoryPage } = await loginVisual(page);
      await page.reload();
      await inventoryPage.expectUrlContains('/inventory.html');
      await expect(target(inventoryPage)).toHaveCount(1);
      await expect(target(inventoryPage)).toBeVisible();
    });
  }

  {
    const m = meta('JIRA193-SCN-24', 'medium', 'low', 'Product uniqueness vs other T-Shirts');
    test(m.title, m.details, async ({ page }) => {
      note('Scenario ID', 'JIRA193-SCN-24');
      const { inventoryPage } = await loginVisual(page);
      await expect(inventoryPage.inventoryItems.filter({ hasText: 'Bolt T-Shirt' })).toHaveCount(1);
      expect(await inventoryPage.inventoryItems.filter({ hasText: 'T-Shirt' }).count()).toBeGreaterThanOrEqual(2);
      const red = inventoryPage.inventoryItems.filter({ hasText: 'Test.allTheThings() T-Shirt (Red)' });
      await expect(red).toHaveCount(1);
      await expect(red.getByTestId('inventory-item-name')).not.toHaveText(TARGET);
    });
  }

  {
    const m = meta('JIRA193-SCN-25', 'medium', 'medium', 'Name-based locator independent of position and layout');
    test(m.title, m.details, async ({ page }) => {
      note('Scenario ID', 'JIRA193-SCN-25');
      const { inventoryPage } = await loginVisual(page);
      const indexOfTarget = async () =>
        (await inventoryPage.inventoryItems.getByTestId('inventory-item-name').allTextContents()).indexOf(TARGET);
      const indexes = new Set<number>([await indexOfTarget()]);

      for (const option of ['za', 'lohi', 'hilo', 'az']) {
        await test.step(`Sort ${option}`, async () => {
          await inventoryPage.sortDropdown.selectOption(option);
          await expect(target(inventoryPage)).toHaveCount(1);
          await expect(target(inventoryPage)).toBeVisible();
          indexes.add(await indexOfTarget());
        });
      }
      await test.step('After reload', async () => {
        await page.reload();
        await inventoryPage.expectLoaded();
        await expect(target(inventoryPage)).toHaveCount(1);
        await expect(target(inventoryPage)).toBeVisible();
      });
      expect(indexes.size, 'target index should differ for at least one sort order').toBeGreaterThan(1);
    });
  }

  {
    const m = meta('JIRA193-SCN-28', 'low', 'low', 'Cart state does not affect identification');
    test(m.title, m.details, async ({ page }) => {
      note('Scenario ID', 'JIRA193-SCN-28');
      const { inventoryPage } = await loginVisual(page);
      await inventoryPage.addProductToCart(TARGET);
      await inventoryPage.goto('/inventory.html');
      await expect(target(inventoryPage)).toHaveCount(1);
      await expect(inventoryPage.removeFromCartButton(TARGET)).toHaveText(/remove/i);
    });
  }

  {
    // Runs on every project (chromium, firefox, webkit, mobile-iphone, mobile-375x667).
    const m = meta('JIRA193-SCN-29', 'medium', 'medium', 'Cross-browser and mobile viewport rendering for visual_user');
    test(m.title, m.details, async ({ page }, testInfo) => {
      note('Scenario ID', 'JIRA193-SCN-29');
      const { inventoryPage } = await loginVisual(page);
      const name = target(inventoryPage).getByTestId('inventory-item-name');
      await expect(name).toBeVisible();
      const box = await name.boundingBox();
      expect(box, 'name bounding box').not.toBeNull();
      expect(box!.width).toBeGreaterThan(0);
      const clipped = await name.evaluate((el) => el.scrollWidth > el.clientWidth);
      expect(clipped, 'product name should not be clipped').toBe(false);
      await testInfo.attach(`visual-user-${testInfo.project.name}`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
    });
  }

  {
    const m = meta('JIRA193-SCN-30', 'medium', 'medium', 'Visual glitches do not hide or overlap the product name');
    test(m.title, m.details, async ({ page }, testInfo) => {
      note('Scenario ID', 'JIRA193-SCN-30');
      const { inventoryPage } = await loginVisual(page);
      const item = target(inventoryPage);
      const nameLink = item.getByTestId('inventory-item-name');
      await expect(nameLink).toBeVisible();
      await expect(nameLink).toBeEnabled();

      const parts: Record<string, Locator> = {
        name: nameLink,
        image: item.locator('img'),
        price: item.getByTestId('inventory-item-price'),
        button: item.getByRole('button', { name: /add to cart/i }),
      };
      const boxes: Record<string, { x: number; y: number; width: number; height: number } | null> = {};
      for (const [key, loc] of Object.entries(parts)) boxes[key] = await loc.boundingBox();
      expect(boxes.name, 'name bounding box').not.toBeNull();

      // The element on top at the name's centre must be the name (or inside its link).
      const covered = await nameLink.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        const link = el.closest('a') ?? el;
        return !top || !(link.contains(top) || top.contains(el));
      });
      expect(covered, 'another element overlaps the product name').toBe(false);

      const intersects = (a: NonNullable<typeof boxes.name>, b: NonNullable<typeof boxes.name>) =>
        a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
      for (const other of ['image', 'price', 'button']) {
        const o = boxes[other];
        if (o && intersects(boxes.name!, o)) note('visual_user overlap', `name overlaps ${other}: ${JSON.stringify(o)}`);
      }
      note('visual_user boxes', JSON.stringify(boxes));
      await testInfo.attach('visual-user-target-card', { body: await item.screenshot(), contentType: 'image/png' });
    });
  }

  {
    const m = meta('JIRA193-SCN-31', 'low', 'medium', 'Consistency across repeated logins');
    test(m.title, m.details, async ({ page }) => {
      note('Scenario ID', 'JIRA193-SCN-31');
      const runs: { name: string; price: string; img: string; box: string }[] = [];
      for (let i = 1; i <= 3; i++) {
        await test.step(`Login #${i}`, async () => {
          const { inventoryPage } = await loginVisual(page);
          const item = target(inventoryPage);
          await expect(item).toHaveCount(1);
          const data = await readList(item);
          runs.push({ name: data.name, price: data.price, img: data.img, box: JSON.stringify(await item.boundingBox()) });
          await inventoryPage.logout();
          await new LoginPage(page).expectOnLoginPage();
        });
      }
      for (const r of runs) expect(r.name).toBe(TARGET);
      for (const key of ['price', 'img', 'box'] as const) {
        const values = new Set(runs.map((r) => r[key]));
        note('visual_user consistency', `${key} ${values.size === 1 ? 'constant' : 'varies'}: ${[...values].join(' | ')}`);
      }
    });
  }
});
