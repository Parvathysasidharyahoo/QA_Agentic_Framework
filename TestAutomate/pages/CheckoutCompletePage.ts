import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage';

export class CheckoutCompletePage extends BasePage {
  readonly completeHeader: Locator;
  readonly completeText: Locator;
  readonly backHomeButton: Locator;

  constructor(page: Page) {
    super(page);
    this.completeHeader = page.getByTestId('complete-header');
    this.completeText = page.getByTestId('complete-text');
    this.backHomeButton = page.getByTestId('back-to-products');
  }

  async expectOrderConfirmed() {
    await this.expectUrlContains('/checkout-complete.html');
    await expect(this.completeHeader).toHaveText(/thank you for your order/i);
    await expect(this.completeText).toBeVisible();
  }

  async backToProducts() {
    await this.backHomeButton.click();
  }
}
