import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage';

export interface CheckoutInfo {
  firstName: string;
  lastName: string;
  postalCode: string;
}

export class CheckoutStepOnePage extends BasePage {
  readonly firstNameInput: Locator;
  readonly lastNameInput: Locator;
  readonly postalCodeInput: Locator;
  readonly continueButton: Locator;
  readonly errorMessage: Locator;
  readonly cancelButton: Locator;

  constructor(page: Page) {
    super(page);
    this.cancelButton = page.getByTestId('cancel');
    this.firstNameInput = page.getByTestId('firstName');
    this.lastNameInput = page.getByTestId('lastName');
    this.postalCodeInput = page.getByTestId('postalCode');
    this.continueButton = page.getByTestId('continue');
    this.errorMessage = page.getByTestId('error');
  }

  async expectLoaded() {
    await this.expectUrlContains('/checkout-step-one.html');
  }

  async fillShippingInfo(info: CheckoutInfo) {
    await this.firstNameInput.fill(info.firstName);
    await this.lastNameInput.fill(info.lastName);
    await this.postalCodeInput.fill(info.postalCode);
  }

  async continueToOverview() {
    await this.continueButton.click();
  }

  /** Reusable convenience method combining fill + continue for the happy path */
  async submitShippingInfo(info: CheckoutInfo) {
    await this.fillShippingInfo(info);
    await this.continueToOverview();
  }

  /** Cancels step one and returns to the cart page */
  async cancel() {
    await this.cancelButton.click();
  }

  async expectValidationError(message: string | RegExp) {
    await expect(this.errorMessage).toBeVisible();
    await expect(this.errorMessage).toContainText(message);
  }
}
