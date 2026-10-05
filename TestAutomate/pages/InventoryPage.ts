import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage';

export class InventoryPage extends BasePage {
  readonly inventoryList: Locator;
  readonly cartBadge: Locator;
  readonly cartLink: Locator;
  readonly sortDropdown: Locator;
  readonly inventoryItems: Locator;
  readonly inventoryPrices: Locator;

  constructor(page: Page) {
    super(page);
    this.inventoryList = page.getByTestId('inventory-list');
    this.cartBadge = page.getByTestId('shopping-cart-badge');
    this.cartLink = page.getByTestId('shopping-cart-link');
    this.sortDropdown = page.getByTestId('product-sort-container');
    this.inventoryItems = page.getByTestId('inventory-item');
    this.inventoryPrices = page.getByTestId('inventory-item-price');
  }

  async expectLoaded() {
    await this.expectVisible(this.inventoryList);
    await this.expectUrlContains('/inventory.html');
  }

  /** Locates the "Add to cart" button for a given product name */
  private addToCartButton(productName: string): Locator {
    return this.page
      .getByTestId('inventory-item')
      .filter({ hasText: productName })
      .getByRole('button', { name: /add to cart/i });
  }

  /**
   * Locates the "Remove" button for a given product name (visible once it's already in the cart).
   * Public so specs use it instead of a bare getByRole('button') inside an inventory item, which
   * also matches the product image and title (SauceDemo renders both with role=button).
   */
  removeFromCartButton(productName: string): Locator {
    return this.page
      .getByTestId('inventory-item')
      .filter({ hasText: productName })
      .getByRole('button', { name: /remove/i });
  }

  /** Locates the product image for a given product name */
  productImage(productName: string): Locator {
    return this.page
      .getByTestId('inventory-item')
      .filter({ hasText: productName })
      .locator('img');
  }

  async addProductToCart(productName: string) {
    await this.addToCartButton(productName).click();
  }

  /** Adds multiple products in one call — reusable for multi-item checkout scenarios */
  async addProductsToCart(productNames: string[]) {
    for (const name of productNames) {
      await this.addProductToCart(name);
    }
  }

  async expectCartBadgeCount(count: number) {
    await expect(this.cartBadge).toHaveText(String(count));
  }

  /** Asserts the cart badge is not rendered at all (empty-cart state) */
  async expectCartEmpty() {
    await expect(this.cartBadge).toHaveCount(0);
  }

  /**
   * Confirms a product's control has toggled to "Remove", i.e. it is already in the
   * cart and can't be re-added as a duplicate line item via the "Add to cart" button.
   */
  async expectProductInCart(productName: string) {
    await expect(this.removeFromCartButton(productName)).toBeVisible();
    await expect(this.addToCartButton(productName)).toHaveCount(0);
  }

  async goToCart() {
    await this.cartLink.click();
  }

  /** Selects the "Price (low to high)" sort option */
  async sortByPriceLowToHigh() {
    await this.sortDropdown.selectOption('lohi');
  }

  /** Reads all currently displayed product prices, in DOM order, as numbers */
  async getDisplayedPrices(): Promise<number[]> {
    const texts = await this.inventoryPrices.allTextContents();
    return texts.map((t) => parseFloat(t.replace('$', '')));
  }

  /** Reads the displayed price for a single named product on the inventory page */
  async getProductPrice(productName: string): Promise<number> {
    const text = await this.inventoryItems
      .filter({ hasText: productName })
      .getByTestId('inventory-item-price')
      .textContent();
    return text ? parseFloat(text.replace('$', '')) : NaN;
  }

  /**
   * Adds whichever product is currently rendered first to the cart, without needing
   * to know its name up front. Used after re-sorting (e.g. by price) when the identity
   * of the "first" item varies and no dedicated name-lookup helper exists — reads
   * directly off the inventoryItems locator per the documented requirement gap.
   */
  async addFirstDisplayedProductToCart() {
    await this.inventoryItems.first().getByRole('button', { name: /add to cart/i }).click();
  }

  /**
   * Fires two rapid, unawaited clicks on a product's "Add to cart" button to exercise
   * the race-condition path (rapid double-click) rather than the single-click helper.
   */
  async rapidDoubleClickAddToCart(productName: string) {
    const button = this.addToCartButton(productName);
    await Promise.all([button.click(), button.click()]);
  }
}
