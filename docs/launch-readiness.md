# Customer launch readiness

The storefront and Admin are deployed. Cash-on-delivery code and seven AED 15 delivery areas are installed in the existing Supabase project. **Customer orders are still closed:** `fixture_mode=true`, `cod_enabled=false`; the current product images are illustrations awaiting replacement. Ziina is not required for the cash-on-delivery launch.

## Confirmed by the owner

- Six existing bags, their displayed AED prices, and 20 units of stock each are intended for sale.
- Cash on delivery in all seven UAE emirates, AED 15 shipping per order, next-day delivery target.
- Support phone: `+971 50 507 1932`.

## Required before opening orders

1. Replace all six generated product images with accurate photos of the exact bags sold. Inspect the Admin upload result and hosted catalog.
2. Provide registered business name, licence details, business address, VAT registration status and confirmed tax treatment. Do not use the zero tax development fixture as a tax decision. UAE VAT registration thresholds are set by the [Federal Tax Authority](https://tax.gov.ae/en/content/registration.for.vat.aspx).
3. Approve Arabic and English delivery, cancellation, return/refund and privacy terms, with a usable support contact. UAE consumer guidance calls for accurate product information, Arabic information and a dated invoice; review the [UAE consumer protection guidance](https://u.ae/en/information-and-services/justice-safety-and-the-law/consumer-protection) and [eCommerce guidance](https://u.ae/en/information-and-services/business/ecommerce/) with the business's adviser.
4. Add an order confirmation/digital invoice delivery method and a staff process for reviewing new cash orders, shipment, collection, cancellation and returns. Verify the next-day promise with the chosen courier across every active emirate.
5. Test the owner's real Admin login, product image upload and order operations using their own browser session. Recheck stock totals under concurrent orders and add anti-abuse controls appropriate to unpaid cash orders.
6. Once these items are verified, switch the existing products from fixture to production, configure confirmed tax/policies, set `fixture_mode=false` and enable COD in a reviewed transaction. Do not enable the switch merely to bypass the missing business details. Repeat the full live-browser journey on English/Arabic and mobile, with an authorized small internal cash order, before public launch.
7. Keep the storefront `noindex` until real photos, legal pages, canonical domain and product content are ready. Then generate a sitemap and enable indexing; leave checkout and Admin `noindex`. Google explains that [`noindex` removes pages from Search](https://developers.google.com/search/docs/crawling-indexing/block-indexing) and recommends crawlable product links and a sitemap for commerce sites in its [ecommerce navigation guide](https://developers.google.com/search/docs/specialty/ecommerce/help-google-understand-your-ecommerce-site-structure).

## Verification to date

The additive COD migration was tested on PGlite before being applied to `ffukncssuqmwlowdrbau`. The hosted project has six products, zero orders, seven active AED 15 next-day delivery areas, `fixture_mode=true`, and `cod_enabled=false`. The Edge `commerce` function is version 6. A hosted `cod-quote` request was rejected with `COD_NOT_CONFIGURED`; no customer order was created. Local tests cover quotes, expected-total checks, duplicate requests, stock, Admin cancellation and cash collection. These tests do not verify a real courier, customer receipt, or actual owner Admin session.
