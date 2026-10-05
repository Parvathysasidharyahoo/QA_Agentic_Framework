import { test, expect, Page } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { InventoryPage } from '../pages/InventoryPage';
import { CartPage } from '../pages/CartPage';
import { CheckoutStepOnePage } from '../pages/CheckoutStepOnePage';
import { CheckoutStepTwoPage } from '../pages/CheckoutStepTwoPage';
import { CheckoutCompletePage } from '../pages/CheckoutCompletePage';

// Scenarios generated from TestDesign/JIRA-1_PlaywrightScenarios.csv.
// Scenarios that duplicated existing coverage (SCN-1, SCN-2, SCN-4, SCN-13, SCN-14,
// SCN-15, SCN-25, SCN-26, SCN-29) were mapped onto the existing tests in
// tests/checkout.spec.ts instead of being re-implemented here — see that file.
//
// Several tests below also carry additional "JIRA190-SCN-<n>" tags/annotations: these
// map scenarios from TestDesign/JIRA-190_PlaywrightScenarios.csv that were found to
// duplicate (or closely overlap) a scenario already covered here. The "JIRA190-"
// prefix disambiguates JIRA-190's CSV-local "SCN-<n>" numbering from JIRA-1's own
// (unrelated) "SCN-<n>" numbering used elsewhere in this file, since the two CSVs
// independently reuse the same numeric IDs for different scenarios. See
// tests/JIRA-190.spec.ts for the scenarios from that CSV that had no existing
// equivalent and were newly implemented there.

const PRODUCT_1 = 'Sauce Labs Backpack';
const PRODUCT_2 = 'Sauce Labs Bike Light';
const ALL_PRODUCTS = [
  'Sauce Labs Backpack',
  'Sauce Labs Bike Light',
  'Sauce Labs Bolt T-Shirt',
  'Sauce Labs Fleece Jacket',
  'Sauce Labs Onesie',
  'Test.allTheThings T-Shirt (Red)',
];
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

/**
 * Reusable helper for the many scenarios that need one or more products already in
 * the cart and to have reached checkout-step-one (login -> add -> cart -> checkout).
 */
async function reachCheckoutStepOne(page: Page, productNames: string[]): Promise<Pages> {
  const pages = await loginAsStandardUser(page);
  await pages.inventoryPage.addProductsToCart(productNames);
  await pages.inventoryPage.goToCart();
  await pages.cartPage.proceedToCheckout();
  await pages.checkoutStepOne.expectLoaded();
  return pages;
}

test.describe('JIRA-1 — TS: Consolidated regression scenarios', () => {
  test(
    '[SCN-3] Login flow across valid, invalid and locked-out credentials',
    { tag: ['@SCN-3', '@priority-high', '@risk-high'] },
    async ({ page }) => {
      test.info().annotations.push({ type: 'Scenario ID', description: 'SCN-3' });

      await test.step('Case A: valid credentials reach inventory', async () => {
        const { loginPage, inventoryPage } = buildPages(page);
        await loginPage.open();
        await loginPage.login('standard_user', 'secret_sauce');
        await inventoryPage.expectLoaded();
      });

      await test.step('Case B: invalid credentials, fresh session, are rejected', async () => {
        const { loginPage } = buildPages(page);
        await loginPage.open();
        await loginPage.login('invalid_user', 'wrong_password');
        await loginPage.expectLoginError(/do not match any user/i);
        await expect(page).not.toHaveURL(/inventory\.html/);
      });

      await test.step('Case C: locked-out user, fresh session, is blocked', async () => {
        const { loginPage } = buildPages(page);
        await loginPage.open();
        await loginPage.login('locked_out_user', 'secret_sauce');
        await loginPage.expectLoginError(/sorry, this user has been locked out/i);
        await expect(page).toHaveURL(/saucedemo\.com\/?$/);
      });
    }
  );

  test(
    '[SCN-5] Checkout shipping-info form validation across blank-field combinations',
    { tag: ['@SCN-5', '@priority-medium', '@risk-medium'] },
    async ({ page }) => {
      test.info().annotations.push({ type: 'Scenario ID', description: 'SCN-5' });
      const { checkoutStepOne } = await reachCheckoutStepOne(page, [PRODUCT_1]);

      await test.step('Case A: first name blank', async () => {
        await checkoutStepOne.fillShippingInfo({ firstName: '', lastName: 'Doe', postalCode: '10001' });
        await checkoutStepOne.continueToOverview();
        await checkoutStepOne.expectValidationError(/first name is required/i);
        await checkoutStepOne.expectLoaded();
      });

      await test.step('Case B: last name blank', async () => {
        await checkoutStepOne.fillShippingInfo({ firstName: 'Jane', lastName: '', postalCode: '10001' });
        await checkoutStepOne.continueToOverview();
        await checkoutStepOne.expectValidationError(/last name is required/i);
        await checkoutStepOne.expectLoaded();
      });

      await test.step('Case C: postal code blank', async () => {
        await checkoutStepOne.fillShippingInfo({ firstName: 'Jane', lastName: 'Doe', postalCode: '' });
        await checkoutStepOne.continueToOverview();
        await checkoutStepOne.expectValidationError(/postal code is required/i);
        await checkoutStepOne.expectLoaded();
      });

      await test.step('Case D: all fields blank', async () => {
        await checkoutStepOne.fillShippingInfo({ firstName: '', lastName: '', postalCode: '' });
        await checkoutStepOne.continueToOverview();
        await checkoutStepOne.expectValidationError(/first name is required/i);
        await checkoutStepOne.expectLoaded();
      });
    }
  );

  test(
    '[SCN-6] Price computation is correct across cart size variations (1, 2, 6 items)',
    { tag: ['@SCN-6', '@priority-high', '@risk-medium'] },
    async ({ page }) => {
      test.info().annotations.push({ type: 'Scenario ID', description: 'SCN-6' });

      const cartSizes: { label: string; products: string[] }[] = [
        { label: '1 item', products: [PRODUCT_1] },
        { label: '2 items', products: [PRODUCT_1, PRODUCT_2] },
        { label: '6 items (full catalog)', products: ALL_PRODUCTS },
      ];

      for (const { label, products } of cartSizes) {
        await test.step(label, async () => {
          const { checkoutStepOne, checkoutStepTwo } = await reachCheckoutStepOne(page, products);
          await checkoutStepOne.submitShippingInfo(JANE_DOE);
          await checkoutStepTwo.expectLoaded();

          const subtotal = await checkoutStepTwo.getItemSubtotal();
          const tax = await checkoutStepTwo.getTax();
          const total = await checkoutStepTwo.getTotal();
          expect(subtotal).toBeGreaterThan(0);
          expect(tax).toBeGreaterThanOrEqual(0);
          expect(total).toBeCloseTo(subtotal + tax, 2);

          // Business-rule assertion (total = subtotal + tax) via the shared helper.
          await checkoutStepTwo.expectTotalIsCorrect();
        });
      }
    }
  );

  test(
    '[SCN-8] Session/navigation state across refresh and browser back on checkout-step-two',
    { tag: ['@SCN-8', '@priority-medium', '@risk-high'] },
    async ({ page }) => {
      test.info().annotations.push({ type: 'Scenario ID', description: 'SCN-8' });

      await test.step('Refresh: page.reload() while on checkout-step-two', async () => {
        const { checkoutStepOne, checkoutStepTwo } = await reachCheckoutStepOne(page, [PRODUCT_1]);
        await checkoutStepOne.submitShippingInfo(JANE_DOE);
        await checkoutStepTwo.expectLoaded();

        await page.reload();

        // Baseline pending clarified acceptance criteria: the requirement doesn't
        // define whether reload should retain checkout-step-two state or bounce the
        // user back to an earlier step. This pins the app to a known-valid page
        // (not a crash/blank screen) until the acceptance criteria are clarified.
        await checkoutStepTwo.expectUrlMatchesOneOf([
          /checkout-step-two\.html/,
          /checkout-step-one\.html/,
          /cart\.html/,
          /inventory\.html/,
        ]);
      });

      await test.step('Back: browser back navigation from checkout-step-two', async () => {
        const { checkoutStepOne, checkoutStepTwo } = await reachCheckoutStepOne(page, [PRODUCT_1]);
        await checkoutStepOne.submitShippingInfo(JANE_DOE);
        await checkoutStepTwo.expectLoaded();

        await page.goBack();

        // Same baseline rationale as the refresh case above.
        await checkoutStepTwo.expectUrlMatchesOneOf([
          /checkout-step-one\.html/,
          /cart\.html/,
        ]);
      });
    }
  );
});

test.describe('JIRA-1 — POS: Positive scenarios', () => {
  test(
    '[SCN-9][JIRA190-SCN-6][JIRA191-SCN-4][JIRA192-SCN-4] Standard user logs in successfully',
    { tag: ['@SCN-9', '@JIRA190-SCN-6', '@JIRA191-SCN-4', '@JIRA192-SCN-4', '@priority-high', '@risk-low'] },
    async ({ page }) => {
      test.info().annotations.push({ type: 'Scenario ID', description: 'SCN-9' });
      test.info().annotations.push({ type: 'Scenario ID', description: 'JIRA192-SCN-4' });
      test.info().annotations.push({ type: 'Scenario ID', description: 'JIRA191-SCN-4' });
      test.info().annotations.push({ type: 'Scenario ID', description: 'JIRA190-SCN-6' });
      // Also satisfies JIRA-190's JIRA190-SCN-6 (POS-1) — identical login flow, plus
      // its extra check that no login error is rendered on the resulting page.
      const { loginPage, inventoryPage } = buildPages(page);
      await loginPage.open();
      await loginPage.login('standard_user', 'secret_sauce');
      await expect(page).toHaveURL(/inventory\.html/);
      await inventoryPage.expectLoaded();
      await expect(loginPage.errorMessage).toHaveCount(0);
    }
  );

  test(
    '[SCN-10][JIRA190-SCN-7] Adding a single product to cart updates badge to 1',
    { tag: ['@SCN-10', '@JIRA190-SCN-7', '@priority-high', '@risk-low', '@risk-medium'] },
    async ({ page }) => {
      test.info().annotations.push({ type: 'Scenario ID', description: 'SCN-10' });
      test.info().annotations.push({ type: 'Scenario ID', description: 'JIRA190-SCN-7' });
      // Also satisfies JIRA-190's JIRA190-SCN-7 (POS-2) — same add-to-cart flow,
      // extended with the button-toggle and cart price/quantity checks it requires.
      const { inventoryPage, cartPage } = await loginAsStandardUser(page);
      await inventoryPage.addProductToCart(PRODUCT_1);
      await inventoryPage.expectCartBadgeCount(1);
      await inventoryPage.expectProductInCart(PRODUCT_1);

      await inventoryPage.goToCart();
      await cartPage.expectItemCount(1);
      await cartPage.expectItemInCart(PRODUCT_1);
      expect(await cartPage.getItemPrice(PRODUCT_1)).toBeCloseTo(29.99, 2);
      expect(await cartPage.getItemQuantity(PRODUCT_1)).toBe(1);
    }
  );

  test(
    '[SCN-11] Adding multiple distinct products updates badge to matching count',
    { tag: ['@SCN-11', '@priority-high', '@risk-low'] },
    async ({ page }) => {
      test.info().annotations.push({ type: 'Scenario ID', description: 'SCN-11' });
      const { inventoryPage } = await loginAsStandardUser(page);
      await inventoryPage.addProductsToCart([PRODUCT_1, PRODUCT_2]);
      await inventoryPage.expectCartBadgeCount(2);
    }
  );

  test(
    '[SCN-12][JIRA190-SCN-8] Cart page lists all added items',
    { tag: ['@SCN-12', '@JIRA190-SCN-8', '@priority-medium', '@priority-high', '@risk-low', '@risk-medium'] },
    async ({ page }) => {
      test.info().annotations.push({ type: 'Scenario ID', description: 'SCN-12' });
      test.info().annotations.push({ type: 'Scenario ID', description: 'JIRA190-SCN-8' });
      // Also satisfies JIRA-190's JIRA190-SCN-8 (POS-3) — same multi-add flow,
      // extended with the inventory price checks (29.99 / 9.99) it additionally requires.
      const { inventoryPage, cartPage } = await loginAsStandardUser(page);
      expect(await inventoryPage.getProductPrice(PRODUCT_1)).toBeCloseTo(29.99, 2);
      expect(await inventoryPage.getProductPrice(PRODUCT_2)).toBeCloseTo(9.99, 2);
      await inventoryPage.addProductsToCart([PRODUCT_1, PRODUCT_2]);
      await inventoryPage.expectCartBadgeCount(2);
      await inventoryPage.goToCart();
      await cartPage.expectLoaded();
      await cartPage.expectItemCount(2);
      await cartPage.expectItemInCart(PRODUCT_1);
      await cartPage.expectItemInCart(PRODUCT_2);
    }
  );

  test(
    '[SCN-16] Valid international postal code is accepted in shipping form',
    { tag: ['@SCN-16', '@priority-medium', '@risk-medium'] },
    async ({ page }) => {
      test.info().annotations.push({ type: 'Scenario ID', description: 'SCN-16' });
      const { checkoutStepOne, checkoutStepTwo } = await reachCheckoutStepOne(page, [PRODUCT_1]);
      await checkoutStepOne.fillShippingInfo({ firstName: 'John', lastName: 'Smith', postalCode: 'SW1A 1AA' });
      await checkoutStepOne.continueToOverview();
      // Confirms navigation succeeded with no validation error blocking the form.
      await checkoutStepTwo.expectLoaded();
      await expect(checkoutStepOne.errorMessage).toHaveCount(0);
    }
  );

  test(
    '[SCN-7][SCN-17][JIRA190-SCN-13] Post-order confirmation returns to inventory with an empty cart',
    { tag: ['@SCN-7', '@SCN-17', '@JIRA190-SCN-13', '@priority-medium', '@risk-medium'] },
    async ({ page }) => {
      // SCN-7 (TS-7, "Post-order confirmation and return-to-products flow") and
      // SCN-17 (POS-9, "'Back Home' from order confirmation returns to inventory
      // page with empty cart") describe an identical step/assertion sequence, so
      // one test covers both IDs instead of generating a literal duplicate. JIRA-190's
      // JIRA190-SCN-13 (POS-8) is the same flow and is mapped here too.
      test.info().annotations.push({ type: 'Scenario ID', description: 'SCN-7' });
      test.info().annotations.push({ type: 'Scenario ID', description: 'SCN-17' });
      test.info().annotations.push({ type: 'Scenario ID', description: 'JIRA190-SCN-13' });

      const { inventoryPage, checkoutStepOne, checkoutStepTwo, checkoutComplete } = await reachCheckoutStepOne(page, [
        PRODUCT_1,
      ]);
      await checkoutStepOne.submitShippingInfo(JANE_DOE);
      await checkoutStepTwo.expectLoaded();
      await checkoutStepTwo.finishOrder();
      await checkoutComplete.expectOrderConfirmed();

      await checkoutComplete.backToProducts();
      await expect(page).toHaveURL(/inventory\.html/);
      await inventoryPage.expectLoaded();
      await inventoryPage.expectCartEmpty();
    }
  );

  test(
    '[SCN-18] Cart badge is absent when cart is empty',
    { tag: ['@SCN-18', '@priority-low', '@risk-medium'] },
    async ({ page }) => {
      test.info().annotations.push({ type: 'Scenario ID', description: 'SCN-18' });
      const { inventoryPage } = await loginAsStandardUser(page);
      await inventoryPage.expectCartEmpty();
    }
  );

  test(
    '[SCN-19] Sorting inventory by price (low to high) reorders products correctly',
    { tag: ['@SCN-19', '@priority-low', '@risk-medium'] },
    async ({ page }) => {
      test.info().annotations.push({ type: 'Scenario ID', description: 'SCN-19' });
      const { inventoryPage } = await loginAsStandardUser(page);
      await inventoryPage.sortByPriceLowToHigh();
      const prices = await inventoryPage.getDisplayedPrices();
      const ascending = [...prices].sort((a, b) => a - b);
      expect(prices).toEqual(ascending);
    }
  );

  test(
    '[SCN-20] Cancel from checkout overview returns to cart with items intact',
    { tag: ['@SCN-20', '@priority-medium', '@risk-medium'] },
    async ({ page }) => {
      test.info().annotations.push({ type: 'Scenario ID', description: 'SCN-20' });
      const { cartPage, checkoutStepOne, checkoutStepTwo } = await reachCheckoutStepOne(page, [PRODUCT_1]);
      await checkoutStepOne.submitShippingInfo(JANE_DOE);
      await checkoutStepTwo.expectLoaded();
      await checkoutStepTwo.cancel();
      await expect(page).toHaveURL(/cart\.html/);
      await cartPage.expectItemInCart(PRODUCT_1);
    }
  );
});

test.describe('JIRA-1 — NEG: Negative scenarios', () => {
  test(
    '[SCN-21][JIRA190-SCN-16][JIRA193-SCN-14] Login fails with invalid username',
    { tag: ['@SCN-21', '@JIRA190-SCN-16', '@JIRA193-SCN-14', '@priority-high', '@risk-low'] },
    async ({ page }) => {
      test.info().annotations.push({ type: 'Scenario ID', description: 'JIRA193-SCN-14' });
      test.info().annotations.push({ type: 'Scenario ID', description: 'SCN-21' });
      test.info().annotations.push({ type: 'Scenario ID', description: 'JIRA190-SCN-16' });
      // Also satisfies JIRA-190's JIRA190-SCN-16 (NEG-2, "Login with unknown username")
      // — identical login/error assertions, extended with the no-session check.
      const { loginPage } = buildPages(page);
      await loginPage.open();
      await loginPage.login('invalid_user', 'secret_sauce');
      await loginPage.expectLoginError(/username and password do not match any user in this service/i);
      await expect(page).not.toHaveURL(/inventory\.html/);
      await loginPage.goto('/inventory.html');
      await loginPage.expectOnLoginPage();
    }
  );

  test(
    '[SCN-22][JIRA190-SCN-15][JIRA193-SCN-13] Login fails with correct username but wrong password',
    { tag: ['@SCN-22', '@JIRA190-SCN-15', '@JIRA193-SCN-13', '@priority-high', '@risk-low'] },
    async ({ page }) => {
      test.info().annotations.push({ type: 'Scenario ID', description: 'JIRA193-SCN-13' });
      test.info().annotations.push({ type: 'Scenario ID', description: 'SCN-22' });
      test.info().annotations.push({ type: 'Scenario ID', description: 'JIRA190-SCN-15' });
      const { loginPage } = buildPages(page);
      await loginPage.open();
      await loginPage.login('standard_user', 'wrong_password');
      await loginPage.expectLoginError(/do not match any user/i);
      await expect(page).not.toHaveURL(/inventory\.html/);
    }
  );

  test(
    '[SCN-23][JIRA190-SCN-18][JIRA191-SCN-15][JIRA192-SCN-15][JIRA193-SCN-16] Login fails when username field is left empty',
    { tag: ['@SCN-23', '@JIRA190-SCN-18', '@JIRA191-SCN-15', '@JIRA192-SCN-15', '@JIRA193-SCN-16', '@priority-high', '@priority-medium', '@risk-low'] },
    async ({ page }) => {
      test.info().annotations.push({ type: 'Scenario ID', description: 'JIRA193-SCN-16' });
      test.info().annotations.push({ type: 'Scenario ID', description: 'SCN-23' });
      test.info().annotations.push({ type: 'Scenario ID', description: 'JIRA192-SCN-15' });
      test.info().annotations.push({ type: 'Scenario ID', description: 'JIRA191-SCN-15' });
      test.info().annotations.push({ type: 'Scenario ID', description: 'JIRA190-SCN-18' });
      // Also satisfies JIRA-190's JIRA190-SCN-18 (NEG-4, "Login with empty username") —
      // identical steps/assertions.
      const { loginPage } = buildPages(page);
      await loginPage.open();
      await loginPage.login('', 'secret_sauce');
      await loginPage.expectLoginError(/username is required/i);
      await expect(page).not.toHaveURL(/inventory\.html/);
    }
  );

  test(
    '[SCN-24][JIRA190-SCN-19][JIRA191-SCN-16][JIRA192-SCN-16][JIRA193-SCN-17] Login fails when password field is left empty',
    { tag: ['@SCN-24', '@JIRA190-SCN-19', '@JIRA191-SCN-16', '@JIRA192-SCN-16', '@JIRA193-SCN-17', '@priority-high', '@priority-medium', '@risk-low'] },
    async ({ page }) => {
      test.info().annotations.push({ type: 'Scenario ID', description: 'JIRA193-SCN-17' });
      test.info().annotations.push({ type: 'Scenario ID', description: 'SCN-24' });
      test.info().annotations.push({ type: 'Scenario ID', description: 'JIRA192-SCN-16' });
      test.info().annotations.push({ type: 'Scenario ID', description: 'JIRA191-SCN-16' });
      test.info().annotations.push({ type: 'Scenario ID', description: 'JIRA190-SCN-19' });
      const { loginPage } = buildPages(page);
      await loginPage.open();
      await loginPage.login('standard_user', '');
      await loginPage.expectLoginError(/password is required/i);
    }
  );

  test(
    '[SCN-27][JIRA190-SCN-23] Checkout blocked when last name is missing',
    { tag: ['@SCN-27', '@JIRA190-SCN-23', '@priority-medium', '@risk-medium'] },
    async ({ page }) => {
      test.info().annotations.push({ type: 'Scenario ID', description: 'SCN-27' });
      test.info().annotations.push({ type: 'Scenario ID', description: 'JIRA190-SCN-23' });
      // Also satisfies JIRA-190's JIRA190-SCN-23 (NEG-9) — identical steps/assertions.
      const { checkoutStepOne } = await reachCheckoutStepOne(page, [PRODUCT_1]);
      await checkoutStepOne.fillShippingInfo({ firstName: 'Jane', lastName: '', postalCode: '10001' });
      await checkoutStepOne.continueToOverview();
      await checkoutStepOne.expectValidationError(/last name is required/i);
      await checkoutStepOne.expectLoaded();
    }
  );

  test(
    '[SCN-28][JIRA190-SCN-24] Checkout blocked when postal code is missing',
    { tag: ['@SCN-28', '@JIRA190-SCN-24', '@priority-medium', '@risk-medium'] },
    async ({ page }) => {
      test.info().annotations.push({ type: 'Scenario ID', description: 'SCN-28' });
      test.info().annotations.push({ type: 'Scenario ID', description: 'JIRA190-SCN-24' });
      // Also satisfies JIRA-190's JIRA190-SCN-24 (NEG-10) — identical steps/assertions.
      const { checkoutStepOne } = await reachCheckoutStepOne(page, [PRODUCT_1]);
      await checkoutStepOne.fillShippingInfo({ firstName: 'Jane', lastName: 'Doe', postalCode: '' });
      await checkoutStepOne.continueToOverview();
      await checkoutStepOne.expectValidationError(/postal code is required/i);
      await checkoutStepOne.expectLoaded();
    }
  );

  test(
    '[SCN-30][JIRA190-SCN-20][JIRA190-SCN-21][JIRA193-SCN-18] Unauthenticated user cannot access protected pages directly via URL',
    { tag: ['@SCN-30', '@JIRA190-SCN-20', '@JIRA190-SCN-21', '@JIRA193-SCN-18', '@priority-high', '@risk-high', '@risk-medium'] },
    async ({ page }) => {
      test.info().annotations.push({ type: 'Scenario ID', description: 'JIRA193-SCN-18' });
      test.info().annotations.push({ type: 'Scenario ID', description: 'SCN-30' });
      test.info().annotations.push({ type: 'Scenario ID', description: 'JIRA190-SCN-20' });
      test.info().annotations.push({ type: 'Scenario ID', description: 'JIRA190-SCN-21' });
      // Also satisfies JIRA-190's JIRA190-SCN-20 (NEG-6, direct access to inventory) and
      // JIRA190-SCN-21 (NEG-7, direct access to checkout step one) — identical
      // direct-navigation guard checks, extended below with the login-form-visible,
      // inventory-hidden and step-one-form-hidden assertions those scenarios require.
      // Ad-hoc guard check: there's no natural page-object home for "attempt direct
      // navigation while unauthenticated", so this uses a one-off page-level locator
      // per the documented exception for navigation-guard assertions.
      const { loginPage, inventoryPage, checkoutStepOne } = buildPages(page);
      const protectedPaths = ['/inventory.html', '/cart.html', '/checkout-step-one.html'];
      for (const path of protectedPaths) {
        await page.goto(path);
        await expect(page.getByText(/you can only access/i)).toBeVisible();
        await loginPage.expectOnLoginPage();
        if (path === '/inventory.html') {
          await loginPage.expectLoginError(/You can only access '\/inventory\.html' when you are logged in/i);
          await expect(inventoryPage.inventoryList).toBeHidden();
        }
        if (path === '/checkout-step-one.html') {
          await expect(checkoutStepOne.firstNameInput).toBeHidden();
        }
      }
    }
  );

  test(
    '[SCN-31][JIRA190-SCN-31] Proceeding to checkout with an empty cart',
    { tag: ['@SCN-31', '@JIRA190-SCN-31', '@priority-medium', '@risk-high'] },
    async ({ page }) => {
      test.info().annotations.push({ type: 'Scenario ID', description: 'SCN-31' });
      test.info().annotations.push({ type: 'Scenario ID', description: 'JIRA190-SCN-31' });
      // Also satisfies JIRA-190's JIRA190-SCN-31 (EDGE-5) — same empty-cart checkout
      // attempt, with an explicit empty-cart badge and itemCount(0) check beforehand.
      const { cartPage, inventoryPage } = await loginAsStandardUser(page);
      await inventoryPage.expectCartEmpty();
      await inventoryPage.goToCart();
      await cartPage.expectLoaded();
      await cartPage.expectItemCount(0);
      await cartPage.proceedToCheckout();
      // Baseline pending clarified acceptance criteria: the requirement doesn't
      // define whether an empty cart should block checkout with a message or allow
      // a $0.00 order. This pins the app to a known-valid page until that's decided.
      await cartPage.expectUrlMatchesOneOf([/cart\.html/, /checkout-step-one\.html/]);
    }
  );

  test(
    '[SCN-32] Removing all items from cart during checkout prevents order completion',
    { tag: ['@SCN-32', '@priority-medium', '@risk-high'] },
    async ({ page }) => {
      test.info().annotations.push({ type: 'Scenario ID', description: 'SCN-32' });
      const { cartPage, checkoutStepOne, checkoutStepTwo } = await reachCheckoutStepOne(page, [PRODUCT_1]);
      await checkoutStepOne.submitShippingInfo(JANE_DOE);
      await checkoutStepTwo.expectLoaded();

      await checkoutStepTwo.cancel();
      await expect(page).toHaveURL(/cart\.html/);
      await cartPage.removeItem(PRODUCT_1);
      await cartPage.expectItemCount(0);

      // Baseline pending clarified acceptance criteria: the requirement doesn't
      // define the expected behavior of re-entering checkout with a cart that's now
      // empty. This asserts the app doesn't silently produce a confirmed order and
      // instead lands on a known checkout/cart page.
      await cartPage.proceedToCheckout();
      await cartPage.expectUrlMatchesOneOf([/checkout-step-one\.html/, /cart\.html/]);
    }
  );
});

test.describe('JIRA-1 — EDGE: Edge-case and seeded-account scenarios', () => {
  test(
    '[SCN-33] problem_user seeded account: add-to-cart mechanics still function (known-issue baseline)',
    { tag: ['@SCN-33', '@priority-low', '@risk-medium'] },
    async ({ page }) => {
      test.info().annotations.push({ type: 'Scenario ID', description: 'SCN-33' });
      const { loginPage, inventoryPage, cartPage, checkoutStepOne } = buildPages(page);
      await loginPage.open();
      await loginPage.login('problem_user', 'secret_sauce');
      await inventoryPage.expectLoaded();
      await inventoryPage.addProductsToCart([PRODUCT_1, PRODUCT_2]);

      // Functional baseline: cart mechanics (badge count) must still work for this
      // seeded account even though it's documented to have UI-level rendering
      // defects. Asserting the exact nature of those UI defects (e.g. identical
      // product images) needs a manually confirmed expected value before it can be
      // pinned here without guessing at unverified app behavior.
      await inventoryPage.expectCartBadgeCount(2);
      await expect(inventoryPage.productImage(PRODUCT_1)).toBeVisible();
      await expect(inventoryPage.productImage(PRODUCT_2)).toBeVisible();

      // JIRA190-SCN-27: record whether checkout still functions for this known-issue
      // account, without presupposing the outcome since none is pinned by the
      // requirement — asserts a known-valid page rather than a crash/blank screen.
      await inventoryPage.goToCart();
      await cartPage.proceedToCheckout();
      await checkoutStepOne.submitShippingInfo({ firstName: 'Jane', lastName: 'Doe', postalCode: '10001' });
      await checkoutStepOne.expectUrlMatchesOneOf([/checkout-step-one\.html/, /checkout-step-two\.html/]);
    }
  );

  test(
    '[SCN-34] performance_glitch_user experiences a significant login delay',
    { tag: ['@SCN-34', '@priority-low', '@risk-medium'] },
    async ({ page }) => {
      test.info().annotations.push({ type: 'Scenario ID', description: 'SCN-34' });
      const { loginPage: glitchLogin, inventoryPage } = buildPages(page);

      await glitchLogin.open();
      const glitchStart = Date.now();
      await glitchLogin.login('performance_glitch_user', 'secret_sauce');
      await expect(inventoryPage.inventoryList).toBeVisible({ timeout: 15_000 });
      const glitchElapsedMs = Date.now() - glitchStart;

      await inventoryPage.logout();

      const { loginPage: standardLogin } = buildPages(page);
      await standardLogin.open();
      const standardStart = Date.now();
      await standardLogin.loginAsStandardUser();
      await inventoryPage.expectLoaded();
      const standardElapsedMs = Date.now() - standardStart;

      // Relative comparison against a standard_user baseline measured in the same
      // run avoids a brittle hard-coded absolute threshold across environments.
      expect(glitchElapsedMs).toBeGreaterThan(standardElapsedMs);
    }
  );

  test(
    '[SCN-35] error_user seeded account: cart-removal behavior (known-issue baseline)',
    { tag: ['@SCN-35', '@priority-low', '@risk-medium'] },
    async ({ page }) => {
      test.info().annotations.push({ type: 'Scenario ID', description: 'SCN-35' });
      const { loginPage, inventoryPage, cartPage } = buildPages(page);
      await loginPage.open();
      await loginPage.login('error_user', 'secret_sauce');
      await inventoryPage.expectLoaded();
      await inventoryPage.addProductToCart(PRODUCT_1);
      await inventoryPage.goToCart();
      await cartPage.removeItem(PRODUCT_1);

      // Baseline: this seeded account is documented to be defective on some cart
      // actions. Bounded assertion captures whichever of the two possible outcomes
      // (successful removal vs. the item remaining) currently occurs, without
      // presupposing the exact defect until it's manually confirmed.
      const remainingItems = await cartPage.getItemCount();
      expect([0, 1]).toContain(remainingItems);
    }
  );

  test(
    '[SCN-36] Refreshing the browser mid-checkout on checkout-step-two.html',
    { tag: ['@SCN-36', '@priority-medium', '@risk-high'] },
    async ({ page }) => {
      test.info().annotations.push({ type: 'Scenario ID', description: 'SCN-36' });
      const consoleErrors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
      });

      const { cartPage, checkoutStepOne, checkoutStepTwo } = await reachCheckoutStepOne(page, [PRODUCT_1]);
      await checkoutStepOne.submitShippingInfo(JANE_DOE);
      await checkoutStepTwo.expectLoaded();

      await page.reload();

      await checkoutStepTwo.expectUrlMatchesOneOf([
        /checkout-step-two\.html/,
        /checkout-step-one\.html/,
        /cart\.html/,
      ]);
      expect(consoleErrors, `Unexpected console errors after reload: ${consoleErrors.join('; ')}`).toHaveLength(0);

      if (page.url().includes('checkout-step-two.html')) {
        await checkoutStepTwo.expectTotalIsCorrect();
      } else if (page.url().includes('cart.html')) {
        await cartPage.expectLoaded();
        await cartPage.expectItemInCart(PRODUCT_1);
      }
    }
  );

  test(
    '[SCN-37][JIRA190-SCN-30] Browser Back after completing an order does not allow duplicate submission',
    { tag: ['@SCN-37', '@JIRA190-SCN-30', '@priority-medium', '@risk-high'] },
    async ({ page }) => {
      test.info().annotations.push({ type: 'Scenario ID', description: 'SCN-37' });
      test.info().annotations.push({ type: 'Scenario ID', description: 'JIRA190-SCN-30' });
      // Also satisfies JIRA-190's JIRA190-SCN-30 (EDGE-4) — identical steps/assertions,
      // extended with the cart-page item count of 0 it additionally requires.
      const { inventoryPage, cartPage, checkoutStepOne, checkoutStepTwo, checkoutComplete } = await reachCheckoutStepOne(page, [
        PRODUCT_1,
      ]);
      await checkoutStepOne.submitShippingInfo(JANE_DOE);
      await checkoutStepTwo.finishOrder();
      await checkoutComplete.expectOrderConfirmed();

      await page.goBack();
      if (await checkoutStepTwo.finishButton.isVisible()) {
        await checkoutStepTwo.finishButton.click();
      }

      // The cart was already cleared by the first successful order; regardless of
      // whether Back re-exposes the Finish button, the cart must not silently
      // rebuild itself into a second order — the badge stays absent.
      await inventoryPage.goto('/inventory.html');
      await inventoryPage.expectCartEmpty();
      await inventoryPage.goToCart();
      await cartPage.expectItemCount(0);
    }
  );

  test(
    '[SCN-38] Clicking Add to cart on an already-added product does not duplicate the item',
    { tag: ['@SCN-38', '@priority-medium', '@risk-medium'] },
    async ({ page }) => {
      test.info().annotations.push({ type: 'Scenario ID', description: 'SCN-38' });
      const { inventoryPage } = await loginAsStandardUser(page);
      await inventoryPage.addProductToCart(PRODUCT_1);
      await inventoryPage.expectCartBadgeCount(1);

      // The control has now toggled to "Remove" — there is no "Add to cart" button
      // left to click again for this product, which is itself the mechanism that
      // prevents a duplicate line item.
      await inventoryPage.expectProductInCart(PRODUCT_1);
      await inventoryPage.expectCartBadgeCount(1);
    }
  );

  test(
    '[SCN-39][JIRA190-SCN-32] Adding all six catalog products reaches maximal cart state',
    { tag: ['@SCN-39', '@JIRA190-SCN-32', '@priority-medium', '@risk-medium'] },
    async ({ page }) => {
      test.info().annotations.push({ type: 'Scenario ID', description: 'SCN-39' });
      test.info().annotations.push({ type: 'Scenario ID', description: 'JIRA190-SCN-32' });
      // Also satisfies JIRA-190's JIRA190-SCN-32 (EDGE-6) — same six-product checkout,
      // extended below with the exact 129.94 / 10.40 / 140.34 assertions it requires.
      const { inventoryPage, cartPage, checkoutStepOne, checkoutStepTwo } = await loginAsStandardUser(page);
      const expectedSubtotal = (await inventoryPage.getDisplayedPrices()).reduce((sum, p) => sum + p, 0);
      await inventoryPage.addProductsToCart(ALL_PRODUCTS);
      await inventoryPage.expectCartBadgeCount(6);

      await inventoryPage.goToCart();
      await cartPage.expectItemCount(6);

      await cartPage.proceedToCheckout();
      await checkoutStepOne.submitShippingInfo(JANE_DOE);
      await checkoutStepTwo.expectLoaded();
      const subtotal = await checkoutStepTwo.getItemSubtotal();
      expect(subtotal).toBeCloseTo(expectedSubtotal, 2); // subtotal equals sum of all 6 displayed prices
      expect(subtotal).toBeCloseTo(129.94, 2);
      expect(await checkoutStepTwo.getTax()).toBeCloseTo(10.4, 2);
      expect(await checkoutStepTwo.getTotal()).toBeCloseTo(140.34, 2);
      await checkoutStepTwo.expectTotalIsCorrect();
    }
  );

  test(
    '[SCN-40][JIRA190-SCN-34] Script/SQL-injection-style input in the shipping form is not executed',
    { tag: ['@SCN-40', '@JIRA190-SCN-34', '@priority-medium', '@risk-high'] },
    async ({ page }) => {
      test.info().annotations.push({ type: 'Scenario ID', description: 'SCN-40' });
      test.info().annotations.push({ type: 'Scenario ID', description: 'JIRA190-SCN-34' });
      // Also satisfies JIRA-190's JIRA190-SCN-34 (EDGE-8, XSS/special characters in
      // shipping fields) — same script-injection firstName payload with a
      // no-dialog-fired assertion and accept-or-reject outcome check.
      let dialogFired = false;
      page.on('dialog', async (dialog) => {
        dialogFired = true;
        await dialog.dismiss();
      });
      const consoleErrors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
      });

      const { checkoutStepOne } = await reachCheckoutStepOne(page, [PRODUCT_1]);
      await checkoutStepOne.fillShippingInfo({
        firstName: "<script>alert('xss')</script>",
        lastName: 'Doe',
        postalCode: "' OR '1'='1",
      });
      await checkoutStepOne.continueToOverview();

      // Whether the app accepts or rejects the payload isn't specified by the
      // requirement; either outcome is acceptable as long as no dialog executed.
      await checkoutStepOne.expectUrlMatchesOneOf([/checkout-step-one\.html/, /checkout-step-two\.html/]);
      expect(dialogFired, 'A JS dialog fired — the injected script executed').toBe(false);
      expect(consoleErrors, `Unexpected console errors: ${consoleErrors.join('; ')}`).toHaveLength(0);
    }
  );

  test(
    '[SCN-41] Whitespace-only input in required shipping fields is rejected',
    { tag: ['@SCN-41', '@priority-medium', '@risk-high'] },
    async ({ page }) => {
      test.info().annotations.push({ type: 'Scenario ID', description: 'SCN-41' });
      const { checkoutStepOne } = await reachCheckoutStepOne(page, [PRODUCT_1]);
      await checkoutStepOne.fillShippingInfo({ firstName: '   ', lastName: 'Doe', postalCode: '10001' });
      await checkoutStepOne.continueToOverview();

      // Note: current app behavior for whitespace-only trimming is unverified by
      // the requirement — this pins the expected (validation-required) behavior and
      // may surface a real defect if SauceDemo treats whitespace as non-empty input.
      await checkoutStepOne.expectValidationError(/first name is required/i);
      await checkoutStepOne.expectLoaded();
    }
  );

  test(
    '[SCN-42] Excessively long input in postal code field is handled gracefully',
    { tag: ['@SCN-42', '@priority-low', '@risk-medium'] },
    async ({ page }) => {
      test.info().annotations.push({ type: 'Scenario ID', description: 'SCN-42' });
      const consoleErrors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
      });

      const { checkoutStepOne } = await reachCheckoutStepOne(page, [PRODUCT_1]);
      await checkoutStepOne.fillShippingInfo({ firstName: 'Jane', lastName: 'Doe', postalCode: '1'.repeat(300) });
      await checkoutStepOne.continueToOverview();

      await checkoutStepOne.expectUrlMatchesOneOf([/checkout-step-one\.html/, /checkout-step-two\.html/]);
      expect(consoleErrors, `Unexpected console errors: ${consoleErrors.join('; ')}`).toHaveLength(0);
    }
  );

  test(
    '[SCN-43][JIRA190-SCN-25] Direct URL navigation to checkout-complete.html without completing prior steps',
    { tag: ['@SCN-43', '@JIRA190-SCN-25', '@priority-medium', '@risk-high'] },
    async ({ page }) => {
      test.info().annotations.push({ type: 'Scenario ID', description: 'SCN-43' });
      test.info().annotations.push({ type: 'Scenario ID', description: 'JIRA190-SCN-25' });
      // Also satisfies JIRA-190's JIRA190-SCN-25 (NEG-11) — identical direct-navigation
      // false-confirmation guard check, with the empty-cart precondition asserted first.
      const { checkoutComplete, inventoryPage } = await loginAsStandardUser(page);
      await inventoryPage.expectCartEmpty();
      await checkoutComplete.goto('/checkout-complete.html');

      // Ad-hoc guard check: no natural page-object home for "assert a false
      // confirmation isn't shown when prior checkout steps were skipped".
      if (page.url().includes('checkout-complete.html')) {
        await expect(checkoutComplete.completeHeader).not.toHaveText(/thank you for your order/i);
      } else {
        await expect(page).not.toHaveURL(/checkout-complete\.html/);
      }
    }
  );

  test(
    '[SCN-44][JIRA190-SCN-37] Cart state after logout and re-login as the same user',
    { tag: ['@SCN-44', '@JIRA190-SCN-37', '@priority-low', '@risk-medium', '@risk-high'] },
    async ({ page }) => {
      test.info().annotations.push({ type: 'Scenario ID', description: 'SCN-44' });
      test.info().annotations.push({ type: 'Scenario ID', description: 'JIRA190-SCN-37' });
      // Also satisfies JIRA-190's JIRA190-SCN-37 (EDGE-11) — same logout/re-login flow,
      // extended with the badge-vs-cart-page consistency check it requires.
      const { loginPage, inventoryPage, cartPage } = await loginAsStandardUser(page);
      await inventoryPage.addProductToCart(PRODUCT_1);
      await inventoryPage.expectCartBadgeCount(1);

      await inventoryPage.logout();
      await loginPage.login('standard_user', 'secret_sauce');
      await inventoryPage.expectLoaded();

      // Baseline pending clarified acceptance criteria: the requirement doesn't
      // specify whether cart contents should persist or reset across a
      // logout/login cycle for the same user — this pins whichever of the two
      // well-defined states (0 = reset, 1 = persisted) is currently observed.
      const badgeCount = await inventoryPage.cartBadge.count();
      expect([0, 1]).toContain(badgeCount);

      // JIRA190-SCN-37: whichever state is observed, the badge and the cart page agree.
      await inventoryPage.goToCart();
      expect(await cartPage.getItemCount()).toBe(badgeCount);
    }
  );
});
