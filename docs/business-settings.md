# Business settings

## Confirmed

- Preserve the existing storefront and rounded design.
- Custom Supabase backend, custom admin on Vercel; no Medusa runtime.
- Retain `ffukncssuqmwlowdrbau` in AWS Seoul, `ap-northeast-2`.
- AED is the demonstration currency.
- First administrator email supplied by the owner: `saber.elshafey@gmail.com`.
- Ziina integration begins in test mode; live charging is excluded.
- Customers are intended to be in the UAE; this does not establish delivery coverage or rates.
- The owner selected cash on delivery as the first customer order method, separate from Ziina.
- The owner confirmed all seven UAE emirates, a flat AED 15 delivery fee, and next-day delivery as the intended service level.
- The owner confirmed the current six bags, displayed AED prices, and 20 units of stock per bag as the intended sellable catalog values.
- Customer support phone: `+971 50 507 1932`.

## Explicit development fixtures

`supabase/fixtures/development.sql` is opt-in and is never run automatically by migration or deployment. It refuses to run when orders already exist. Explicitly applied to this development project on 2026-09-24.

- Six generated handbag images, names and descriptions mirror the revised storefront preview. The owner says these images need replacement with real product photos before orders open.
- The existing development fixture still holds the now owner-confirmed prices and 20 units of stock per bag. The fixture flags remain on until photos and launch details are complete.
- The original fixture shipping is zero solely for Ziina tests. Seven separately recorded delivery areas hold the confirmed AED 15 cash-on-delivery fee and next-day target.
- Tax: zero solely for tests; this is not a tax conclusion.
- Country: AE solely to exercise the checkout form.
- No free-shipping threshold is configured.
- Each product is one SKU. The previous decorative makeup shades were removed.

`commerce.settings` started with checkout disabled and shipping/tax unset. Fixtures explicitly enabled Ziina test checkout. The new `cod_enabled` flag is false in the hosted project, and `fixture_mode` remains true, so no cash-on-delivery order can be placed. The confirmed delivery areas alone do not open orders. Ziina remains test-only.

The previously observed “complimentary shipping over AED 250” demo banner remains unconfirmed and is no longer displayed. It is not used to calculate shipping.

## Production decisions still needed

Real photos that accurately depict each sold bag; registered business name/licence details and business address; VAT registration status and applicable tax treatment; return/refund terms; privacy notice; customer order confirmation/digital invoice delivery; operational proof of next-day delivery; fraud/abuse controls for unpaid cash orders. The prior observed free-shipping threshold remains unconfirmed and is not active. These items must be resolved before the production flags are switched.
