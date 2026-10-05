import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage';

export class CheckoutStepTwoPage extends BasePage {
  readonly cartItems: Locator;
  readonly itemTotalLabel: Locator;
  readonly taxLabel: Locator;
  readonly totalLabel: Locator;
  readonly finishButton: Locator;
  readonly cancelButton: Locator;

  constructor(page: Page) {
    super(page);
    this.cartItems = page.getByTestId('inventory-item');
    this.itemTotalLabel = page.getByTestId('subtotal-label');
    this.taxLabel = page.getByTestId('tax-label');
    this.totalLabel = page.getByTestId('total-label');
    this.finishButton = page.getByTestId('finish');
    this.cancelButton = page.getByTestId('cancel');
  }

  async expectLoaded() {
    await this.expectUrlContains('/checkout-step-two.html');
  }

  /** Parses "Item total: $29.99" into a numeric subtotal for assertions/calculations */
  private async parseCurrencyLabel(locator: Locator): Promise<number> {
    const text = await locator.textContent();
    const match = text?.match(/\$([\d.]+)/);
    return match ? parseFloat(match[1]) : NaN;
  }

  async getItemSubtotal(): Promise<number> {
    return this.parseCurrencyLabel(this.itemTotalLabel);
  }

  async getTax(): Promise<number> {
    return this.parseCurrencyLabel(this.taxLabel);
  }

  async getTotal(): Promise<number> {
    return this.parseCurrencyLabel(this.totalLabel);
  }

  /** Business-rule assertion: total must equal subtotal + tax (within rounding tolerance) */
  async expectTotalIsCorrect() {
    const subtotal = await this.getItemSubtotal();
    const tax = await this.getTax();
    const total = await this.getTotal();
    expect(total).toBeCloseTo(subtotal + tax, 2);
  }

  async finishOrder() {
    await this.finishButton.click();
  }

  /** Rapid double-click on Finish to exercise duplicate-submission handling */
  async rapidDoubleClickFinish() {
    await this.finishButton.dblclick();
  }

  /** Cancels the overview step and returns to the cart page with items intact */
  async cancel() {
    await this.cancelButton.click();
  }
}
