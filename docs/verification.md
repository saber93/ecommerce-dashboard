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

`pnpm test`: 34 passing tests. `pnpm build`: passed. Edge entry point: Deno check passed.

- Initial commerce migration executes on PGlite, with synthetic Supabase roles/Auth table.
- Storage migration executes against a local stub of the managed buckets table; this checks SQL and preservation behavior, not the hosted Storage service.
- SQL/payment tests cover unauthorized access, totals, inventory reservations/rollback, duplicate requests, forged webhooks, ambiguous creation, failure/cancellation, late completion and recovery.
- Edge entry point passes Deno check.
- Admin static build succeeds with sign-in intentionally disabled when no public key is configured.
- Browser: existing storefront renders; bag add and checkout navigation work; checkout summary shows the selected product; demo checkout and unconfigured admin sign-in are disabled; no console errors observed on those pages.

## Verified on the existing cloud project (2026-09-24)

- Reconfirmed `ffukncssuqmwlowdrbau`, AWS `ap-northeast-2`, no conflicting commerce objects before migration.
- Applied commerce migration `20260924063653` and media migration `20260924064030`; deployed Edge Function `commerce` version 3, ACTIVE.
- Applied six development product fixtures. Verified six products, zero orders, one requested owner membership; all commerce tables have RLS and anon has no commerce schema usage.
- Created the requested unconfirmed Auth identity without a password or outbound email; explicit owner allowlist saved.
- Hosted GET catalog returned HTTP 200, six products, and checkout disabled because Ziina is absent.
- Localhost CORS returned the exact allowed origin. An untrusted origin returned 403; unauthenticated Admin returned 401; unconfigured checkout/webhook returned 503.
- The exact Vercel storefront origin passed hosted CORS preflight. Vercel reports deployment `a9d39eb` Ready at `https://shopping-three-kappa.vercel.app`; browser verification loaded the Supabase catalog, all rendered handbag images, and the `noindex` preview meta tag.
- Browser checkout loaded the real cloud catalog and displayed the selected AED 165 product with the payment button disabled and configuration-pending message. No console errors observed. Admin sign-in/password setup UI renders with the real public project key.
- One cold catalog request from the local development host took approximately 2.6 seconds. This is not a UAE benchmark or an isolated Edge-to-database measurement.

## Not externally verified

No reconciliation scheduler or Admin Vercel publication has been applied. Auth configuration reads and Edge secret writes returned missing-scope errors even after database/function/key access was restored. The deployed entry point therefore has explicit nonsecret allowed origins for local development and the storefront preview.

Ziina credentials/account/webhook are not configured. There has been no real Ziina API roundtrip or test payment. Source-IP header behavior on Supabase ingress is unresolved, so webhook acceptance defaults to disabled. Owner email confirmation/password setup/login and authenticated managed Storage upload are not verified. No UAE latency measurement has been made.

PGlite uses one local connection; its competing-checkout test proves transactional rejection under serialized execution. It does not establish behavior under independent hosted sessions, network interruptions or production load. Those remain acceptance gates.

## Handbag visual refresh (2026-09-24)

Eight generated local images now cover the hero, editorial, and six product styles. The development fixture names, category labels and image URLs were updated in the local storefront and guarded remote fixture refresh; no prices, stock, order data or production shipping/tax settings were changed. Hosted catalog response and local image loading were rechecked. The originals were moved to `/Users/me/Downloads/ecommerce-original-photos-20260924`; the storefront references only the new handbag images.
