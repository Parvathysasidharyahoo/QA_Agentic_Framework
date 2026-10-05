import { Page, Locator, expect } from '@playwright/test';

/**
 * BasePage holds generic, reusable helpers that every page object can inherit.
 * Keeps individual page classes focused only on page-specific locators/actions.
 */
export class BasePage {
  constructor(protected readonly page: Page) {}

  async goto(path: string = '/') {
    await this.page.goto(path);
  }

  async getTitle(): Promise<string> {
    return this.page.title();
  }

  /** Generic helper: assert an element is visible with a readable failure message */
  async expectVisible(locator: Locator, message?: string) {
    await expect(locator, message).toBeVisible();
  }

  /** Generic helper: assert exact text content */
  async expectText(locator: Locator, text: string | RegExp) {
    await expect(locator).toHaveText(text);
  }

  async expectUrlContains(fragment: string) {
    await expect(this.page).toHaveURL(new RegExp(fragment));
  }

  /**
   * Baseline helper for scenarios where the exact expected post-action state is
   * ambiguous/undefined by the requirement (e.g. refresh mid-checkout, empty-cart
   * checkout). Asserts the current URL matches at least one of the known-valid
   * outcomes so the test still ends in a concrete, deterministic assertion instead
   * of silently observing behavior with nothing to fail on.
   */
  async expectUrlMatchesOneOf(fragments: (string | RegExp)[]) {
    const url = this.page.url();
    const matches = fragments.some((f) => (f instanceof RegExp ? f.test(url) : url.includes(f)));
    expect(
      matches,
      `Expected URL "${url}" to match one of: ${fragments.map(String).join(', ')}`
    ).toBeTruthy();
  }

  /** Logs the current user out via the app's hamburger menu — available on any logged-in page. */
  async logout() {
    await this.page.getByTestId('react-burger-menu-btn').click();
    await this.page.getByTestId('logout-sidebar-link').click();
  }
}
