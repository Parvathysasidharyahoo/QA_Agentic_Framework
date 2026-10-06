import { test, expect, Page, Locator } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { InventoryPage } from '../pages/InventoryPage';

// Automation of TestDesign/JIRA-191_PlaywrightScenarios.csv (JIRA191-TC-001 .. TC-029).
//
// Every test carries its scenario ID as "@JIRA191-TC-<nnn>" plus a 'Scenario ID' annotation
// (TestReview F-02). The legacy JIRA191-SCN-<n> tests in JIRA-191.spec.ts are untouched; they
// come from an earlier scenario set and several of them only record outcomes, so they are
// NOT used to claim coverage of these IDs (TestReview F-03/F-04).
//
// Review recommendations applied (TestReview/JIRA-191_TestReview.md):
//  - TC-004 (F-11): the both-blank check is its own test, asserting 'Username is required'.
//  - TC-008 (F-11): injection is exercised in both the username and the password field.
//  - TC-010 (F-04): description must be non-empty and the image must actually load
//    (naturalWidth > 0), not merely be visible.
//  - TC-017 (F-08): each sort order, including A-Z, is its own step with its own assertions.
//  - TC-018 / TC-019 (F-05): SauceDemo has no search; test.fixme placeholders (blocked).
//  - TC-020 (F-05): rewritten as "near-match names are not listed" (the applicable part).
//  - TC-023 (F-04): asserts a definite "Item not found" outcome and no product data,
//    not just a recorded text. (Unverified assumption: copy contains "not found".)
//  - TC-024 (F-03/F-04): refresh on the DETAILS page, then browser Back (page.goBack()),
//    not the in-app "Back to products" button.
//  - TC-025: re-login as standard_user (not visual_user as in JIRA193-SCN-31) and compare
//    name, price and image before/after.
//  - TC-026: image-loaded step implemented and an explicit time budget asserted.
//  - TC-027 (F-03/F-10): no "record rather than fail". Each account asserts the agreed
//    expectation (bolt-shirt image, name, price consistent list vs details). problem_user is
//    a known-defect account, so its test is test.fail() and flips to a failure once fixed.
//  - TC-029 (F-04): runs the full TC-028 flow; the firefox / webkit / mobile / edge projects
//    in playwright.config.ts select it by its @JIRA191-TC-029 tag.

const TARGET = 'Sauce Labs Bolt T-Shirt';
const TARGET_PRICE = '$15.99';
const TARGET_IMG = /bolt-shirt/;
const PASSWORD = 'secret_sauce';
// Open question Q6 (no agreed load time). Budget chosen to allow SauceDemo's ~5s
// performance_glitch_user delay; revisit when the product owner defines it.
const PERFORMANCE_BUDGET_MS = 15_000;

function annotate(id: string) {
  test.info().annotations.push({ type: 'Scenario ID', description: id });
}

function pagesOf(page: Page) {
  return { loginPage: new LoginPage(page), inventoryPage: new InventoryPage(page) };
}

async function loginAs(page: Page, user = 'standard_user') {
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

// ---------------------------------------------------------------- Login
test.describe('JIRA-191 TC — Login', () => {
  test('[JIRA191-TC-001] Login with valid credentials', { tag: ['@JIRA191-TC-001', '@priority-high'] }, async ({ page }) => {
    annotate('JIRA191-TC-001');
    const { loginPage, inventoryPage } = pagesOf(page);
    await loginPage.open();
    await loginPage.login('standard_user', PASSWORD);
    await expect(page).toHaveURL(/\/inventory\.html/);
    await inventoryPage.expectLoaded();
    await expect(inventoryPage.inventoryItems.first()).toBeVisible();
    await expect(loginPage.errorMessage).toHaveCount(0);
  });

  test('[JIRA191-TC-002] Login with invalid password', { tag: ['@JIRA191-TC-002', '@priority-high'] }, async ({ page }) => {
    annotate('JIRA191-TC-002');
    const { loginPage, inventoryPage } = pagesOf(page);
    await loginPage.open();
    await loginPage.login('standard_user', 'wrong_pass'); // valid user, wrong password
    await loginPage.expectLoginError(/username and password do not match any user/i);
    await expect(page).not.toHaveURL(/inventory\.html/);
    await expect(inventoryPage.inventoryItems).toHaveCount(0);
  });

  test('[JIRA191-TC-003] Login with unregistered username', { tag: ['@JIRA191-TC-003', '@priority-high'] }, async ({ page }) => {
    annotate('JIRA191-TC-003');
    const { loginPage } = pagesOf(page);
    await loginPage.open();
    await loginPage.login('invalid_user', PASSWORD);
    await loginPage.expectLoginError(/username and password do not match any user/i);
    await expect(page).not.toHaveURL(/inventory\.html/);
    await loginPage.goto('/inventory.html');
    await loginPage.expectOnLoginPage(); // still not logged in
  });

  test('[JIRA191-TC-004] Login with empty fields', { tag: ['@JIRA191-TC-004', '@priority-medium'] }, async ({ page }) => {
    annotate('JIRA191-TC-004');
    const { loginPage } = pagesOf(page);
    await loginPage.open();
    await expect(loginPage.usernameInput).toHaveValue('');
    await expect(loginPage.passwordInput).toHaveValue('');
    await loginPage.loginButton.click();
    // The app shows one error (the username one), not one per field.
    await loginPage.expectLoginError(/username is required/i);
    await expect(page).not.toHaveURL(/inventory\.html/);
  });

  test('[JIRA191-TC-005] Login with only username or only password', { tag: ['@JIRA191-TC-005', '@priority-medium'] }, async ({ page }) => {
    annotate('JIRA191-TC-005');
    const { loginPage } = pagesOf(page);
    await test.step('only username -> password required', async () => {
      await loginPage.open();
      await loginPage.login('standard_user', '');
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

  test('[JIRA191-TC-006] Locked-out customer cannot login', { tag: ['@JIRA191-TC-006', '@priority-medium'] }, async ({ page }) => {
    annotate('JIRA191-TC-006');
    const { loginPage, inventoryPage } = pagesOf(page);
    await loginPage.open();
    await loginPage.login('locked_out_user', PASSWORD);
    await loginPage.expectLoginError(/sorry, this user has been locked out/i);
    await expect(page).not.toHaveURL(/inventory\.html/);
    await expect(inventoryPage.inventoryList).toBeHidden();
  });

  test('[JIRA191-TC-007] Password field is masked', { tag: ['@JIRA191-TC-007', '@priority-low'] }, async ({ page }) => {
    annotate('JIRA191-TC-007');
    const { loginPage } = pagesOf(page);
    await loginPage.open();
    await loginPage.passwordInput.fill(PASSWORD);
    await expect(loginPage.passwordInput).toHaveAttribute('type', 'password');
  });

  test('[JIRA191-TC-008] SQL injection / special characters in login fields', { tag: ['@JIRA191-TC-008', '@priority-medium'] }, async ({ page }) => {
    annotate('JIRA191-TC-008');
    let dialogFired = false;
    page.on('dialog', async (d) => {
      dialogFired = true;
      await d.dismiss();
    });
    const { loginPage } = pagesOf(page);
    const injection = "' OR '1'='1";
    // Review F-11: both the username and the password field.
    for (const [user, pass] of [
      [injection, PASSWORD],
      ['standard_user', injection],
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
test.describe('JIRA-191 TC — Product identification', () => {
  test('[JIRA191-TC-009] Product is displayed after login', { tag: ['@JIRA191-TC-009', '@priority-high'] }, async ({ page }) => {
    annotate('JIRA191-TC-009');
    const { inventoryPage } = await loginAs(page);
    const item = targetItem(inventoryPage);
    await expect(item).toBeVisible();
    await expect(item.getByTestId('inventory-item-name')).toHaveText(TARGET);
  });

  test('[JIRA191-TC-010] Product shows name, image, description and price', { tag: ['@JIRA191-TC-010', '@priority-high'] }, async ({ page }) => {
    annotate('JIRA191-TC-010');
    const { inventoryPage } = await loginAs(page);
    const item = targetItem(inventoryPage);
    await expect(item.getByTestId('inventory-item-name')).toHaveText(TARGET);
    // Review F-04: image must actually load, description must not be blank.
    const img = item.locator('img');
    await imageLoaded(img);
    await expect(img).toHaveAttribute('src', TARGET_IMG);
    const desc = item.getByTestId('inventory-item-desc');
    await expect(desc).toBeVisible();
    expect(((await desc.textContent()) ?? '').trim().length).toBeGreaterThan(0);
    await expect(item.getByTestId('inventory-item-price')).toHaveText(TARGET_PRICE);
  });

  test('[JIRA191-TC-011] Open product details by clicking product name', { tag: ['@JIRA191-TC-011', '@priority-high'] }, async ({ page }) => {
    annotate('JIRA191-TC-011');
    const { inventoryPage } = await loginAs(page);
    await targetItem(inventoryPage).getByTestId('inventory-item-name').click();
    await expect(page).toHaveURL(/\/inventory-item\.html\?id=1$/);
    await expect(page.getByTestId('inventory-item-name')).toHaveText(TARGET);
    await expect(page.getByTestId('inventory-item-price')).toHaveText(TARGET_PRICE);
  });

  test('[JIRA191-TC-012] Open product details by clicking product image', { tag: ['@JIRA191-TC-012', '@priority-medium'] }, async ({ page }) => {
    annotate('JIRA191-TC-012');
    const { inventoryPage } = await loginAs(page);
    await targetItem(inventoryPage).locator('img').click();
    await expect(page).toHaveURL(/\/inventory-item\.html\?id=1$/);
    await expect(page.getByTestId('inventory-item-name')).toHaveText(TARGET);
  });

  test('[JIRA191-TC-013] Price and name consistent between listing and details', { tag: ['@JIRA191-TC-013', '@priority-medium'] }, async ({ page }) => {
    annotate('JIRA191-TC-013');
    const { inventoryPage } = await loginAs(page);
    const item = targetItem(inventoryPage);
    const listed = await listEntry(item);
    await item.getByTestId('inventory-item-name').click();
    await expect(page.getByTestId('inventory-item-name')).toHaveText(TARGET);
    const detail = await detailEntry(page);
    expect(detail.name).toBe(listed.name);
    expect(detail.price).toBe(listed.price);
    expect(listed.price).toBe(TARGET_PRICE);
  });

  test('[JIRA191-TC-014] Product name matches exactly (case and spelling)', { tag: ['@JIRA191-TC-014', '@priority-medium'] }, async ({ page }) => {
    annotate('JIRA191-TC-014');
    const { inventoryPage } = await loginAs(page);
    const name = targetItem(inventoryPage).getByTestId('inventory-item-name');
    await expect(name).toHaveText(TARGET); // toHaveText with a string is exact (after whitespace normalisation)
    expect(await name.evaluate((el) => el.scrollWidth > el.clientWidth), 'name clipped on listing').toBe(false);
    await name.click();
    const detailName = page.getByTestId('inventory-item-name');
    await expect(detailName).toHaveText(TARGET);
    expect(await detailName.evaluate((el) => el.scrollWidth > el.clientWidth), 'name clipped on details').toBe(false);
  });

  test('[JIRA191-TC-015] Product appears only once in the listing', { tag: ['@JIRA191-TC-015', '@priority-low'] }, async ({ page }) => {
    annotate('JIRA191-TC-015');
    const { inventoryPage } = await loginAs(page);
    await expect(targetItem(inventoryPage)).toHaveCount(1);
    await expect(page.getByTestId('inventory-item-name').filter({ hasText: TARGET })).toHaveCount(1);
  });

  test('[JIRA191-TC-016] Identify product among other products', { tag: ['@JIRA191-TC-016', '@priority-medium'] }, async ({ page }) => {
    annotate('JIRA191-TC-016');
    const { inventoryPage } = await loginAs(page);
    const tShirts = inventoryPage.inventoryItems.filter({ hasText: 'T-Shirt' });
    await expect(tShirts).toHaveCount(2);
    const red = tShirts.filter({ hasText: 'Test.allTheThings() T-Shirt (Red)' });
    await expect(red).toHaveCount(1);
    await expect(red.getByTestId('inventory-item-name')).not.toHaveText(TARGET);
    await expect(targetItem(inventoryPage)).toHaveCount(1);
    await expect(targetItem(inventoryPage).filter({ hasText: 'Test.allTheThings()' })).toHaveCount(0);
  });

  test('[JIRA191-TC-017] Product is identifiable after sorting the listing', { tag: ['@JIRA191-TC-017', '@priority-medium'] }, async ({ page }) => {
    annotate('JIRA191-TC-017');
    const { inventoryPage } = await loginAs(page);
    const names = () => inventoryPage.inventoryItems.getByTestId('inventory-item-name').allTextContents();
    for (const option of ['az', 'za', 'lohi', 'hilo']) {
      await test.step(`Sort: ${option}`, async () => {
        await inventoryPage.sortDropdown.selectOption(option);
        if (option === 'az' || option === 'za') {
          const sorted = await names();
          const expected = [...sorted].sort((a, b) => (option === 'az' ? a.localeCompare(b) : b.localeCompare(a)));
          expect(sorted).toEqual(expected);
        } else {
          const prices = await inventoryPage.getDisplayedPrices();
          const expected = [...prices].sort((a, b) => (option === 'lohi' ? a - b : b - a));
          expect(prices).toEqual(expected);
        }
        const item = targetItem(inventoryPage);
        await expect(item).toHaveCount(1);
        await expect(item).toBeVisible();
        await expect(item.getByTestId('inventory-item-price')).toHaveText(TARGET_PRICE);
      });
    }
  });

  // Blocked (F-05, Q3): SauceDemo has no search/filter box.
  test.fixme('[JIRA191-TC-018] Search/filter for product by name', { tag: ['@JIRA191-TC-018', '@priority-low'] }, async () => {
    annotate('JIRA191-TC-018');
    // Blocked: no search feature in the AUT. When added: fill 'Sauce Labs Bolt T-Shirt', submit, assert result.
  });

  test.fixme('[JIRA191-TC-019] Search with partial name or different case', { tag: ['@JIRA191-TC-019', '@priority-low'] }, async () => {
    annotate('JIRA191-TC-019');
    // Blocked: no search feature; expected behaviour unconfirmed. Split partial vs mixed-case (F-08) when built.
  });

  test('[JIRA191-TC-020] Non-existent / near-match product names are not listed', { tag: ['@JIRA191-TC-020', '@priority-low'] }, async ({ page }) => {
    annotate('JIRA191-TC-020');
    // Rewritten per F-05: with no search, the testable part is that near-match names don't exist.
    await loginAs(page);
    for (const name of ['Sauce Labs Bolt Shirt XYZ', 'Sauce Labs Bolt Shirt', 'Sauce Labs Bolt T-Shirts']) {
      await expect(page.getByText(name, { exact: true })).toHaveCount(0);
    }
    await expect(page.getByText(TARGET, { exact: true })).toHaveCount(1);
  });

  test('[JIRA191-TC-021] Product listing not accessible without login', { tag: ['@JIRA191-TC-021', '@priority-high'] }, async ({ page }) => {
    annotate('JIRA191-TC-021');
    const { loginPage, inventoryPage } = pagesOf(page);
    await loginPage.goto('/inventory.html');
    await loginPage.expectOnLoginPage();
    await loginPage.expectLoginError(/you can only access '\/inventory\.html' when you are logged in/i);
    await expect(inventoryPage.inventoryItems).toHaveCount(0);
    await expect(inventoryPage.inventoryList).toBeHidden();
  });

  test('[JIRA191-TC-022] Product details page not accessible without login', { tag: ['@JIRA191-TC-022', '@priority-high'] }, async ({ page }) => {
    annotate('JIRA191-TC-022');
    const { loginPage } = pagesOf(page);
    await loginPage.goto('/inventory-item.html?id=1');
    await loginPage.expectOnLoginPage();
    await expect(loginPage.errorMessage).toBeVisible();
    await expect(page.getByTestId('inventory-item-name')).toHaveCount(0);
    await expect(page.getByTestId('inventory-item-price')).toHaveCount(0);
  });

  test('[JIRA191-TC-023] Invalid product id in details URL', { tag: ['@JIRA191-TC-023', '@priority-medium'] }, async ({ page }) => {
    annotate('JIRA191-TC-023');
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    const { inventoryPage } = await loginAs(page);
    await inventoryPage.goto('/inventory-item.html?id=999');
    // Review F-04: one definite outcome — an "Item not found" page, no product, no crash.
    await expect(page.getByText(/item not found/i)).toBeVisible();
    await expect(page.getByText(TARGET, { exact: true })).toHaveCount(0);
    await expect(page.getByText(TARGET_PRICE)).toHaveCount(0);
    await expect(page.getByTestId('inventory-item-name')).toHaveCount(0);
    expect(pageErrors, `Unexpected page errors: ${pageErrors.join('; ')}`).toHaveLength(0);
  });

  test('[JIRA191-TC-024] Product identifiable after refresh and browser Back', { tag: ['@JIRA191-TC-024', '@priority-low'] }, async ({ page }) => {
    annotate('JIRA191-TC-024');
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
      await page.goBack();
      await inventoryPage.expectLoaded();
      await expect(targetItem(inventoryPage)).toHaveCount(1);
      await expect(targetItem(inventoryPage)).toBeVisible();
      await expect(loginPage.loginButton).toBeHidden(); // session maintained
    });
  });

  test('[JIRA191-TC-025] Product visible after logout and re-login', { tag: ['@JIRA191-TC-025', '@priority-low'] }, async ({ page }) => {
    annotate('JIRA191-TC-025');
    // standard_user (the generic customer), not visual_user as in JIRA193-SCN-31.
    const { loginPage, inventoryPage } = await loginAs(page, 'standard_user');
    const before = await listEntry(targetItem(inventoryPage));

    await inventoryPage.logout();
    await loginPage.expectOnLoginPage();
    await loginPage.login('standard_user', PASSWORD);
    await inventoryPage.expectLoaded();

    const item = targetItem(inventoryPage);
    await expect(item).toHaveCount(1);
    const after = await listEntry(item);
    expect(after).toEqual(before);
    expect(after.price).toBe(TARGET_PRICE);
    await imageLoaded(item.locator('img'));
  });

  test('[JIRA191-TC-026] Product listing renders for performance_glitch_user', { tag: ['@JIRA191-TC-026', '@priority-low'] }, async ({ page }) => {
    annotate('JIRA191-TC-026');
    test.setTimeout(60_000);
    const start = Date.now();
    const { inventoryPage } = await loginAs(page, 'performance_glitch_user');
    const item = targetItem(inventoryPage);
    await expect(item).toBeVisible({ timeout: PERFORMANCE_BUDGET_MS });
    const elapsed = Date.now() - start;
    test.info().annotations.push({ type: 'Elapsed ms', description: String(elapsed) });
    // Review F-04: image loaded and an explicit time limit (budget is an assumption, Q6).
    await imageLoaded(item.locator('img'));
    await expect(item.getByTestId('inventory-item-name')).toHaveText(TARGET);
    expect(elapsed, `login + listing took ${elapsed}ms`).toBeLessThanOrEqual(PERFORMANCE_BUDGET_MS);
  });

  // Review F-03: TC-027 must not just record defects. One test per account, each asserting
  // the same expectation; problem_user is a known-defect account -> test.fail().
  for (const user of ['standard_user', 'problem_user', 'visual_user', 'error_user']) {
    const tcTitle = `[JIRA191-TC-027] Product images and details render correctly for ${user}`;
    test(tcTitle, { tag: ['@JIRA191-TC-027', '@priority-medium'] }, async ({ page }) => {
      annotate('JIRA191-TC-027');
      if (user === 'problem_user') {
        test.fail(true, 'Known SauceDemo defect: problem_user shows wrong product images (dog photo).');
      }
      const { inventoryPage } = await loginAs(page, user);
      const item = targetItem(inventoryPage);
      await expect(item).toHaveCount(1);
      const listed = await listEntry(item);
      expect(listed.name).toBe(TARGET);
      expect(listed.desc.length).toBeGreaterThan(0);
      expect(listed.img, `${user} listing image`).toMatch(TARGET_IMG);
      await imageLoaded(item.locator('img'));

      await item.getByTestId('inventory-item-name').click();
      await expect(page.getByTestId('inventory-item-name')).toHaveText(TARGET);
      const detail = await detailEntry(page);
      expect(detail.name).toBe(listed.name);
      expect(detail.price, `${user} detail price vs listing`).toBe(listed.price);
      expect(detail.img, `${user} detail image`).toMatch(TARGET_IMG);
      await imageLoaded(page.locator('img.inventory_details_img'));
    });
  }
});

// ---------------------------------------------------------------- E2E / compatibility
async function fullFlow(page: Page) {
  const { loginPage, inventoryPage } = pagesOf(page);
  await loginPage.open();
  await expect(loginPage.loginButton).toBeVisible();
  await loginPage.login('standard_user', PASSWORD);
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

test.describe('JIRA-191 TC — E2E and compatibility', () => {
  test('[JIRA191-TC-028] Full flow: login and identify product', { tag: ['@JIRA191-TC-028', '@priority-high'] }, async ({ page }) => {
    annotate('JIRA191-TC-028');
    await fullFlow(page);
  });

  // Selected on the firefox / webkit / mobile / edge projects via its tag (playwright.config.ts).
  test('[JIRA191-TC-029] Flow on supported browsers and mobile', { tag: ['@JIRA191-TC-029', '@priority-medium'] }, async ({ page }, testInfo) => {
    annotate('JIRA191-TC-029');
    await fullFlow(page); // review F-04: the full TC-028 flow, not just the listing
    const viewport = page.viewportSize();
    if (viewport) {
      const box = await page.getByTestId('inventory-item-name').boundingBox();
      expect(box, 'name bounding box').not.toBeNull();
      expect(box!.width).toBeLessThanOrEqual(viewport.width);
    }
    await testInfo.attach(`details-${testInfo.project.name}`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });
});
