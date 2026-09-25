# Business settings

## Confirmed

- Preserve the existing storefront and rounded design.
- Custom Supabase backend, custom admin on Vercel; no Medusa runtime.
- Retain `ffukncssuqmwlowdrbau` in AWS Seoul, `ap-northeast-2`.
- AED is the demonstration currency.
- First administrator email supplied by the owner: `saber.elshafey@gmail.com`.
- Ziina integration begins in test mode; live charging is excluded.
- Customers are intended to be in the UAE; this does not establish delivery coverage or rates.

## Explicit development fixtures

`supabase/fixtures/development.sql` is opt-in and is never run automatically by migration or deployment. It refuses to run when orders already exist. Explicitly applied to this development project on 2026-09-24.

- Six generated handbag images, names and descriptions mirror the revised storefront preview. Prices remain unchanged development placeholders.
- Stock: 20 units per product solely for tests.
- Shipping: zero solely for tests.
- Tax: zero solely for tests; this is not a tax conclusion.
- Country: AE solely to exercise the checkout form.
- No free-shipping threshold is configured.
- Each product is one SKU. The previous decorative makeup shades were removed.

`commerce.settings` starts with checkout disabled and shipping/tax unset. Fixtures explicitly enable test checkout. Both the database and provider code block production/live mode.

The previously observed “complimentary shipping over AED 250” demo banner remains unconfirmed and is no longer displayed. It is not used to calculate shipping.

## Production decisions still needed

Actual products and SKUs, shade variants, prices, inventory, serviceable addresses, shipping rates, threshold applicability, tax registration/treatment, refund/return policy, customer support details and transactional email. Confirmed settings must be recorded here before a separate reviewed production implementation removes the test-only gates.
