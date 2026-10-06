import { test, expect, Page } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { InventoryPage } from '../pages/InventoryPage';
import { CartPage } from '../pages/CartPage';
import { CheckoutStepOnePage } from '../pages/CheckoutStepOnePage';
import { CheckoutStepTwoPage } from '../pages/CheckoutStepTwoPage';
import { CheckoutCompletePage } from '../pages/CheckoutCompletePage';

// Automation of TestDesign/JIRA-190_PlaywrightScenarios.csv (JIRA190-TC-001 .. TC-036).
//
// Every test carries the scenario's own ID as "@JIRA190-TC-<nnn>" plus a 'Scenario ID'
// annotation (TestReview F-03). The legacy JIRA190-SCN-<n> tests in the other specs are
// left untouched; they come from an earlier scenario set.
//
// Review recommendations applied (TestReview/JIRA-190_TestReview.md):
//  - TC-018 / TC-020 (F-02): the old mappings accepted either outcome, so they checked
//    nothing. Here each asserts one definite outcome (cart retained; checkout blocked).
//    TC-020 is test.fail(): SauceDemo allows empty-cart checkout, a likely defect (Q2).
//  - TC-009 / TC-011 / TC-012 / TC-019 / TC-022 / TC-032 / TC-034 (F-07): the gaps are
//    asserted (Back after logout; cart prices; open the cart; no guest cart;
//    per-line quantity; refresh and Back split with exact pages; step two + complete).
//  - TC-031 (F-08): only the session cookie is cleared, so localStorage (the cart) survives.
//  - TC-021 vs TC-033 (F-10): TC-021 is the single-item case, TC-033 the two-product case.
//  - TC-023 (F-05/F-09): one check per required field, plus all blank.
//  - TC-007, 013, 015, 016, 017, 024, 025, 026, 028, 030 (F-06): SauceDemo has no such
//    feature (lockout, quantity, stock, payment, phone, order history/email). They are
//    test.fixme() placeholders so they show up as skipped, not as passes.

const PRODUCT_1 = 'Sauce Labs Backpack'; // $29.99
const PRODUCT_2 = 'Sauce Labs Bike Light'; // $9.99
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

function annotate(id: string) {
  test.info().annotations.push({ type: 'Scenario ID', description: id });
}

async function loginAsStandardUser(page: Page): Promise<Pages> {
  const pages = buildPages(page);
  await pages.loginPage.open();
  await pages.loginPage.loginAsStandardUser();
  await pages.inventoryPage.expectLoaded();
  return pages;
}

async function reachCheckoutStepOne(page: Page, products: string[]): Promise<Pages> {
  const pages = await loginAsStandardUser(page);
  await pages.inventoryPage.addProductsToCart(products);
  await pages.inventoryPage.goToCart();
  await pages.cartPage.proceedToCheckout();
  await pages.checkoutStepOne.expectLoaded();
  return pages;
}

async function reachCheckoutStepTwo(page: Page, products: string[]): Promise<Pages> {
  const pages = await reachCheckoutStepOne(page, products);
  await pages.checkoutStepOne.submitShippingInfo(JANE_DOE);
  await pages.checkoutStepTwo.expectLoaded();
  return pages;
}

// ---------------------------------------------------------------- Login (R1)
test.describe('JIRA-190 TC — Login', () => {
  test('[JIRA190-TC-001] Login with valid credentials', { tag: ['@JIRA190-TC-001', '@priority-high'] }, async ({ page }) => {
    annotate('JIRA190-TC-001');
    const { loginPage, inventoryPage } = buildPages(page);
    await loginPage.open();
    await loginPage.login('standard_user', 'secret_sauce');
    await expect(page).toHaveURL(/\/inventory\.html/);
    await inventoryPage.expectLoaded();
    await expect(loginPage.errorMessage).toHaveCount(0);
  });

  test('[JIRA190-TC-002] Login with invalid password', { tag: ['@JIRA190-TC-002', '@priority-high'] }, async ({ page }) => {
    annotate('JIRA190-TC-002');
    const { loginPage } = buildPages(page);
    await loginPage.open();
    await loginPage.login('standard_user', 'wrong_pass'); // valid user, wrong password
    await loginPage.expectLoginError(/username and password do not match any user/i);
    await expect(page).not.toHaveURL(/inventory\.html/);
  });

  test('[JIRA190-TC-003] Login with unregistered username', { tag: ['@JIRA190-TC-003', '@priority-high'] }, async ({ page }) => {
    annotate('JIRA190-TC-003');
    const { loginPage } = buildPages(page);
    await loginPage.open();
    await loginPage.login('invalid_user', 'secret_sauce');
    await loginPage.expectLoginError(/username and password do not match any user/i);
    await expect(page).not.toHaveURL(/inventory\.html/);
    await loginPage.goto('/inventory.html');
    await loginPage.expectOnLoginPage(); // not logged in
  });

  test('[JIRA190-TC-004] Login with empty fields', { tag: ['@JIRA190-TC-004', '@priority-medium'] }, async ({ page }) => {
    annotate('JIRA190-TC-004');
    const { loginPage } = buildPages(page);
    await loginPage.open();
    await loginPage.loginButton.click();
    // The app shows a single error (the username one), not one per field.
    await loginPage.expectLoginError(/username is required/i);
    await expect(page).not.toHaveURL(/inventory\.html/);
  });

  test('[JIRA190-TC-005] Login with only username or only password', { tag: ['@JIRA190-TC-005', '@priority-medium'] }, async ({ page }) => {
    annotate('JIRA190-TC-005');
    const { loginPage } = buildPages(page);
    await test.step('only username -> password required', async () => {
      await loginPage.open();
      await loginPage.login('standard_user', '');
      await loginPage.expectLoginError(/password is required/i);
    });
    await test.step('only password -> username required', async () => {
      await page.reload();
      await loginPage.login('', 'secret_sauce');
      await loginPage.expectLoginError(/username is required/i);
    });
    await expect(page).not.toHaveURL(/inventory\.html/);
  });

  test('[JIRA190-TC-006] Password field is masked', { tag: ['@JIRA190-TC-006', '@priority-low'] }, async ({ page }) => {
    annotate('JIRA190-TC-006');
    const { loginPage } = buildPages(page);
    await loginPage.open();
    await loginPage.passwordInput.fill('secret_sauce');
    await expect(loginPage.passwordInput).toHaveAttribute('type', 'password');
  });

  // No lockout after repeated failures exists in SauceDemo and the policy is undefined (Q5).
  test.fixme('[JIRA190-TC-007] Account lockout after repeated failed attempts', { tag: ['@JIRA190-TC-007', '@priority-medium'] }, async () => {
    annotate('JIRA190-TC-007');
    // Blocked: no lockout policy/threshold defined (TestReview Q5, F-06). When defined:
    // loop N wrong-password logins as standard_user, then log in with the right password
    // and assert the agreed locked/throttled message.
  });

  test('[JIRA190-TC-008] SQL injection / special characters in login fields', { tag: ['@JIRA190-TC-008', '@priority-medium'] }, async ({ page }) => {
    annotate('JIRA190-TC-008');
    let dialogFired = false;
    page.on('dialog', async (d) => {
      dialogFired = true;
      await d.dismiss();
    });
    const { loginPage } = buildPages(page);
    // Review F-12: exercise both the username and the password field.
    for (const [user, pass] of [
      ["' OR '1'='1", 'secret_sauce'],
      ['standard_user', "' OR '1'='1"],
    ]) {
      await loginPage.open();
      await loginPage.login(user, pass);
      await loginPage.expectLoginError(/username and password do not match any user/i);
      await expect(page).not.toHaveURL(/inventory\.html/);
    }
    expect(dialogFired, 'A JS dialog fired — injected script executed').toBe(false);
  });

  test('[JIRA190-TC-009] Logout ends session', { tag: ['@JIRA190-TC-009', '@priority-medium'] }, async ({ page }) => {
    annotate('JIRA190-TC-009');
    const { loginPage, inventoryPage } = await loginAsStandardUser(page);
    await inventoryPage.logout();
    await loginPage.expectOnLoginPage();

    // Review: the browser Back step was not asserted before.
    await page.goBack();
    await expect(page).not.toHaveURL(/inventory\.html/);
    await loginPage.expectOnLoginPage();
    await expect(inventoryPage.inventoryList).toBeHidden();

    for (const path of ['/inventory.html', '/cart.html']) {
      await loginPage.goto(path);
      await loginPage.expectOnLoginPage();
      await expect(page).not.toHaveURL(new RegExp(path.replace('.', '\\.') + '$'));
    }
  });
});

// ---------------------------------------------------------------- Cart (R2)
test.describe('JIRA-190 TC — Cart', () => {
  test('[JIRA190-TC-010] Add single product to cart', { tag: ['@JIRA190-TC-010', '@priority-high'] }, async ({ page }) => {
    annotate('JIRA190-TC-010');
    const { inventoryPage, cartPage } = await loginAsStandardUser(page);
    await inventoryPage.addProductToCart(PRODUCT_1);
    await inventoryPage.expectCartBadgeCount(1);
    await inventoryPage.goToCart();
    await cartPage.expectItemCount(1);
    await cartPage.expectItemInCart(PRODUCT_1);
    expect(await cartPage.getItemPrice(PRODUCT_1)).toBeCloseTo(29.99, 2);
  });

  test('[JIRA190-TC-011] Add multiple different products', { tag: ['@JIRA190-TC-011', '@priority-high'] }, async ({ page }) => {
    annotate('JIRA190-TC-011');
    const { inventoryPage, cartPage } = await loginAsStandardUser(page);
    const listed1 = await inventoryPage.getProductPrice(PRODUCT_1);
    const listed2 = await inventoryPage.getProductPrice(PRODUCT_2);
    await inventoryPage.addProductsToCart([PRODUCT_1, PRODUCT_2]);
    await inventoryPage.expectCartBadgeCount(2);
    await inventoryPage.goToCart();
    await cartPage.expectItemCount(2);
    // Review: per-item prices in the cart must match the product list.
    expect(await cartPage.getItemPrice(PRODUCT_1)).toBeCloseTo(listed1, 2);
    expect(await cartPage.getItemPrice(PRODUCT_2)).toBeCloseTo(listed2, 2);
    expect(listed1).toBeCloseTo(29.99, 2);
    expect(listed2).toBeCloseTo(9.99, 2);
  });

  test('[JIRA190-TC-012] Add same product multiple times', { tag: ['@JIRA190-TC-012', '@priority-medium'] }, async ({ page }) => {
    annotate('JIRA190-TC-012');
    const { inventoryPage, cartPage } = await loginAsStandardUser(page);
    await inventoryPage.addProductToCart(PRODUCT_1);
    // "Add to cart" has toggled to "Remove": the product cannot be added a second time.
    await inventoryPage.expectProductInCart(PRODUCT_1);
    await inventoryPage.expectCartBadgeCount(1);
    // Review: actually open the cart — one line, quantity 1 (no quantity control exists).
    await inventoryPage.goToCart();
    await cartPage.expectItemCount(1);
    expect(await cartPage.getItemQuantity(PRODUCT_1)).toBe(1);
  });

  test.fixme('[JIRA190-TC-013] Update item quantity in cart', { tag: ['@JIRA190-TC-013', '@priority-medium'] }, async () => {
    annotate('JIRA190-TC-013');
    // Blocked: SauceDemo's cart has no quantity control or Update button (F-06, Q6).
  });

  test('[JIRA190-TC-014] Remove item from cart', { tag: ['@JIRA190-TC-014', '@priority-medium'] }, async ({ page }) => {
    annotate('JIRA190-TC-014');
    const { inventoryPage, cartPage, checkoutStepOne, checkoutStepTwo } = await loginAsStandardUser(page);
    await inventoryPage.addProductsToCart([PRODUCT_1, PRODUCT_2]);
    await inventoryPage.goToCart();
    await cartPage.expectItemCount(2);
    await cartPage.removeItem(PRODUCT_2);
    await cartPage.expectItemCount(1);
    await cartPage.expectItemInCart(PRODUCT_1);
    await expect(cartPage.cartItems.filter({ hasText: PRODUCT_2 })).toHaveCount(0);
    await inventoryPage.expectCartBadgeCount(1);
    await cartPage.proceedToCheckout();
    await checkoutStepOne.submitShippingInfo(JANE_DOE);
    await checkoutStepTwo.expectLoaded();
    expect(await checkoutStepTwo.getItemSubtotal()).toBeCloseTo(29.99, 2);
    expect(await checkoutStepTwo.getTax()).toBeCloseTo(2.4, 2);
    expect(await checkoutStepTwo.getTotal()).toBeCloseTo(32.39, 2);
  });

  test.fixme('[JIRA190-TC-015] Quantity zero or negative', { tag: ['@JIRA190-TC-015', '@priority-medium'] }, async () => {
    annotate('JIRA190-TC-015');
    // Blocked: no quantity control (F-06). Split 0 and -1 into separate checks when built (F-09).
  });

  test.fixme('[JIRA190-TC-016] Add out-of-stock product', { tag: ['@JIRA190-TC-016', '@priority-high'] }, async () => {
    annotate('JIRA190-TC-016');
    // Blocked: SauceDemo has no stock levels or out-of-stock product (F-06, Q6).
  });

  test.fixme('[JIRA190-TC-017] Quantity exceeds available stock', { tag: ['@JIRA190-TC-017', '@priority-medium'] }, async () => {
    annotate('JIRA190-TC-017');
    // Blocked: no stock limits or quantity control (F-06).
  });

  test('[JIRA190-TC-018] Cart persists after logout/login', { tag: ['@JIRA190-TC-018', '@priority-medium'] }, async ({ page }) => {
    annotate('JIRA190-TC-018');
    // Review F-02: the old mapping accepted 0 or 1 items. Assert the CSV's expected result:
    // items are retained (Q3 still open — if the product owner says "reset", flip this).
    const { loginPage, inventoryPage, cartPage } = await loginAsStandardUser(page);
    await inventoryPage.addProductToCart(PRODUCT_1);
    await inventoryPage.expectCartBadgeCount(1);
    await inventoryPage.logout();
    await loginPage.expectOnLoginPage();
    await loginPage.login('standard_user', 'secret_sauce');
    await inventoryPage.expectLoaded();
    await inventoryPage.expectCartBadgeCount(1);
    await inventoryPage.goToCart();
    await cartPage.expectItemCount(1);
    await cartPage.expectItemInCart(PRODUCT_1);
  });

  test('[JIRA190-TC-019] Add to cart without login', { tag: ['@JIRA190-TC-019', '@priority-medium'] }, async ({ page }) => {
    annotate('JIRA190-TC-019');
    const { loginPage, inventoryPage } = buildPages(page);
    for (const path of ['/inventory.html', '/cart.html']) {
      await loginPage.goto(path);
      await expect(page).not.toHaveURL(new RegExp(path.replace('.', '\\.') + '$'));
      await loginPage.expectOnLoginPage();
      // No product list or add button is offered to a guest.
      await expect(inventoryPage.inventoryList).toBeHidden();
      await expect(page.getByRole('button', { name: /add to cart/i })).toHaveCount(0);
    }
    // Review: also confirm no guest cart was created, i.e. nothing shows after login.
    await loginPage.login('standard_user', 'secret_sauce');
    await inventoryPage.expectLoaded();
    await inventoryPage.expectCartEmpty();
  });

  // Review F-02: SauceDemo lets an empty cart go to checkout, so "blocked" most likely fails.
  test('[JIRA190-TC-020] Empty cart state', { tag: ['@JIRA190-TC-020', '@priority-medium', '@known-defect'] }, async ({ page }) => {
    annotate('JIRA190-TC-020');
    test.fail(true, 'Likely defect / open question Q2: SauceDemo allows checkout with an empty cart. Remove test.fail() once decided.');
    const { inventoryPage, cartPage } = await loginAsStandardUser(page);
    await inventoryPage.expectCartEmpty();
    await inventoryPage.goToCart();
    await cartPage.expectItemCount(0);
    await cartPage.proceedToCheckout();
    // Expected (CSV): checkout blocked — user stays on the cart.
    await expect(page).toHaveURL(/cart\.html/);
    await expect(page).not.toHaveURL(/checkout-step-one\.html/);
  });
});

// ---------------------------------------------------------------- Checkout (R3)
test.describe('JIRA-190 TC — Checkout', () => {
  test('[JIRA190-TC-021] Complete checkout end-to-end with valid data (single item)', { tag: ['@JIRA190-TC-021', '@priority-high'] }, async ({ page }) => {
    annotate('JIRA190-TC-021');
    // No payment step or order number exists in SauceDemo (F-06/Q1); confirmation page is asserted.
    const { checkoutStepTwo, checkoutComplete } = await reachCheckoutStepTwo(page, [PRODUCT_1]);
    await expect(checkoutStepTwo.cartItems).toHaveCount(1);
    await checkoutStepTwo.finishOrder();
    await checkoutComplete.expectOrderConfirmed();
  });

  test('[JIRA190-TC-022] Order summary accuracy', { tag: ['@JIRA190-TC-022', '@priority-high'] }, async ({ page }) => {
    annotate('JIRA190-TC-022');
    const { checkoutStepTwo } = await reachCheckoutStepTwo(page, [PRODUCT_1, PRODUCT_2]);
    await expect(checkoutStepTwo.cartItems).toHaveCount(2);
    // Review: per-line quantity and price, then totals computed from the lines.
    let lineSum = 0;
    for (const [name, price] of [[PRODUCT_1, 29.99], [PRODUCT_2, 9.99]] as [string, number][]) {
      const line = checkoutStepTwo.cartItems.filter({ hasText: name });
      await expect(line).toHaveCount(1);
      await expect(line.getByTestId('item-quantity')).toHaveText('1');
      await expect(line.getByTestId('inventory-item-price')).toHaveText(`$${price.toFixed(2)}`);
      lineSum += price;
    }
    expect(await checkoutStepTwo.getItemSubtotal()).toBeCloseTo(lineSum, 2);
    expect(await checkoutStepTwo.getTax()).toBeCloseTo(3.2, 2);
    expect(await checkoutStepTwo.getTotal()).toBeCloseTo(43.18, 2);
    await checkoutStepTwo.expectTotalIsCorrect();
  });

  test('[JIRA190-TC-023] Mandatory shipping fields blank', { tag: ['@JIRA190-TC-023', '@priority-high'] }, async ({ page }) => {
    annotate('JIRA190-TC-023');
    const { checkoutStepOne } = await reachCheckoutStepOne(page, [PRODUCT_1]);
    const cases: { label: string; info: typeof JANE_DOE; error: RegExp }[] = [
      { label: 'first name blank', info: { ...JANE_DOE, firstName: '' }, error: /first name is required/i },
      { label: 'last name blank', info: { ...JANE_DOE, lastName: '' }, error: /last name is required/i },
      { label: 'postal code blank', info: { ...JANE_DOE, postalCode: '' }, error: /postal code is required/i },
      { label: 'all blank', info: { firstName: '', lastName: '', postalCode: '' }, error: /first name is required/i },
    ];
    for (const { label, info, error } of cases) {
      await test.step(label, async () => {
        await checkoutStepOne.fillShippingInfo(info);
        await checkoutStepOne.continueToOverview();
        await checkoutStepOne.expectValidationError(error);
        await checkoutStepOne.expectLoaded();
      });
    }
  });

  test.fixme('[JIRA190-TC-024] Invalid payment details', { tag: ['@JIRA190-TC-024', '@priority-high'] }, async () => {
    annotate('JIRA190-TC-024');
    // Blocked: SauceDemo has no payment step (F-06, Q1).
  });

  test.fixme('[JIRA190-TC-025] Payment declined', { tag: ['@JIRA190-TC-025', '@priority-high'] }, async () => {
    annotate('JIRA190-TC-025');
    // Blocked: no payment step or test cards (F-06, Q1).
  });

  test.fixme('[JIRA190-TC-026] Invalid postal code / phone format', { tag: ['@JIRA190-TC-026', '@priority-medium'] }, async () => {
    annotate('JIRA190-TC-026');
    // Blocked: no phone field; postal-code format rules undefined, SauceDemo accepts any text (Q7).
  });

  test('[JIRA190-TC-027] Cart emptied after successful order', { tag: ['@JIRA190-TC-027', '@priority-high'] }, async ({ page }) => {
    annotate('JIRA190-TC-027');
    const { inventoryPage, cartPage, checkoutStepTwo, checkoutComplete } = await reachCheckoutStepTwo(page, [PRODUCT_1]);
    await checkoutStepTwo.finishOrder();
    await checkoutComplete.expectOrderConfirmed();
    await inventoryPage.expectCartEmpty();
    await cartPage.goto('/cart.html');
    await cartPage.expectItemCount(0);
  });

  test.fixme('[JIRA190-TC-028] Order appears in order history and confirmation email sent', { tag: ['@JIRA190-TC-028', '@priority-medium'] }, async () => {
    annotate('JIRA190-TC-028');
    // Blocked: SauceDemo has no order history or email; scope unconfirmed (F-06, Q1). Split into two cases when in scope.
  });

  test('[JIRA190-TC-029] Double-click on Place Order', { tag: ['@JIRA190-TC-029', '@priority-high'] }, async ({ page }) => {
    annotate('JIRA190-TC-029');
    let completeNavigations = 0;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame() && frame.url().includes('checkout-complete.html')) completeNavigations++;
    });
    const { inventoryPage, checkoutStepTwo, checkoutComplete } = await reachCheckoutStepTwo(page, [PRODUCT_1]);
    await checkoutStepTwo.rapidDoubleClickFinish();
    await checkoutComplete.expectOrderConfirmed();
    expect(completeNavigations, 'Expected a single navigation to the confirmation page').toBe(1);
    await inventoryPage.expectCartEmpty();
  });

  test.fixme('[JIRA190-TC-030] Stock changes between add-to-cart and checkout', { tag: ['@JIRA190-TC-030', '@priority-medium'] }, async () => {
    annotate('JIRA190-TC-030');
    // Blocked: no stock levels and no hook to alter stock (F-06, Q6).
  });

  test('[JIRA190-TC-031] Session timeout during checkout', { tag: ['@JIRA190-TC-031', '@priority-medium'] }, async ({ page, context }) => {
    annotate('JIRA190-TC-031');
    const { loginPage, inventoryPage, checkoutStepTwo, checkoutComplete } = await reachCheckoutStepTwo(page, [PRODUCT_1]);

    // Review F-08: expire only the session cookie. Clearing all storage would wipe the
    // cart (localStorage) and contradict the "cart preserved" expectation.
    await context.clearCookies({ name: 'session-username' });
    await checkoutStepTwo.finishOrder();

    await expect(page).not.toHaveURL(/checkout-complete\.html/);
    await loginPage.expectOnLoginPage();
    await expect(checkoutComplete.completeHeader).toBeHidden(); // no partial/false order

    await loginPage.login('standard_user', 'secret_sauce');
    await inventoryPage.expectLoaded();
    await inventoryPage.expectCartBadgeCount(1); // cart preserved
  });

  test('[JIRA190-TC-032] Back/refresh during checkout', { tag: ['@JIRA190-TC-032', '@priority-medium'] }, async ({ page }) => {
    annotate('JIRA190-TC-032');
    await test.step('Refresh on the overview keeps the same state and creates no order', async () => {
      const { checkoutStepTwo, checkoutComplete } = await reachCheckoutStepTwo(page, [PRODUCT_1]);
      await page.reload();
      await checkoutStepTwo.expectLoaded();
      await expect(checkoutStepTwo.cartItems).toHaveCount(1);
      expect(await checkoutStepTwo.getItemSubtotal()).toBeCloseTo(29.99, 2);
      await checkoutStepTwo.expectTotalIsCorrect();
      await expect(checkoutComplete.completeHeader).toBeHidden();
    });
    await test.step('Browser Back from the overview returns to step one with the cart intact', async () => {
      const { inventoryPage, checkoutStepOne, checkoutComplete } = buildPages(page);
      await page.goBack();
      await checkoutStepOne.expectLoaded();
      await expect(page).not.toHaveURL(/checkout-complete\.html/);
      await expect(checkoutComplete.completeHeader).toBeHidden();
      await inventoryPage.expectCartBadgeCount(1);
    });
  });

  test('[JIRA190-TC-033] Full flow: login, add products, checkout', { tag: ['@JIRA190-TC-033', '@priority-high'] }, async ({ page }) => {
    annotate('JIRA190-TC-033');
    // Two-product journey (TC-021 is the single-item case, F-10). No "pay" step exists.
    const { inventoryPage, cartPage, checkoutStepOne, checkoutStepTwo, checkoutComplete } = await loginAsStandardUser(page);
    await inventoryPage.addProductsToCart([PRODUCT_1, PRODUCT_2]);
    await inventoryPage.expectCartBadgeCount(2);
    await inventoryPage.goToCart();
    await cartPage.expectItemCount(2);
    await cartPage.proceedToCheckout();
    await checkoutStepOne.submitShippingInfo(JANE_DOE);
    await checkoutStepTwo.expectLoaded();
    await expect(checkoutStepTwo.cartItems).toHaveCount(2);
    expect(await checkoutStepTwo.getTotal()).toBeCloseTo(43.18, 2);
    await checkoutStepTwo.finishOrder();
    await checkoutComplete.expectOrderConfirmed();
    await checkoutComplete.backToProducts();
    await inventoryPage.expectLoaded();
    await inventoryPage.expectCartEmpty();
  });
});

// ---------------------------------------------------------------- Security / compatibility
test.describe('JIRA-190 TC — Security and compatibility', () => {
  test('[JIRA190-TC-034] Checkout page access without login', { tag: ['@JIRA190-TC-034', '@priority-high'] }, async ({ page }) => {
    annotate('JIRA190-TC-034');
    const { loginPage, checkoutStepOne } = buildPages(page);
    // Review F-12 / table: step one, step two and the completion page.
    for (const path of ['/checkout-step-one.html', '/checkout-step-two.html', '/checkout-complete.html']) {
      await test.step(path, async () => {
        await loginPage.goto(path);
        await loginPage.expectOnLoginPage();
        await expect(page).not.toHaveURL(new RegExp(path.replace('.', '\\.') + '$'));
        await expect(checkoutStepOne.firstNameInput).toBeHidden();
        await expect(page.getByTestId('complete-header')).toBeHidden();
      });
    }
  });

  test('[JIRA190-TC-035] Payment data transmitted over HTTPS', { tag: ['@JIRA190-TC-035', '@priority-high'] }, async ({ page }) => {
    annotate('JIRA190-TC-035');
    // SauceDemo has no payment/card step (Q1); this covers what exists today: every request
    // made through the checkout (including shipping details) is HTTPS and no entered
    // value is placed in a URL.
    const urls: string[] = [];
    page.on('request', (req) => urls.push(req.url()));
    const { checkoutStepTwo, checkoutComplete } = await reachCheckoutStepTwo(page, [PRODUCT_1]);
    await checkoutStepTwo.finishOrder();
    await checkoutComplete.expectOrderConfirmed();

    expect(urls.length).toBeGreaterThan(0);
    const insecure = urls.filter((u) => !/^(https|data|blob|about):/i.test(u) );
    expect(insecure, `Non-HTTPS requests: ${insecure.join(', ')}`).toEqual([]);
    expect(urls.filter((u) => u.startsWith('http:'))).toEqual([]);
    const leaking = urls.filter((u) => /[?&#]/.test(u) && /Jane|Doe|10001|secret_sauce/i.test(decodeURIComponent(u)));
    expect(leaking, `Entered data found in URLs: ${leaking.join(', ')}`).toEqual([]);
  });

  // Same flow as TC-033. The firefox / webkit / mobile projects in playwright.config.ts
  // select this test through its @JIRA190-TC-036 tag.
  test('[JIRA190-TC-036] Flow on supported browsers and mobile', { tag: ['@JIRA190-TC-036', '@priority-medium'] }, async ({ page }) => {
    annotate('JIRA190-TC-036');
    const { inventoryPage, cartPage, checkoutStepOne, checkoutStepTwo, checkoutComplete, loginPage } = buildPages(page);
    await loginPage.open();
    await expect(loginPage.loginButton).toBeVisible();
    await loginPage.loginAsStandardUser();
    await inventoryPage.expectLoaded();
    await inventoryPage.addProductsToCart([PRODUCT_1, PRODUCT_2]);
    await inventoryPage.expectCartBadgeCount(2);
    await inventoryPage.goToCart();
    await cartPage.expectItemCount(2);
    await cartPage.proceedToCheckout();
    await checkoutStepOne.submitShippingInfo(JANE_DOE);
    await checkoutStepTwo.expectLoaded();
    await checkoutStepTwo.expectTotalIsCorrect();
    await checkoutStepTwo.finishOrder();
    await checkoutComplete.expectOrderConfirmed();
    await expect(checkoutComplete.backHomeButton).toBeVisible();
  });
});
