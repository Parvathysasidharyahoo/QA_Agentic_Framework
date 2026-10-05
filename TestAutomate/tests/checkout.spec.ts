import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { InventoryPage } from '../pages/InventoryPage';
import { CartPage } from '../pages/CartPage';
import { CheckoutStepOnePage } from '../pages/CheckoutStepOnePage';
import { CheckoutStepTwoPage } from '../pages/CheckoutStepTwoPage';
import { CheckoutCompletePage } from '../pages/CheckoutCompletePage';

const PRODUCT_1 = 'Sauce Labs Backpack';
const PRODUCT_2 = 'Sauce Labs Bike Light';

test.describe('SauceDemo — Checkout Journey', () => {
  let loginPage: LoginPage;
  let inventoryPage: InventoryPage;
  let cartPage: CartPage;
  let checkoutStepOne: CheckoutStepOnePage;
  let checkoutStepTwo: CheckoutStepTwoPage;
  let checkoutComplete: CheckoutCompletePage;

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page);
    inventoryPage = new InventoryPage(page);
    cartPage = new CartPage(page);
    checkoutStepOne = new CheckoutStepOnePage(page);
    checkoutStepTwo = new CheckoutStepTwoPage(page);
    checkoutComplete = new CheckoutCompletePage(page);

    await loginPage.open();
    await loginPage.loginAsStandardUser();
    await inventoryPage.expectLoaded();
  });

  test(
    '[SCN-1][SCN-14][JIRA190-SCN-9] P0 - Completes checkout successfully with a single item @smoke',
    { tag: ['@SCN-1', '@SCN-14', '@JIRA190-SCN-9', '@priority-high', '@risk-medium'] },
    async () => {
    // Scenario ID mapping: this single test satisfies both SCN-1 (TS-1, "End-to-end
    // checkout with a single product") and SCN-14 (POS-6, "Complete checkout with a
    // single item confirms order") — both scenarios describe an identical step/assertion
    // sequence, so no duplicate test was generated for either.
    // Also satisfies JIRA-190's JIRA190-SCN-9 (POS-4, "Complete checkout with single
    // item") — identical login/add/checkout/finish/confirm sequence.
    test.info().annotations.push({ type: 'Scenario ID', description: 'SCN-1' });
    test.info().annotations.push({ type: 'Scenario ID', description: 'SCN-14' });
    test.info().annotations.push({ type: 'Scenario ID', description: 'JIRA190-SCN-9' });
    await inventoryPage.addProductToCart(PRODUCT_1);
    await inventoryPage.expectCartBadgeCount(1);

    await inventoryPage.goToCart();
    await cartPage.expectLoaded();
    await cartPage.expectItemInCart(PRODUCT_1);

    await cartPage.proceedToCheckout();
    await checkoutStepOne.expectLoaded();
    await checkoutStepOne.submitShippingInfo({
      firstName: 'Jane',
      lastName: 'Doe',
      postalCode: '10001',
    });

    await checkoutStepTwo.expectLoaded();
    const subtotal = await checkoutStepTwo.getItemSubtotal();
    expect(subtotal).toBeCloseTo(29.99, 2); // single-item subtotal is the Backpack's list price
    await checkoutStepTwo.expectTotalIsCorrect(); // business-rule assertion: total = subtotal + tax
    await checkoutStepTwo.finishOrder();

    await checkoutComplete.expectOrderConfirmed();

    // Confirm the order is no longer active in the cart by navigating
    // directly to /cart.html rather than via the "Back Home" button.
    await cartPage.goto('/cart.html');
    await cartPage.expectItemCount(0);
  });

  test(
    '[SCN-2][SCN-15][JIRA190-SCN-1][JIRA190-SCN-10][JIRA190-SCN-11] P0 - Completes checkout successfully with multiple items',
    { tag: ['@SCN-2', '@SCN-15', '@JIRA190-SCN-1', '@JIRA190-SCN-10', '@JIRA190-SCN-11', '@priority-high', '@risk-high', '@risk-medium', '@risk-low'] },
    async () => {
    // Scenario ID mapping: covers both SCN-2 (TS-2, "End-to-end checkout with multiple
    // products") and SCN-15 (POS-7, "Complete checkout with multiple items confirms
    // correct combined pricing") — identical step/assertion sequence for both.
    // Also satisfies JIRA-190's JIRA190-SCN-1 (TS-1, two-product end-to-end journey
    // ending with Back Home + empty cart), JIRA190-SCN-10 (POS-5, two items listed on the
    // overview) and JIRA190-SCN-11 (POS-6, exact 39.98 / 3.20 / 43.18 totals for Backpack
    // + Bike Light) — same flow, extended below with those extra assertions.
    test.info().annotations.push({ type: 'Scenario ID', description: 'SCN-2' });
    test.info().annotations.push({ type: 'Scenario ID', description: 'SCN-15' });
    test.info().annotations.push({ type: 'Scenario ID', description: 'JIRA190-SCN-1' });
    test.info().annotations.push({ type: 'Scenario ID', description: 'JIRA190-SCN-10' });
    test.info().annotations.push({ type: 'Scenario ID', description: 'JIRA190-SCN-11' });
    const price1 = await inventoryPage.getProductPrice(PRODUCT_1);
    const price2 = await inventoryPage.getProductPrice(PRODUCT_2);
    await inventoryPage.addProductsToCart([PRODUCT_1, PRODUCT_2]);
    await inventoryPage.expectCartBadgeCount(2);

    await inventoryPage.goToCart();
    await cartPage.expectItemCount(2);

    await cartPage.proceedToCheckout();
    await checkoutStepOne.submitShippingInfo({
      firstName: 'John',
      lastName: 'Smith',
      postalCode: 'SW1A 1AA',
    });

    await checkoutStepTwo.expectLoaded();
    const subtotal = await checkoutStepTwo.getItemSubtotal();
    expect(subtotal).toBeGreaterThan(0);
    expect(subtotal).toBeCloseTo(price1 + price2, 2); // subtotal equals sum of item prices
    await expect(checkoutStepTwo.cartItems).toHaveCount(2); // JIRA190-SCN-10
    expect(subtotal).toBeCloseTo(39.98, 2); // JIRA190-SCN-11
    expect(await checkoutStepTwo.getTax()).toBeCloseTo(3.2, 2);
    expect(await checkoutStepTwo.getTotal()).toBeCloseTo(43.18, 2);
    await checkoutStepTwo.expectTotalIsCorrect();

    await checkoutStepTwo.finishOrder();
    await checkoutComplete.expectOrderConfirmed();

    // JIRA190-SCN-1: Back Home returns to inventory with an empty cart.
    await checkoutComplete.backToProducts();
    await inventoryPage.expectLoaded();
    await inventoryPage.expectCartEmpty();
  });

  test(
    '[SCN-26][SCN-29][JIRA190-SCN-22] P1 - Blocks checkout when shipping info is missing',
    { tag: ['@SCN-26', '@SCN-29', '@JIRA190-SCN-22', '@priority-high', '@priority-medium', '@risk-low', '@risk-medium'] },
    async () => {
    // Scenario ID mapping: covers SCN-26 (NEG-6, "Checkout blocked when first name is
    // missing") and SCN-29 (NEG-9, "Checkout form submitted fully empty shows first
    // required-field error") — both produce the identical "first name is required"
    // error and remain on step one, so a single existing test satisfies both.
    // Also satisfies JIRA-190's JIRA190-SCN-22 (NEG-8, "Checkout with all shipping
    // fields empty") — identical steps/assertions.
    test.info().annotations.push({ type: 'Scenario ID', description: 'SCN-26' });
    test.info().annotations.push({ type: 'Scenario ID', description: 'SCN-29' });
    test.info().annotations.push({ type: 'Scenario ID', description: 'JIRA190-SCN-22' });
    await inventoryPage.addProductToCart(PRODUCT_1);
    await inventoryPage.goToCart();
    await cartPage.proceedToCheckout();

    // Submit with empty fields
    await checkoutStepOne.continueToOverview();
    await checkoutStepOne.expectValidationError(/first name is required/i);

    // Confirm we never left step-one
    await checkoutStepOne.expectLoaded();
  });

  test(
    '[SCN-4][SCN-13][JIRA190-SCN-12] P1 - Removing an item from cart updates checkout total correctly',
    { tag: ['@SCN-4', '@SCN-13', '@JIRA190-SCN-12', '@priority-high', '@priority-medium', '@risk-medium'] },
    async () => {
    // Scenario ID mapping: covers SCN-4 (TS-4, "Cart management - add and remove items
    // updates badge and totals") and SCN-13 (POS-5, "Removing one of two cart items
    // recalculates checkout total correctly"). The extra expectCartBadgeCount(2) call
    // below (added for SCN-4's badge-check step) means this one test now fully covers
    // both scenarios' steps and assertions.
    // Also satisfies JIRA-190's JIRA190-SCN-12 (POS-7, "Removing item updates checkout
    // total") — identical add-two/remove-Bike-Light/checkout flow, extended below with
    // the exact 29.99 / 2.40 / 32.39 and single-overview-item assertions it requires.
    test.info().annotations.push({ type: 'Scenario ID', description: 'SCN-4' });
    test.info().annotations.push({ type: 'Scenario ID', description: 'SCN-13' });
    test.info().annotations.push({ type: 'Scenario ID', description: 'JIRA190-SCN-12' });
    const remainingItemPrice = await inventoryPage.getProductPrice(PRODUCT_1);
    await inventoryPage.addProductsToCart([PRODUCT_1, PRODUCT_2]);
    await inventoryPage.expectCartBadgeCount(2);
    await inventoryPage.goToCart();
    await cartPage.expectItemCount(2);

    await cartPage.removeItem(PRODUCT_2);
    await cartPage.expectItemCount(1);
    await cartPage.expectItemInCart(PRODUCT_1);

    await cartPage.proceedToCheckout();
    await checkoutStepOne.submitShippingInfo({
      firstName: 'Jane',
      lastName: 'Doe',
      postalCode: '10001',
    });

    await checkoutStepTwo.expectLoaded();
    const subtotal = await checkoutStepTwo.getItemSubtotal();
    expect(subtotal).toBeCloseTo(remainingItemPrice, 2); // subtotal equals the remaining item's price only
    await expect(checkoutStepTwo.cartItems).toHaveCount(1); // JIRA190-SCN-12
    expect(subtotal).toBeCloseTo(29.99, 2);
    expect(await checkoutStepTwo.getTax()).toBeCloseTo(2.4, 2);
    expect(await checkoutStepTwo.getTotal()).toBeCloseTo(32.39, 2);
    await checkoutStepTwo.expectTotalIsCorrect();
  });

});

test.describe('SauceDemo — Login guard (no shared checkout session)', () => {
  test(
    '[SCN-25][JIRA190-SCN-17] P2 - Locked out user cannot log in or reach checkout',
    { tag: ['@SCN-25', '@JIRA190-SCN-17', '@priority-high', '@risk-low'] },
    async ({ page }) => {
    // Scenario ID mapping: covers SCN-25 (NEG-5, "Locked-out user is blocked from
    // logging in") — identical steps/assertions to this pre-existing test.
    // Also satisfies JIRA-190's JIRA190-SCN-17 (NEG-3, "Login with locked_out_user") —
    // identical login/error/URL assertions, plus the inventory-list-hidden check below.
    test.info().annotations.push({ type: 'Scenario ID', description: 'SCN-25' });
    test.info().annotations.push({ type: 'Scenario ID', description: 'JIRA190-SCN-17' });
    const freshLoginPage = new LoginPage(page);
    await freshLoginPage.open();
    await freshLoginPage.login('locked_out_user', 'secret_sauce');
    await freshLoginPage.expectLoginError(/sorry, this user has been locked out/i);
    await expect(page).toHaveURL(/saucedemo\.com\/?$/);
    await expect(new InventoryPage(page).inventoryList).toBeHidden();
  });
});
