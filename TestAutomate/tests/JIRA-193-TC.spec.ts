import { test, expect, Page, Locator } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { InventoryPage } from '../pages/InventoryPage';

// Automation of TestDesign/JIRA-193_PlaywrightScenarios.csv (JIRA193-TC-001 .. TC-029).
//
// Every test carries its scenario ID as "@JIRA193-TC-<nnn>" plus a 'Scenario ID' annotation
// (TestReview F-03). The legacy JIRA193-SCN-<n> tests in JIRA-193.spec.ts and the JIRA191/JIRA1/
// JIRA190 tests are untouched. They come from an earlier scenario set, several only record
// outcomes, and none carries these IDs, so none is used to claim coverage (TestReview F-02).
//
// Review recommendations applied (TestReview/JIRA-193_TestReview.md):
//  - F-01: no "record, don't fail" for visual_user. TC-010/014/018/019/020/022/027 hard-assert
//    the expected values (bolt-shirt image that loads, $15.99, list == details, no overlap).
//    A visual_user glitch therefore fails the run; differences vs standard_user are also
//    attached as annotations for diagnosis. The glitches are not deterministic, so test.fail()
//    is deliberately not used.
//  - F-05: TC-002 and TC-006 run as visual_user (not standard_user / Standard_User).
//  - TC-004: the both-blank check is its own test ('Username is required').
//  - TC-008: injection in both username and password fields.
//  - TC-010: description non-empty, image really loaded (naturalWidth > 0).
//  - TC-012/014: details price compared with the listing price and with $15.99.
//  - TC-017: details are checked after each sort, not only visibility.
//  - TC-019: pairwise overlap + card-bounds + clipping checks, not just the name's centre point.
//  - TC-021: stored toHaveScreenshot baseline (generate once with --update-snapshots).
//  - TC-022: several reloads, each compared with the first render.
//  - TC-025: asserts a definite "Item not found" page (copy is an unverified assumption, as in
//    JIRA191-TC-023).
//  - TC-026: refresh on the DETAILS page, then browser Back (page.goBack()).
//  - TC-027: price and image checked after re-login, as visual_user.
//  - TC-029: runs the full TC-028 flow; config projects select it via @JIRA193-TC-029
//    (firefox, webkit, mobile, and edge).

const USER = 'visual_user';
const TARGET = 'Sauce Labs Bolt T-Shirt';
const TARGET_PRICE = '$15.99';
const TARGET_IMG = /bolt-shirt/;
const PASSWORD = 'secret_sauce';
const RELOADS = 3;

function annotate(id: string) {
  test.info().annotations.push({ type: 'Scenario ID', description: id });
}

function pagesOf(page: Page) {
  return { loginPage: new LoginPage(page), inventoryPage: new InventoryPage(page) };
}

async function loginAs(page: Page, user = USER) {
  const pages = pagesOf(page);
  await pages.loginPage.open();
  await pages.loginPage.login(user, PASSWORD);
  await pages.inventoryPage.expectLoaded();
  return pages;
}

function targetItem(inventoryPage: InventoryPage) {
  return inventoryPage.inventoryItems.filter({ hasText: TARGET });
}

async function imageLoaded(img: Locator) {
  await expect(img).toBeVisible();
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
    .toBe(true);
}

async function listEntry(item: Locator) {
  return {
    name: ((await item.getByTestId('inventory-item-name').textContent()) ?? '').trim(),
    desc: ((await item.getByTestId('inventory-item-desc').textContent()) ?? '').trim(),
    price: ((await item.getByTestId('inventory-item-price').textContent()) ?? '').trim(),
    img: (await item.locator('img').getAttribute('src')) ?? '',
  };
}

async function detailEntry(page: Page) {
  return {
    name: ((await page.getByTestId('inventory-item-name').textContent()) ?? '').trim(),
    desc: ((await page.getByTestId('inventory-item-desc').textContent()) ?? '').trim(),
    price: ((await page.getByTestId('inventory-item-price').textContent()) ?? '').trim(),
    img: (await page.locator('img.inventory_details_img').getAttribute('src')) ?? '',
  };
}

type Box = { x: number; y: number; width: number; height: number };
const intersects = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

// ---------------------------------------------------------------- Login
test.describe('JIRA-193 TC — Login', () => {
  test('[JIRA193-TC-001] Login as visual_user with valid credentials', { tag: ['@JIRA193-TC-001', '@priority-high'] }, async ({ page }) => {
    annotate('JIRA193-TC-001');
    const { loginPage, inventoryPage } = pagesOf(page);
    await loginPage.open();
    await loginPage.login(USER, PASSWORD);
    await expect(page).toHaveURL(/\/inventory\.html/);
    await inventoryPage.expectLoaded();
    await expect(inventoryPage.inventoryItems.first()).toBeVisible();
    await expect(loginPage.errorMessage).toHaveCount(0);
  });

  test('[JIRA193-TC-002] Login as visual_user with invalid password', { tag: ['@JIRA193-TC-002', '@priority-high'] }, async ({ page }) => {
    annotate('JIRA193-TC-002');
    const { loginPage, inventoryPage } = pagesOf(page);
    await loginPage.open();
    await loginPage.login(USER, 'wrong_pass'); // review F-05: visual_user, not standard_user
    await loginPage.expectLoginError(/username and password do not match any user/i);
    await expect(page).not.toHaveURL(/inventory\.html/);
    await expect(inventoryPage.inventoryItems).toHaveCount(0);
  });

  test('[JIRA193-TC-003] Login with unregistered username', { tag: ['@JIRA193-TC-003', '@priority-medium'] }, async ({ page }) => {
    annotate('JIRA193-TC-003');
    const { loginPage } = pagesOf(page);
    await loginPage.open();
    await loginPage.login('invalid_user', PASSWORD);
    await loginPage.expectLoginError(/username and password do not match any user/i);
    await expect(page).not.toHaveURL(/inventory\.html/);
    await loginPage.goto('/inventory.html');
    await loginPage.expectOnLoginPage(); // still not logged in
  });

  test('[JIRA193-TC-004] Login with empty fields', { tag: ['@JIRA193-TC-004', '@priority-medium'] }, async ({ page }) => {
    annotate('JIRA193-TC-004');
    const { loginPage } = pagesOf(page);
    await loginPage.open();
    await expect(loginPage.usernameInput).toHaveValue('');
    await expect(loginPage.passwordInput).toHaveValue('');
    await loginPage.loginButton.click();
    await loginPage.expectLoginError(/username is required/i);
    await expect(page).not.toHaveURL(/inventory\.html/);
  });

  test('[JIRA193-TC-005] Login with only username or only password', { tag: ['@JIRA193-TC-005', '@priority-medium'] }, async ({ page }) => {
    annotate('JIRA193-TC-005');
    const { loginPage } = pagesOf(page);
    await test.step('only username -> password required', async () => {
      await loginPage.open();
      await loginPage.login(USER, '');
      await loginPage.expectLoginError(/password is required/i);
      await expect(page).not.toHaveURL(/inventory\.html/);
    });
    await test.step('only password -> username required', async () => {
      await page.reload();
      await loginPage.login('', PASSWORD);
      await loginPage.expectLoginError(/username is required/i);
      await expect(page).not.toHaveURL(/inventory\.html/);
    });
  });

  test('[JIRA193-TC-006] Username is case-sensitive', { tag: ['@JIRA193-TC-006', '@priority-low'] }, async ({ page }) => {
    annotate('JIRA193-TC-006');
    const { loginPage, inventoryPage } = pagesOf(page);
    await loginPage.open();
    await loginPage.login('VISUAL_USER', PASSWORD);
    await loginPage.expectLoginError(/username and password do not match any user/i);
    await expect(page).not.toHaveURL(/inventory\.html/);
    await expect(inventoryPage.inventoryItems).toHaveCount(0);
  });

  test('[JIRA193-TC-007] Password field is masked', { tag: ['@JIRA193-TC-007', '@priority-low'] }, async ({ page }) => {
    annotate('JIRA193-TC-007');
    const { loginPage } = pagesOf(page);
    await loginPage.open();
    await loginPage.passwordInput.fill(PASSWORD);
    await expect(loginPage.passwordInput).toHaveAttribute('type', 'password');
  });

  test('[JIRA193-TC-008] SQL injection / special characters in login fields', { tag: ['@JIRA193-TC-008', '@priority-medium'] }, async ({ page }) => {
    annotate('JIRA193-TC-008');
    let dialogFired = false;
    page.on('dialog', async (d) => {
      dialogFired = true;
      await d.dismiss();
    });
    const { loginPage } = pagesOf(page);
    const injection = "' OR '1'='1";
    for (const [user, pass] of [
      [injection, PASSWORD],
      [USER, injection],
    ]) {
      await loginPage.open();
      await loginPage.login(user, pass);
      await loginPage.expectLoginError(/username and password do not match any user/i);
      await expect(page).not.toHaveURL(/inventory\.html/);
      await expect(loginPage.errorMessage).not.toContainText(/sql|syntax|exception|stack/i);
    }
    expect(dialogFired, 'A JS dialog fired — injected script executed').toBe(false);
  });
});

// ---------------------------------------------------------------- Product identification
test.describe('JIRA-193 TC — Product identification', () => {
  test('[JIRA193-TC-009] Product is displayed after login as visual_user', { tag: ['@JIRA193-TC-009', '@priority-high'] }, async ({ page }) => {
    annotate('JIRA193-TC-009');
    const { inventoryPage } = await loginAs(page);
    const item = targetItem(inventoryPage);
    await expect(item).toBeVisible();
    await expect(item.getByTestId('inventory-item-name')).toHaveText(TARGET);
  });

  test('[JIRA193-TC-010] Product shows name, image, description and price', { tag: ['@JIRA193-TC-010', '@priority-high'] }, async ({ page }) => {
    annotate('JIRA193-TC-010');
    const { inventoryPage } = await loginAs(page);
    const item = targetItem(inventoryPage);
    await expect(item.getByTestId('inventory-item-name')).toHaveText(TARGET);
    const img = item.locator('img');
    await imageLoaded(img); // loaded, not merely visible (review F-04)
    await expect(img).toHaveAttribute('src', TARGET_IMG);
    const desc = item.getByTestId('inventory-item-desc');
    await expect(desc).toBeVisible();
    expect(((await desc.textContent()) ?? '').trim().length).toBeGreaterThan(0);
    await expect(item.getByTestId('inventory-item-price')).toHaveText(TARGET_PRICE);
  });

  test('[JIRA193-TC-011] Product name matches exactly on listing and details', { tag: ['@JIRA193-TC-011', '@priority-high'] }, async ({ page }) => {
    annotate('JIRA193-TC-011');
    const { inventoryPage } = await loginAs(page);
    const name = targetItem(inventoryPage).getByTestId('inventory-item-name');
    await expect(name).toHaveText(TARGET);
    expect(await name.evaluate((el) => el.scrollWidth > el.clientWidth), 'name clipped on listing').toBe(false);
    await name.click();
    const detailName = page.getByTestId('inventory-item-name');
    await expect(detailName).toHaveText(TARGET);
    expect(await detailName.evaluate((el) => el.scrollWidth > el.clientWidth), 'name clipped on details').toBe(false);
  });

  test('[JIRA193-TC-012] Open product details by clicking product name', { tag: ['@JIRA193-TC-012', '@priority-high'] }, async ({ page }) => {
    annotate('JIRA193-TC-012');
    const { inventoryPage } = await loginAs(page);
    const listed = await listEntry(targetItem(inventoryPage));
    await targetItem(inventoryPage).getByTestId('inventory-item-name').click();
    await expect(page).toHaveURL(/\/inventory-item\.html\?id=1$/);
    await expect(page.getByTestId('inventory-item-name')).toHaveText(TARGET);
    // review F-04: details price must match the listing, not merely be visible.
    await expect(page.getByTestId('inventory-item-price')).toHaveText(TARGET_PRICE);
    expect((await detailEntry(page)).price).toBe(listed.price);
  });

  test('[JIRA193-TC-013] Open product details by clicking product image', { tag: ['@JIRA193-TC-013', '@priority-medium'] }, async ({ page }) => {
    annotate('JIRA193-TC-013');
    const { inventoryPage } = await loginAs(page);
    await targetItem(inventoryPage).locator('img').click();
    await expect(page).toHaveURL(/\/inventory-item\.html\?id=1$/);
    await expect(page.getByTestId('inventory-item-name')).toHaveText(TARGET);
  });

  test('[JIRA193-TC-014] Name and price consistent between listing and details', { tag: ['@JIRA193-TC-014', '@priority-medium'] }, async ({ page }) => {
    annotate('JIRA193-TC-014');
    const { inventoryPage } = await loginAs(page);
    const item = targetItem(inventoryPage);
    const listed = await listEntry(item);
    await item.getByTestId('inventory-item-name').click();
    await expect(page.getByTestId('inventory-item-name')).toHaveText(TARGET);
    const detail = await detailEntry(page);
    expect(detail.name).toBe(listed.name);
    expect(detail.price, 'details price vs listing price').toBe(listed.price); // asserted, not noted (F-01)
    expect(listed.price).toBe(TARGET_PRICE);
  });

  test('[JIRA193-TC-015] Product appears only once in the listing', { tag: ['@JIRA193-TC-015', '@priority-low'] }, async ({ page }) => {
    annotate('JIRA193-TC-015');
    const { inventoryPage } = await loginAs(page);
    await expect(targetItem(inventoryPage)).toHaveCount(1);
    await expect(page.getByTestId('inventory-item-name').filter({ hasText: TARGET })).toHaveCount(1);
  });

  test('[JIRA193-TC-016] Identify product among similar products', { tag: ['@JIRA193-TC-016', '@priority-medium'] }, async ({ page }) => {
    annotate('JIRA193-TC-016');
    const { inventoryPage } = await loginAs(page);
    await expect(targetItem(inventoryPage)).toHaveCount(1);
    const tShirts = inventoryPage.inventoryItems.filter({ hasText: 'T-Shirt' });
    await expect(tShirts).toHaveCount(2);
    const red = tShirts.filter({ hasText: 'Test.allTheThings() T-Shirt (Red)' });
    await expect(red).toHaveCount(1);
    await expect(red.getByTestId('inventory-item-name')).not.toHaveText(TARGET);
    await expect(targetItem(inventoryPage).filter({ hasText: 'Test.allTheThings()' })).toHaveCount(0);
  });

  test('[JIRA193-TC-017] Product identifiable after sorting the listing', { tag: ['@JIRA193-TC-017', '@priority-medium'] }, async ({ page }) => {
    annotate('JIRA193-TC-017');
    const { inventoryPage } = await loginAs(page);
    for (const option of ['az', 'za', 'lohi', 'hilo']) {
      await test.step(`Sort: ${option}`, async () => {
        await inventoryPage.sortDropdown.selectOption(option);
        const item = targetItem(inventoryPage);
        await expect(item).toHaveCount(1);
        await expect(item).toBeVisible();
        // review F-04: correct details after the sort, not only visibility.
        const listed = await listEntry(item);
        expect(listed.name).toBe(TARGET);
        expect(listed.price, `${option} listing price`).toBe(TARGET_PRICE);
        expect(listed.img, `${option} listing image`).toMatch(TARGET_IMG);
        expect(listed.desc.length).toBeGreaterThan(0);
        await item.getByTestId('inventory-item-name').click();
        await expect(page.getByTestId('inventory-item-name')).toHaveText(TARGET);
        await expect(page.getByTestId('inventory-item-price')).toHaveText(TARGET_PRICE);
        await page.getByTestId('back-to-products').click();
        await inventoryPage.expectLoaded();
      });
    }
  });

  test('[JIRA193-TC-023] Product listing not accessible without login', { tag: ['@JIRA193-TC-023', '@priority-high'] }, async ({ page }) => {
    annotate('JIRA193-TC-023');
    const { loginPage, inventoryPage } = pagesOf(page);
    await loginPage.goto('/inventory.html');
    await loginPage.expectOnLoginPage();
    await loginPage.expectLoginError(/you can only access '\/inventory\.html' when you are logged in/i);
    await expect(inventoryPage.inventoryItems).toHaveCount(0);
    await expect(inventoryPage.inventoryList).toBeHidden();
  });

  test('[JIRA193-TC-024] Product details page not accessible without login', { tag: ['@JIRA193-TC-024', '@priority-high'] }, async ({ page }) => {
    annotate('JIRA193-TC-024');
    const { loginPage } = pagesOf(page);
    await loginPage.goto('/inventory-item.html?id=1');
    await loginPage.expectOnLoginPage();
    await expect(loginPage.errorMessage).toBeVisible();
    await expect(page.getByTestId('inventory-item-name')).toHaveCount(0);
    await expect(page.getByTestId('inventory-item-price')).toHaveCount(0);
  });

  test('[JIRA193-TC-025] Invalid product id in details URL', { tag: ['@JIRA193-TC-025', '@priority-medium'] }, async ({ page }) => {
    annotate('JIRA193-TC-025');
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    const { inventoryPage } = await loginAs(page);
    await inventoryPage.goto('/inventory-item.html?id=9999');
    // One definite outcome (review F-04): "Item not found" page, no product, no crash.
    await expect(page.getByText(/item not found/i)).toBeVisible();
    await expect(page.getByText(TARGET, { exact: true })).toHaveCount(0);
    await expect(page.getByText(TARGET_PRICE)).toHaveCount(0);
    await expect(page.getByTestId('inventory-item-name')).toHaveCount(0);
    expect(pageErrors, `Unexpected page errors: ${pageErrors.join('; ')}`).toHaveLength(0);
  });

  test('[JIRA193-TC-026] Product identifiable after refresh and browser Back', { tag: ['@JIRA193-TC-026', '@priority-low'] }, async ({ page }) => {
    annotate('JIRA193-TC-026');
    const { loginPage, inventoryPage } = await loginAs(page);
    await targetItem(inventoryPage).getByTestId('inventory-item-name').click();
    await expect(page).toHaveURL(/\/inventory-item\.html\?id=1$/);

    await test.step('Refresh on the details page keeps product and session', async () => {
      await page.reload();
      await expect(page).toHaveURL(/\/inventory-item\.html\?id=1$/);
      await expect(page.getByTestId('inventory-item-name')).toHaveText(TARGET);
      await expect(page.getByTestId('inventory-item-price')).toHaveText(TARGET_PRICE);
      await expect(loginPage.loginButton).toBeHidden();
    });

    await test.step('Browser Back returns to the listing', async () => {
      await page.goBack(); // browser Back, not the in-app "Back to products" button
      await inventoryPage.expectLoaded();
      await expect(targetItem(inventoryPage)).toHaveCount(1);
      await expect(targetItem(inventoryPage)).toBeVisible();
      await expect(loginPage.loginButton).toBeHidden(); // session maintained
    });
  });

  test('[JIRA193-TC-027] Product visible after logout and re-login', { tag: ['@JIRA193-TC-027', '@priority-low'] }, async ({ page }) => {
    annotate('JIRA193-TC-027');
    const { loginPage, inventoryPage } = await loginAs(page);
    const before = await listEntry(targetItem(inventoryPage));

    await inventoryPage.logout();
    await loginPage.expectOnLoginPage();
    await loginPage.login(USER, PASSWORD);
    await inventoryPage.expectLoaded();

    const item = targetItem(inventoryPage);
    await expect(item).toHaveCount(1);
    const after = await listEntry(item);
    // review F-04: price and image checked, not only the name.
    expect(after.name).toBe(TARGET);
    expect(after.price).toBe(TARGET_PRICE);
    expect(after.img).toMatch(TARGET_IMG);
    expect(after).toEqual(before);
    await imageLoaded(item.locator('img'));
  });
});

// ---------------------------------------------------------------- Visual validation
test.describe('JIRA-193 TC — Visual validation', () => {
  test('[JIRA193-TC-018] Product image correct and not broken for visual_user', { tag: ['@JIRA193-TC-018', '@priority-high'] }, async ({ page, browser }) => {
    annotate('JIRA193-TC-018');
    // Reference render from standard_user in its own context (precondition for the comparison).
    const ctx = await browser.newContext();
    let standardImg = '';
    try {
      const stdPage = await ctx.newPage();
      const { inventoryPage: stdInventory } = await loginAs(stdPage, 'standard_user');
      standardImg = (await listEntry(targetItem(stdInventory))).img;
    } finally {
      await ctx.close();
    }

    const { inventoryPage } = await loginAs(page);
    const item = targetItem(inventoryPage);
    const listed = await listEntry(item);
    if (listed.img !== standardImg) {
      test.info().annotations.push({ type: 'visual_user difference', description: `img standard=${standardImg} visual=${listed.img}` });
    }
    // review F-01: a wrong or broken image must fail, it is not just logged.
    expect(listed.img, 'visual_user image src').toMatch(TARGET_IMG);
    expect(listed.img, 'visual_user image src equals standard_user').toBe(standardImg);
    await imageLoaded(item.locator('img'));
  });

  test('[JIRA193-TC-019] Product layout and alignment on listing', { tag: ['@JIRA193-TC-019', '@priority-medium'] }, async ({ page }) => {
    annotate('JIRA193-TC-019');
    const { inventoryPage } = await loginAs(page);
    const item = targetItem(inventoryPage);
    const name = item.getByTestId('inventory-item-name');
    const price = item.getByTestId('inventory-item-price');
    const button = item.getByRole('button', { name: /add to cart/i });
    await expect(name).toBeVisible();
    await expect(price).toBeVisible();
    await expect(button).toBeVisible();

    const card = (await item.boundingBox()) as Box;
    const boxes: Record<string, Box> = {
      name: (await name.boundingBox()) as Box,
      price: (await price.boundingBox()) as Box,
      button: (await button.boundingBox()) as Box,
    };
    expect(card, 'card box').toBeTruthy();
    const keys = Object.keys(boxes);
    for (const k of keys) {
      expect(boxes[k], `${k} box`).toBeTruthy();
      // fully inside the card (not cut off)
      const b = boxes[k];
      expect(b.x, `${k} left edge inside card`).toBeGreaterThanOrEqual(card.x - 1);
      expect(b.y, `${k} top edge inside card`).toBeGreaterThanOrEqual(card.y - 1);
      expect(b.x + b.width, `${k} right edge inside card`).toBeLessThanOrEqual(card.x + card.width + 1);
      expect(b.y + b.height, `${k} bottom edge inside card`).toBeLessThanOrEqual(card.y + card.height + 1);
    }
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        expect(intersects(boxes[keys[i]], boxes[keys[j]]), `${keys[i]} overlaps ${keys[j]}`).toBe(false);
      }
    }
    expect(await name.evaluate((el) => el.scrollWidth > el.clientWidth), 'name clipped').toBe(false);
    // Nothing else on top at the name's centre.
    const covered = await name.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const link = el.closest('a') ?? el;
      return !top || !(link.contains(top) || top.contains(el));
    });
    expect(covered, 'another element covers the product name').toBe(false);
  });

  test('[JIRA193-TC-020] Product price displayed correctly for visual_user', { tag: ['@JIRA193-TC-020', '@priority-medium'] }, async ({ page }) => {
    annotate('JIRA193-TC-020');
    const { inventoryPage } = await loginAs(page);
    const item = targetItem(inventoryPage);
    // Hard assertion against the expected $15.99 (previously only an annotation).
    await expect(item.getByTestId('inventory-item-price')).toHaveText(TARGET_PRICE);
    await item.getByTestId('inventory-item-name').click();
    await expect(page.getByTestId('inventory-item-price')).toHaveText(TARGET_PRICE);
  });

  // Needs committed baselines. Generate once with:
  //   npx playwright test JIRA-193-TC --project=chromium --grep @JIRA193-TC-021 --update-snapshots
  test('[JIRA193-TC-021] Visual comparison against baseline screenshot', { tag: ['@JIRA193-TC-021', '@priority-medium'] }, async ({ page }) => {
    annotate('JIRA193-TC-021');
    const { inventoryPage } = await loginAs(page);
    const item = targetItem(inventoryPage);
    await imageLoaded(item.locator('img'));
    await expect(item).toHaveScreenshot('visual-user-bolt-card-listing.png', { maxDiffPixelRatio: 0.01 });
    await item.getByTestId('inventory-item-name').click();
    const details = page.locator('[data-test="inventory-container"], #inventory_item_container').first();
    await imageLoaded(page.locator('img.inventory_details_img'));
    await expect(details).toHaveScreenshot('visual-user-bolt-details.png', { maxDiffPixelRatio: 0.01 });
  });

  test('[JIRA193-TC-022] Visual consistency across page refresh', { tag: ['@JIRA193-TC-022', '@priority-low'] }, async ({ page }) => {
    annotate('JIRA193-TC-022');
    const { inventoryPage } = await loginAs(page);
    const snapshot = async () => {
      const item = targetItem(inventoryPage);
      await expect(item).toHaveCount(1);
      await imageLoaded(item.locator('img'));
      return { entry: await listEntry(item), box: await item.boundingBox() };
    };
    const first = await snapshot();
    expect(first.entry.img).toMatch(TARGET_IMG);
    for (let i = 1; i <= RELOADS; i++) {
      await test.step(`Reload #${i}`, async () => {
        await page.reload();
        await inventoryPage.expectLoaded();
        const again = await snapshot();
        expect(again.entry, `card content after reload #${i}`).toEqual(first.entry);
        expect(again.box, `card box after reload #${i}`).toEqual(first.box);
      });
    }
  });
});

// ---------------------------------------------------------------- E2E / compatibility
async function fullFlow(page: Page) {
  const { loginPage, inventoryPage } = pagesOf(page);
  await loginPage.open();
  await expect(loginPage.loginButton).toBeVisible();
  await loginPage.login(USER, PASSWORD);
  await inventoryPage.expectLoaded();
  const item = targetItem(inventoryPage);
  await expect(item).toHaveCount(1);
  await expect(item.getByTestId('inventory-item-name')).toHaveText(TARGET);
  await item.getByTestId('inventory-item-name').click();
  await expect(page).toHaveURL(/\/inventory-item\.html\?id=1$/);
  await expect(page.getByTestId('inventory-item-name')).toHaveText(TARGET);
  await expect(page.getByTestId('inventory-item-price')).toHaveText(TARGET_PRICE);
  await expect(page.getByTestId('inventory-item-desc')).not.toBeEmpty();
  await imageLoaded(page.locator('img.inventory_details_img'));
}

test.describe('JIRA-193 TC — E2E and compatibility', () => {
  test('[JIRA193-TC-028] Full flow: login as visual_user and identify product', { tag: ['@JIRA193-TC-028', '@priority-high'] }, async ({ page }) => {
    annotate('JIRA193-TC-028');
    await fullFlow(page);
  });

  // Selected on firefox / webkit / mobile / edge projects via its tag (playwright.config.ts).
  test('[JIRA193-TC-029] Flow on supported browsers and mobile viewport', { tag: ['@JIRA193-TC-029', '@priority-medium'] }, async ({ page }, testInfo) => {
    annotate('JIRA193-TC-029');
    await fullFlow(page); // full TC-028 flow, not just the listing (review F-04)
    const viewport = page.viewportSize();
    if (viewport) {
      const box = await page.getByTestId('inventory-item-name').boundingBox();
      expect(box, 'name bounding box').not.toBeNull();
      expect(box!.width).toBeLessThanOrEqual(viewport.width);
    }
    await testInfo.attach(`visual-user-details-${testInfo.project.name}`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });
});
