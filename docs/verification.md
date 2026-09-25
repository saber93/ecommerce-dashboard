# Verification status

## Implemented locally

- Private commerce schema and scoped RPC permissions; public sanitized catalog.
- Server-owned integer-fils totals and transactional inventory reservations.
- Request idempotency, one provider creation claim, payment replay protection.
- Ziina test-only client, raw HMAC verification, merchant/amount/currency/intent/status checks.
- Persistent webhook inbox, scheduled-reconciliation endpoint, retry backoff, interrupted-creation recovery.
- Safe failed/canceled handling and review for late payment after reservation release.
- Admin Auth verification and explicit membership, catalog/stock editing, fulfillment, payment recovery, media upload endpoint.
- Storefront catalog adapter, existing bag integration, checkout/recovery UI; design preserved.
- Static Admin build configuration for separate Vercel deployment.

## Verified locally

`pnpm test`: 38 passing tests. `pnpm build`: passed. Edge entry point: Deno check passed.

- Initial commerce migration executes on PGlite, with synthetic Supabase roles/Auth table.
- Storage migration executes against a local stub of the managed buckets table; this checks SQL and preservation behavior, not the hosted Storage service.
- SQL/payment tests cover unauthorized access, totals, inventory reservations/rollback, duplicate requests, forged webhooks, ambiguous creation, failure/cancellation, late completion and recovery.
- Edge entry point passes Deno check.
- Admin static build succeeds with sign-in intentionally disabled when no public key is configured.
- Browser: existing storefront renders; bag add and checkout navigation work; checkout summary shows the selected product; demo checkout and unconfigured admin sign-in are disabled; no console errors observed on those pages.

## Verified on the existing cloud project (2026-09-24)

- Reconfirmed `ffukncssuqmwlowdrbau`, AWS `ap-northeast-2`, no conflicting commerce objects before migration.
- Applied commerce migration `20260924063653` and media migration `20260924064030`; deployed Edge Function `commerce` version 4, ACTIVE.
- Applied six development product fixtures. Verified six products, zero orders, one requested owner membership; all commerce tables have RLS and anon has no commerce schema usage.
- Created the requested unconfirmed Auth identity without a password or outbound email; explicit owner allowlist saved.
- Hosted GET catalog returned HTTP 200, six products, and checkout disabled because Ziina is absent.
- Localhost CORS returned the exact allowed origin. An untrusted origin returned 403; unauthenticated Admin returned 401; unconfigured checkout/webhook returned 503.
- The exact Vercel storefront origin passed hosted CORS preflight. Vercel reports the storefront Ready at `https://shopping-three-kappa.vercel.app`; browser verification loaded the Supabase catalog, all rendered handbag images, and the `noindex` preview meta tag.
- The user's separate `evali1/ecommerce-dashboard` Vercel project is Ready at `https://ecommerce-dashboard-omega-khaki.vercel.app`, connected to `saber93/ecommerce-dashboard` `main`. HTTP checks found the Admin login page, public project configuration, and no secret-key pattern. Its exact origin now passes hosted Edge CORS preflight; an unrelated origin still returns 403. Authenticated Admin operations remain unverified.
- Browser checkout loaded the real cloud catalog and displayed the selected AED 165 product with the payment button disabled and configuration-pending message. No console errors observed. Admin sign-in/password setup UI renders with the real public project key.
- One cold catalog request from the local development host took approximately 2.6 seconds. This is not a UAE benchmark or an isolated Edge-to-database measurement.

## Owner access update (2026-09-25)

- The owner reported adding `https://ecommerce-dashboard-omega-khaki.vercel.app` to Auth Redirect URLs and completing the password email flow. The exact Auth configuration is not independently readable with the current OAuth grant.
- The live Admin JavaScript was verified to request that exact origin for recovery. Its deployment is Ready.
- A read-only database query confirmed one matching `auth.users` row for `saber.elshafey@gmail.com`, a confirmed email, a nonempty password hash, and one matching `commerce.admins` membership. No password or hash was retrieved.
- Authenticated browser sign-in and Admin API operations remain unverified; they require the owner's session.

## Dashboard and database visibility update (2026-09-25)

- Re-inspected the existing project in read-only mode: the `commerce` schema contains eight application tables, six products, one Admin membership, and no orders. The `public` schema has no application tables. The Admin Settings view now links to the Supabase Table Editor and explains the schema selector.
- Rebuilt the Admin as a commerce dashboard with Overview, Products, Orders, Payments and Settings views. Counts and lists come from the existing Admin API; no sample revenue or order figures are fabricated.
- Browser checked desktop and mobile layouts using a simulated authenticated Admin response populated from the public catalog. Search narrowed six products to one, the empty orders state and schema help rendered, and the browser reported no JavaScript errors. Product images loaded from the existing storefront. This checks UI behavior, not a real authenticated session.

## Not externally verified

No reconciliation scheduler has been applied. Auth configuration reads and Edge secret writes returned missing-scope errors even after database/function/key access was restored. The deployed entry point therefore has explicit nonsecret allowed origins for local development, the storefront preview, and the Admin site.

## Cash on delivery preparation (2026-09-25)

- The additive COD migration was run first on disposable PGlite and then applied to the existing project after inspecting migration history and the six-product, zero-order state. The migration adds a disabled COD switch, seven-area table, separate COD payment method and transactional quote/order/Admin actions without changing existing product prices, stock or orders.
- The owner confirmed the existing six bags, prices and stock quantities, all seven UAE emirates, AED 15 shipping and a next-day delivery target. The seven delivery rows were applied separately; the hosted project still has six products, zero orders, `fixture_mode=true` and `cod_enabled=false`.
- Edge Function `commerce` version 6 is active. Its hosted catalog returns seven areas and `cod_enabled=false`; a hosted quote request returns `COD_NOT_CONFIGURED`. No customer order or cash collection has been performed.
- PGlite and mocked Edge tests cover the closed switch, server quote and exact total, idempotency, stock deduction, rejected quote changes, Admin cancellation/restock, amount-checked collection and absence of Ziina calls. A local browser simulation covered English/Arabic quote, COD confirmation and bag clearing. These are not real customer transactions.
- Generated product images still need accurate replacements. Registered business/licence and VAT details, return/privacy terms, order confirmation/invoice delivery, courier validation and real owner Admin operations remain unverified. See [launch readiness](launch-readiness.md).

Ziina credentials/account/webhook are not configured. There has been no real Ziina API roundtrip or test payment. Source-IP header behavior on Supabase ingress is unresolved, so webhook acceptance defaults to disabled. Owner browser login, authenticated Admin operations and managed Storage upload are not verified. No UAE latency measurement has been made.

PGlite uses one local connection; its competing-checkout test proves transactional rejection under serialized execution. It does not establish behavior under independent hosted sessions, network interruptions or production load. Those remain acceptance gates.

## Handbag visual refresh (2026-09-24)

Eight generated local images now cover the hero, editorial, and six product styles. The development fixture names, category labels and image URLs were updated in the local storefront and guarded remote fixture refresh; no prices, stock, order data or production shipping/tax settings were changed. Hosted catalog response and local image loading were rechecked. The originals were moved to `/Users/me/Downloads/ecommerce-original-photos-20260924`; the storefront references only the new handbag images.

## Marketing preview and real-product fields (2026-09-25)

- Additive migration `20260925035808` passed disposable PGlite tests before hosted application. Remote readback found six unchanged prices and stock counts, six curated assignments, zero unsupported fixture badges, and no change to `fixture_mode=true` or `cod_enabled=false`.
- Edge Function version 7 returned the new collection and dynamic last-piece fields through the hosted catalog endpoint. No real product was created and no customer order was placed.
- Local English and Arabic preview pages rendered all five collection cards and six products without page errors. The Arabic mobile collection filter narrowed to three evening products and opened a product gallery. The Admin editor rendered its collection choices and multi-image upload control, but authenticated owner save/upload remains externally unverified.
- Free delivery on two bags, next-day cutoff, gift packaging and restock alerts are clearly marked preview concepts. The AED 15 checkout delivery rule is unchanged.

## Arabic catalog update (2026-09-25)

- Migration `20260925024641` adds Arabic product fields and order-item name snapshots; verified preservation of an existing catalog and pending order in PGlite before applying it.
- Hosted migration and Edge Function version 5 are active. Public catalog returns all six Arabic names and descriptions. Protected catalog digest stayed `9011de7898c49dc8442968b9cbcb6804`; six products and zero orders remain.
- Tests cover optional-field validation, omission preserving existing translations, private table/RPC access and Arabic order snapshots. All 38 backend tests pass.
- Admin browser check loaded and submitted Arabic fields with an intercepted API response, including zero stock. An authenticated hosted save is still unverified.

## Fit visual update (2026-09-25)

- Migration `20260925042206` added fit visual URLs and evidence-gated verification. Six generated illustration paths were assigned only to existing fixture products. Product prices, stock, orders and checkout flags were unchanged.
- Edge Function `commerce` version 9 returns the fit fields. Hosted catalog readback found six fit visuals, zero verified claims, no exposed stock counts, and `cod_enabled=false`.
- Disposable database tests cover a verified fit entry and rejection when its evidence is removed. The storefront’s English and Arabic cards and product dialogs render illustrative captions. Authenticated owner upload and physical fit remain to be verified with real products.

## Two-bag free-delivery offer (2026-09-25)

- Migration `20260925044108` added the quantity-based offer switch and order discount snapshot without touching existing orders, products, stock, or checkout gates. Hosted readback: enabled, six products, zero orders, `fixture_mode=true`, `cod_enabled=false`. Public catalog exposes `min_bags=2`.
- Edge Function `commerce` version 10 is active. PGlite tests cover two of the same bag, two different bags, a one-bag AED 15 fee, tampered totals, disabling the offer, and preservation of a prior order. The storefront and Admin browser checks used live catalog data and mocked Admin authentication respectively. Actual owner Admin toggle and customer checkout remain unverified.

## Last-piece inventory visibility (2026-09-25)

- Migration `20260925045044` filters zero-available products from the public catalog. Migration `20260925052521` marks active products with one available unit as `last_piece` even while their generated photos remain labeled illustrative. Neither migration changes stock counts or existing orders. Hosted readback found four owner-edited products at one unit, two at 20, and zero orders.
- PGlite tests cover one-unit fixture inventory, verified-photo inventory, sold-out removal while Admin retains the record, COD order consumption and cancellation restoration, and pending online reservation/failure restoration. Local browser checks cover Arabic last-piece rendering, one-unit cart limits, and Admin inventory filters. No real sale was made.
