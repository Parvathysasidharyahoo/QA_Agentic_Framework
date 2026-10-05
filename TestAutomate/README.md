# SauceDemo Checkout Journey — Playwright Automation (POM)

Automated tests for the [SauceDemo](https://www.saucedemo.com) checkout flow: **Login → Add to Cart → Checkout → Order Confirmation**, built using the Page Object Model.

## Project Structure

```
saucedemo-playwright/
├── pages/
│   ├── BasePage.ts              # Shared reusable helpers (navigation, generic assertions)
│   ├── LoginPage.ts
│   ├── InventoryPage.ts
│   ├── CartPage.ts
│   ├── CheckoutStepOnePage.ts   # Shipping info form
│   ├── CheckoutStepTwoPage.ts   # Order overview + price calculations
│   └── CheckoutCompletePage.ts
├── tests/
│   └── checkout.spec.ts
├── playwright.config.ts
└── package.json
```

## Design Decisions

- **Page Object Model:** Every SauceDemo page/step is its own class extending `BasePage`. Tests only call high-level methods (`submitShippingInfo`, `addProductsToCart`) — no raw locators in specs.
- **`data-test` locators:** Uses `getByTestId()` throughout since SauceDemo exposes stable `data-test` attributes — more resilient than CSS/text selectors.
- **Reusable methods:** e.g. `addProductsToCart([...])` loops over an array so multi-item tests don't duplicate calls; `submitShippingInfo()` composes fill + continue for the happy path while `fillShippingInfo()` / `continueToOverview()` remain available separately for negative tests.
- **Business-rule assertions:** `CheckoutStepTwoPage.expectTotalIsCorrect()` parses the displayed subtotal/tax/total and asserts `total === subtotal + tax`, not just that text is visible — catches real pricing bugs, not just rendering bugs.
- **Independent negative tests:** The locked-out-user test lives in its own `describe` block outside the shared `beforeEach` so it isn't coupled to a successful standard-user login.

## Setup

```bash
npm install
npx playwright install
```

## Run

```bash
npm test                 # headless, all browsers defined in playwright.config.ts
npm run test:headed      # headed mode
npx playwright test --grep @smoke   # run only P0 smoke tests
npm run test:report      # open HTML report after a run
```

## Test Coverage in `checkout.spec.ts`

| Test | Priority | Type |
|------|----------|------|
| Completes checkout successfully with a single item | P0 | Positive (smoke) |
| Completes checkout successfully with multiple items | P0 | Positive |
| Blocks checkout when shipping info is missing | P1 | Negative |
| Removing an item updates checkout total correctly | P1 | Positive/regression |
| Locked out user cannot log in or reach checkout | P2 | Negative |

## Extending This Suite

- Add a `fixtures.ts` with a custom `test.extend()` to inject already-instantiated page objects (removes the repetitive `beforeEach` wiring as the suite grows).
- Add `problem_user` / `performance_glitch_user` scenarios to `LoginPage` tests to cover SauceDemo's other seeded accounts.
- Wire `storageState` (via a `global.setup.ts` project) once login stops being part of what's under test, to speed up cart/checkout-only runs.
