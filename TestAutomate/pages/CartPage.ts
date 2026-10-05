import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage';

export class CartPage extends BasePage {
  readonly cartItems: Locator;
  readonly checkoutButton: Locator;
  readonly continueShoppingButton: Locator;

  constructor(page: Page) {
    super(page);
    this.cartItems = page.getByTestId('inventory-item');
    this.checkoutButton = page.getByTestId('checkout');
    this.continueShoppingButton = page.getByTestId('continue-shopping');
  }

  async expectLoaded() {
    await this.expectUrlContains('/cart.html');
  }

  async expectItemInCart(productName: string) {
    await expect(this.cartItems.filter({ hasText: productName })).toBeVisible();
  }

  async expectItemCount(count: number) {
    await expect(this.cartItems).toHaveCount(count);
  }

  /** Raw item count — used where an exact expectation isn't known upfront (e.g. defect baselines) */
  async getItemCount(): Promise<number> {
    return this.cartItems.count();
  }

  /** Displayed unit price of a named cart line item */
  async getItemPrice(productName: string): Promise<number> {
    const text = await this.cartItems
      .filter({ hasText: productName })
      .getByTestId('inventory-item-price')
      .textContent();
    return text ? parseFloat(text.replace('$', '')) : NaN;
  }

  /** Displayed quantity of a named cart line item */
  async getItemQuantity(productName: string): Promise<number> {
    const text = await this.cartItems
      .filter({ hasText: productName })
      .getByTestId('item-quantity')
      .textContent();
    return text ? parseInt(text, 10) : NaN;
  }

  async removeItem(productName: string) {
    await this.cartItems
      .filter({ hasText: productName })
      .getByRole('button', { name: /remove/i })
      .click();
  }

  async proceedToCheckout() {
    await this.checkoutButton.click();
  }
}
