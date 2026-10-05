import { test, expect, Page } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { InventoryPage } from '../pages/InventoryPage';
import { CartPage } from '../pages/CartPage';
import { CheckoutStepOnePage } from '../pages/CheckoutStepOnePage';
import { CheckoutStepTwoPage } from '../pages/CheckoutStepTwoPage';
import { CheckoutCompletePage } from '../pages/CheckoutCompletePage';

// Scenarios generated from TestDesign/JIRA-190_PlaywrightScenarios.csv (SCN-1..SCN-38).
//
// NOTE ON SCENARIO ID NAMESPACE: JIRA-190's CSV reuses the bare "SCN-<n>" numbering
// already used (for different scenarios) by JIRA-1's CSV, whose IDs are tagged/annotated
// in tests/checkout.spec.ts and tests/JIRA-1.spec.ts. To satisfy the "never reuse a
// Scenario ID across more than one test" rule and keep the join key for result
// publishing unambiguous, every JIRA-190 scenario is tagged/annotated with the
// source-qualified id "JIRA190-SCN-<n>" instead of the bare CSV value.
//
// Scenarios that duplicate existing coverage were mapped (as JIRA190-SCN-<n>) onto the
// existing tests in tests/checkout.spec.ts and tests/JIRA-1.spec.ts instead of being
// re-implemented here: SCN-1, 6, 7, 8, 9, 10, 11, 12, 13, 15, 16, 17, 18, 19, 20, 21,
// 22, 23, 24, 25, 30, 31, 32, 34, 37. SCN-28 is mapped onto the glitch-user test below
// (pre-existing in this file). The remaining scenarios are implemented below.

const PRODUCT_1 = 'Sauce Labs Backpack';
const PRODUCT_2 = 'Sauce Labs Bike Light';
const JANE_DOE = { firstName: 'Jane', lastName: 'Doe', postalCode: '10001' };

interface Pages {
  loginPage: LoginPage;
  inventoryPage: InventoryPage;
  cartPage: CartPage;
  checkoutStepOne: CheckoutStepOnePage;
  checkoutStepTwo: CheckoutStepTwoPage;
  checkoutComplete: CheckoutCompletePage;
}

function buildPages(page: Page): Pages {
  return {
    loginPage: new LoginPage(page),
    inventoryPage: new InventoryPage(page),
    cartPage: new CartPage(page),
    checkoutStepOne: new CheckoutStepOnePage(page),
    checkoutStepTwo: new CheckoutStepTwoPage(page),
    checkoutComplete: new CheckoutCompletePage(page),
  };
}

/** Reusable helper: logs in as standard_user and confirms the inventory page loaded. */
async function loginAsStandardUser(page: Page): Promise<Pages> {
  const pages = buildPages(page);
  await pages.loginPage.open();
  await pages.loginPage.loginAsStandardUser();
  await pages.inventoryPage.expectLoaded();
  return pages;
}

/** Reusable helper: login -> add products -> cart -> checkout step one. */
async function reachCheckoutStepOne(page: Page, productNames: string[]): Promise<Pages> {
  const pages = await loginAsStandardUser(page);
  await pages.inventoryPage.addProductsToCart(productNames);
  await pages.inventoryPage.goToCart();
  await pages.cartPage.proceedToCheckout();
  await pages.checkoutStepOne.expectLoaded();
  return pages;
}

/** Reusable helper: full happy-path order for one product, ending on the confirmation page. */
async function completeOrder(page: Page): Promise<Pages> {
  const pages = await reachCheckoutStepOne(page, [PRODUCT_1]);
  await pages.checkoutStepOne.submitShippingInfo(JANE_DOE);
  await pages.checkoutStepTwo.expectLoaded();
  await pages.checkoutStepTwo.finishOrder();
  await pages.checkoutComplete.expectOrderConfirmed();
  return pages;
}

test.describe('JIRA-190 — Scenarios not already covered by existing suites', () => {
  test(
    '[JIRA190-SCN-2] Authentication gate for protected pages and credential variants',
    { tag: ['@JIRA190-SCN-2', '@priority-high', '@risk-high'] },
    async ({ page }) => {
      test.info().annotations.push({ type: 'Scenario ID', description: 'JIRA190-SCN-2' });
      const { loginPage } = buildPages(page);

      await test.step('Protected routes redirect an unauthenticated visitor to login', async () => {
        for (const path of ['/inventory.html', '/cart.html', '/checkout-step-one.html']) {
          await loginPage.goto(path);
          await loginPage.expectOnLoginPage();
          await expect(page).not.toHaveURL(new RegExp(path.replace('.', '\\.') + '$'));
        }
      });

      const rejected = [
        { user: 'invalid_user', pass: 'wrong_pass', message: /do not match any user/i },
        { user: 'locked_out_user', pass: 'secret_sauce', message: /sorry, this user has been locked out/i },
        { user: '', pass: '', message: /username is required/i },
      ];
      for (const { user, pass, message } of rejected) {
        await test.step(`Rejected credentials: "${user}" / "${pass}"`, async () => {
          await loginPage.open();
          await loginPage.login(user, pass);
          await loginPage.expectLoginError(message);
          await expect(page).not.toHaveURL(/inventory\.html/);
        });
      }

      await test.step('Valid credentials reach inventory', async () => {
        await loginPage.open();
        await loginPage.login('standard_user', 'secret_sauce');
        await loginPage.expectUrlContains('/inventory.html');
      });
    }
  );

  test(
    '[JIRA190-SCN-3] Cart stays consistent through add, remove and re-add',
    { tag: ['@JIRA190-SCN-3', '@priority-high', '@risk-medium'] },
    async ({ page }) => {
      test.info().annotations.push({ type: 'Scenario ID', description: 'JIRA190-SCN-3' });
      const { inventoryPage, cartPage } = await loginAsStandardUser(page);

      await inventoryPage.addProductsToCart([PRODUCT_1, PRODUCT_2]);
      await inventoryPage.expectCartBadgeCount(2);
      await inventoryPage.goToCart();
      await cartPage.expectItemCount(2);
      await cartPage.expectItemInCart(PRODUCT_1);
      await cartPage.expectItemInCart(PRODUCT_2);

      await cartPage.removeItem(PRODUCT_2);
      await cartPage.expectItemCount(1);

      await cartPage.continueShoppingButton.click();
      await inventoryPage.expectLoaded();
      await inventoryPage.addProductToCart(PRODUCT_2);
      await inventoryPage.expectCartBadgeCount(2);

      await inventoryPage.goToCart();
      await cartPage.expectItemCount(2);
      await cartPage.expectItemInCart(PRODUCT_1);
      await cartPage.expectItemInCart(PRODUCT_2);
    }
  );

  test(
    '[JIRA190-SCN-4] Checkout info validation then overview price check',
    { tag: ['@JIRA190-SCN-4', '@priority-high', '@risk-high'] },
    async ({ page }) => {
      test.info().annotations.push({ type: 'Scenario ID', description: 'JIRA190-SCN-4' });
      const { checkoutStepOne, checkoutStepTwo } = await reachCheckoutStepOne(page, [PRODUCT_1, PRODUCT_2]);

      await checkoutStepOne.continueToOverview();
      await checkoutStepOne.expectValidationError(/first name is required/i);

      await checkoutStepOne.fillShippingInfo({ firstName: 'Jane', lastName: '', postalCode: '' });
      await checkoutStepOne.continueToOverview();
      await checkoutStepOne.expectValidationError(/last name is required/i);

      await checkoutStepOne.fillShippingInfo({ firstName: 'Jane', lastName: 'Doe', postalCode: '' });
      await checkoutStepOne.continueToOverview();
      await checkoutStepOne.expectValidationError(/postal code is required/i);

      await checkoutStepOne.submitShippingInfo(JANE_DOE);
      await checkoutStepTwo.expectLoaded();
      await expect(checkoutStepTwo.cartItems).toHaveCount(2);
      await checkoutStepTwo.expectTotalIsCorrect();
    }
  );

  test(
    '[JIRA190-SCN-5] Journey with problem_user and performance_glitch_user',
    { tag: ['@JIRA190-SCN-5', '@priority-medium', '@risk-high'] },
    async ({ page }) => {
      test.info().annotations.push({ type: 'Scenario ID', description: 'JIRA190-SCN-5' });

      await test.step('problem_user: record defects, flow must not crash', async () => {
        const { loginPage, inventoryPage, cartPage, checkoutStepOne, checkoutStepTwo } = buildPages(page);
        await loginPage.open();
        await loginPage.login('problem_user', 'secret_sauce');
        await inventoryPage.expectLoaded();
        await inventoryPage.addProductsToCart([PRODUCT_1, PRODUCT_2]);

        const badgeCount = await inventoryPage.cartBadge.count();
        test.info().annotations.push({
          type: 'problem_user defect baseline',
          description: `cart badge present after adding 2 items: ${badgeCount}`,
        });
        await inventoryPage.goToCart();
        await cartPage.proceedToCheckout();
        await checkoutStepOne.fillShippingInfo(JANE_DOE);
        const lastName = await checkoutStepOne.lastNameInput.inputValue();
        if (lastName !== JANE_DOE.lastName) {
          test.info().annotations.push({
            type: 'problem_user defect',
            description: `last name field holds "${lastName}" instead of "${JANE_DOE.lastName}"`,
          });
        }
        await checkoutStepOne.continueToOverview();
        // Baseline pending clarified acceptance criteria: the outcome for this known-issue
        // account is not pinned; assert a known-valid checkout page rather than a crash.
        await checkoutStepOne.expectUrlMatchesOneOf([/checkout-step-one\.html/, /checkout-step-two\.html/]);
        if (page.url().includes('checkout-step-two.html')) {
          await checkoutStepTwo.expectLoaded();
        }
      });

      await test.step('performance_glitch_user: order completes with auto-waiting', async () => {
        await page.context().clearCookies();
        const { loginPage, inventoryPage, cartPage, checkoutStepOne, checkoutStepTwo, checkoutComplete } =
          buildPages(page);
        await loginPage.open();
        await loginPage.login('performance_glitch_user', 'secret_sauce');
        await expect(inventoryPage.inventoryList).toBeVisible({ timeout: 15_000 });
        await inventoryPage.addProductToCart(PRODUCT_1);
        await inventoryPage.goToCart();
        await cartPage.proceedToCheckout();
        await checkoutStepOne.submitShippingInfo(JANE_DOE);
        await expect(page).toHaveURL(/checkout-step-two\.html/, { timeout: 15_000 });
        await checkoutStepTwo.finishOrder();
        await expect(page).toHaveURL(/checkout-complete\.html/, { timeout: 15_000 });
        await checkoutComplete.expectOrderConfirmed();
      });
    }
  );

  test(
    '[JIRA190-SCN-14] Logout after purchase ends the session',
    { tag: ['@JIRA190-SCN-14', '@priority-medium', '@risk-medium'] },
    async ({ page }) => {
      test.info().annotations.push({ type: 'Scenario ID', description: 'JIRA190-SCN-14' });
      const { loginPage, checkoutComplete } = await completeOrder(page);

      await checkoutComplete.logout();
      await loginPage.expectOnLoginPage();
      await expect(page).toHaveURL(/saucedemo\.com\/?$/);

      await loginPage.goto('/inventory.html');
      await loginPage.expectOnLoginPage();
      await expect(page).not.toHaveURL(/inventory\.html$/);
    }
  );

  test(
    '[JIRA190-SCN-26] Cancel from checkout step one returns to cart with items intact',
    { tag: ['@JIRA190-SCN-26', '@priority-medium', '@risk-high'] },
    async ({ page }) => {
      test.info().annotations.push({ type: 'Scenario ID', description: 'JIRA190-SCN-26' });
      const { inventoryPage, cartPage, checkoutStepOne } = await reachCheckoutStepOne(page, [PRODUCT_1]);

      await checkoutStepOne.cancel();

      await cartPage.expectLoaded();
      await cartPage.expectItemCount(1);
      await cartPage.expectItemInCart(PRODUCT_1);
      await inventoryPage.expectCartBadgeCount(1);
    }
  );

  test(
    '[JIRA190-SCN-27] problem_user full journey does not silently complete with wrong data',
    { tag: ['@JIRA190-SCN-27', '@priority-low', '@risk-high'] },
    async ({ page }) => {
      test.info().annotations.push({ type: 'Scenario ID', description: 'JIRA190-SCN-27' });
      const { loginPage, inventoryPage, cartPage, checkoutStepOne, checkoutStepTwo } = buildPages(page);
      await loginPage.open();
      await loginPage.login('problem_user', 'secret_sauce');
      await inventoryPage.expectLoaded();
      await inventoryPage.addProductsToCart([PRODUCT_1, PRODUCT_2]);

      const badgeCount = await inventoryPage.cartBadge.count();
      test.info().annotations.push({ type: 'Observed', description: `cart badge count: ${badgeCount} (expected 2)` });
      await inventoryPage.goToCart();
      const cartCount = await cartPage.getItemCount();
      test.info().annotations.push({ type: 'Observed', description: `cart line items: ${cartCount} (expected 2)` });

      await cartPage.proceedToCheckout();
      await checkoutStepOne.fillShippingInfo(JANE_DOE);
      const lastNameValue = await checkoutStepOne.lastNameInput.inputValue();
      const dataCorrupted = lastNameValue !== JANE_DOE.lastName;
      if (dataCorrupted) {
        test.info().annotations.push({
          type: 'Defect',
          description: `last name field read back as "${lastNameValue}" instead of "${JANE_DOE.lastName}"`,
        });
      }

      await checkoutStepOne.continueToOverview();
      await expect(page)
        .toHaveURL(/checkout-step-two\.html/, { timeout: 3_000 })
        .catch(() => undefined);
      if (page.url().includes('checkout-step-two.html')) {
        await checkoutStepTwo.finishOrder();
      }

      if (dataCorrupted) {
        // Order must not silently complete when the entered data was corrupted.
        expect(page.url(), 'Order completed despite corrupted shipping data').not.toContain('checkout-complete.html');
      } else {
        await checkoutStepOne.expectUrlMatchesOneOf([
          /checkout-step-one\.html/,
          /checkout-step-two\.html/,
          /checkout-complete\.html/,
        ]);
      }
    }
  );

  test(
    '[JIRA190-SCN-28] performance_glitch_user completes full checkout despite induced latency',
    { tag: ['@JIRA190-SCN-28', '@priority-low', '@risk-high'] },
    async ({ page }) => {
      test.info().annotations.push({ type: 'Scenario ID', description: 'JIRA190-SCN-28' });
      const { loginPage, inventoryPage, cartPage, checkoutStepOne, checkoutStepTwo, checkoutComplete } =
        buildPages(page);

      const start = Date.now();
      await loginPage.open();
      await loginPage.login('performance_glitch_user', 'secret_sauce');
      // Extended timeout: this seeded account has induced latency on navigation.
      await expect(inventoryPage.inventoryList).toBeVisible({ timeout: 15_000 });

      await inventoryPage.addProductToCart(PRODUCT_1);
      await inventoryPage.goToCart();
      await cartPage.proceedToCheckout();
      await checkoutStepOne.submitShippingInfo(JANE_DOE);

      await expect(page).toHaveURL(/checkout-step-two\.html/, { timeout: 15_000 });
      await checkoutStepTwo.finishOrder();

      // Asserts the flow completes rather than asserting on elapsed time, since no
      // acceptance threshold is defined by the requirement; elapsed time is reported.
      await expect(page).toHaveURL(/checkout-complete\.html/, { timeout: 15_000 });
      await checkoutComplete.expectOrderConfirmed();
      test.info().annotations.push({ type: 'Elapsed ms', description: String(Date.now() - start) });
    }
  );

  test(
    '[JIRA190-SCN-29] Cart persists after page refresh',
    { tag: ['@JIRA190-SCN-29', '@priority-medium', '@risk-high'] },
    async ({ page }) => {
      test.info().annotations.push({ type: 'Scenario ID', description: 'JIRA190-SCN-29' });
      const { inventoryPage, cartPage } = await loginAsStandardUser(page);
      await inventoryPage.addProductsToCart([PRODUCT_1, PRODUCT_2]);

      await page.reload();

      await inventoryPage.expectCartBadgeCount(2);
      await inventoryPage.goToCart();
      await cartPage.expectItemCount(2);
      await cartPage.expectItemInCart(PRODUCT_1);
      await cartPage.expectItemInCart(PRODUCT_2);
    }
  );

  test(
    '[JIRA190-SCN-33][JIRA191-SCN-28][JIRA192-SCN-25][JIRA193-SCN-26] Injection strings in login fields are rejected and not executed',
    { tag: ['@JIRA190-SCN-33', '@JIRA191-SCN-28', '@JIRA192-SCN-25', '@JIRA193-SCN-26', '@priority-high', '@risk-medium'] },
    async ({ page }) => {
      test.info().annotations.push({ type: 'Scenario ID', description: 'JIRA193-SCN-26' });
      test.info().annotations.push({ type: 'Scenario ID', description: 'JIRA190-SCN-33' });
      test.info().annotations.push({ type: 'Scenario ID', description: 'JIRA192-SCN-25' });
      test.info().annotations.push({ type: 'Scenario ID', description: 'JIRA191-SCN-28' });
      let dialogFired = false;
      page.on('dialog', async (dialog) => {
        dialogFired = true;
        await dialog.dismiss();
      });
      const { loginPage } = buildPages(page);

      await loginPage.open();
      await loginPage.login("' OR '1'='1", '<script>alert(1)</script>');

      await loginPage.expectLoginError(/do not match any user/i);
      await expect(page).not.toHaveURL(/inventory\.html/);
      expect(dialogFired, 'A JS dialog fired — the injected script executed').toBe(false);

      // JIRA192-SCN-25: inventory is not reachable after the rejected attempt.
      await loginPage.goto('/inventory.html');
      await loginPage.expectOnLoginPage();
    }
  );

  test(
    '[JIRA190-SCN-35] Very long values in shipping fields do not crash the app',
    { tag: ['@JIRA190-SCN-35', '@priority-low', '@risk-high'] },
    async ({ page }) => {
      test.info().annotations.push({ type: 'Scenario ID', description: 'JIRA190-SCN-35' });
      const pageErrors: string[] = [];
      page.on('pageerror', (err) => pageErrors.push(err.message));
      const { checkoutStepOne, checkoutStepTwo } = await reachCheckoutStepOne(page, [PRODUCT_1]);

      const long = 'a'.repeat(256);
      await checkoutStepOne.submitShippingInfo({ firstName: long, lastName: long, postalCode: long });

      // Requirement does not define the outcome; either a validation error or the
      // overview is acceptable as long as the app stays functional.
      await expect(checkoutStepOne.errorMessage.or(checkoutStepTwo.finishButton)).toBeVisible();
      expect(pageErrors, `Unexpected page errors: ${pageErrors.join('; ')}`).toHaveLength(0);
    }
  );

  test(
    '[JIRA190-SCN-36] Whitespace-only shipping fields: observed behavior baseline',
    { tag: ['@JIRA190-SCN-36', '@priority-low', '@risk-high'] },
    async ({ page }) => {
      test.info().annotations.push({ type: 'Scenario ID', description: 'JIRA190-SCN-36' });
      const { checkoutStepOne, checkoutStepTwo } = await reachCheckoutStepOne(page, [PRODUCT_1]);

      await checkoutStepOne.submitShippingInfo({ firstName: ' ', lastName: ' ', postalCode: ' ' });
      await expect(checkoutStepOne.errorMessage.or(checkoutStepTwo.finishButton)).toBeVisible();

      // Baseline pending clarified acceptance criteria: whether whitespace-only input
      // should be rejected is not specified; the actual behavior is recorded.
      if (page.url().includes('checkout-step-two.html')) {
        test.info().annotations.push({
          type: 'Requirement gap',
          description: 'Whitespace-only shipping info was accepted and the overview loaded',
        });
        await checkoutStepTwo.expectLoaded();
      } else {
        await checkoutStepOne.expectValidationError(/./);
        await checkoutStepOne.expectLoaded();
      }
    }
  );

  test(
    '[JIRA190-SCN-38] Rapid double-click on Finish creates a single order',
    { tag: ['@JIRA190-SCN-38', '@priority-medium', '@risk-high'] },
    async ({ page }) => {
      test.info().annotations.push({ type: 'Scenario ID', description: 'JIRA190-SCN-38' });
      let completeNavigations = 0;
      page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame() && frame.url().includes('checkout-complete.html')) completeNavigations++;
      });
      const { inventoryPage, checkoutStepOne, checkoutStepTwo, checkoutComplete } = await reachCheckoutStepOne(page, [
        PRODUCT_1,
      ]);
      await checkoutStepOne.submitShippingInfo(JANE_DOE);
      await checkoutStepTwo.expectLoaded();

      await checkoutStepTwo.rapidDoubleClickFinish();

      await checkoutComplete.expectOrderConfirmed();
      expect(completeNavigations, 'Expected a single navigation to the confirmation page').toBe(1);
      await inventoryPage.expectCartEmpty();
    }
  );
});
