# Deploy to the existing Supabase project and Vercel

Status: Nine Supabase migrations, development fixtures, seven confirmed delivery areas, Storage bucket and Edge Function version 10 deployed. Cash on delivery is implemented but disabled while product photos and business details are incomplete. The storefront and separate Admin are published as development previews on Vercel. Owner email confirmation, password setup and private Admin membership are verified; browser sign-in and authenticated Admin operations remain pending. Do not create another project or run Medusa migrations. Do not reset the database.

## 1. Deployment access

Reauthenticated the existing `supabase-ecommerce` connection for database/function writes and project API-key reads. Used the official Management API to migrate and deploy. The native MCP process may retain the old grant until restarted. Auth configuration reads and Edge secret writes still returned scope-denied responses; configure those settings through the Supabase Dashboard or a separately authorized CLI connection. MCP OAuth is separate from a PostgreSQL connection password.

The exact target is `ffukncssuqmwlowdrbau` in `ap-northeast-2`. Re-inspect `public`, `commerce`, migrations, functions and `storage.buckets` immediately before applying changes. If `commerce`, the RPC names or `product-images` already exist unexpectedly, stop and review their state. The initial migration deliberately has no drops/resets or blanket changes to other schemas.

## 2. Migrations

Already applied, with local filenames aligned to the migration versions returned by Supabase. Future deployments use migration history and must not replay them:

1. `supabase/migrations/20260924063653_commerce.sql`
2. `supabase/migrations/20260924064030_product_images.sql`
3. `supabase/migrations/20260925024641_arabic_catalog.sql`
4. `supabase/migrations/20260925032547_cash_on_delivery.sql`
5. `supabase/migrations/20260925035808_editorial_catalog.sql`
6. `supabase/migrations/20260925042206_fit_visuals.sql`
7. `supabase/migrations/20260925044108_buy_two_free_delivery.sql`
8. `supabase/migrations/20260925045044_inventory_visibility.sql`

CLI workflow from this repository, after authenticating:

```sh
supabase link --project-ref ffukncssuqmwlowdrbau
supabase db push --dry-run
supabase db push
```

Inspect the dry-run target before push. Never put passwords in shell arguments or tracked files. Do not expose the `commerce` schema in the Data API. The public catalog RPC is intentionally readable; all other commerce RPCs are explicitly executable only by `service_role`. Tables use RLS and deny browser access.

Explicitly applied `supabase/fixtures/development.sql` to the inspected development project. Six products now exist and there are zero orders. The owner later confirmed the bag prices and 20 units of stock per bag, while the generated images remain placeholders. This fixture does not run as part of `db push`. The separate `supabase/fixtures/confirmed_delivery_areas.sql` inserted seven AED 15, next-day UAE emirate rows without changing existing product or order data.

The Supabase Table Editor defaults to `public`, which has no application tables here. Select the private `commerce` schema in its schema selector to view `admins`, `audit_log`, `order_items`, `orders`, `payment_events`, `products`, `rate_limits`, and `settings`. The hosted project was queried again on 2026-09-25: all eight tables exist, with six products, one Admin membership and no orders. Keep `commerce` out of the exposed Data API schemas; use the controlled Edge API for storefront and Admin writes.

## 3. Admin identity and images

Created `saber.elshafey@gmail.com` through Supabase Auth with no password and without bypassing email confirmation, then allowlisted only its returned UUID in `commerce.admins`. No invitation/reset email has been sent. No browser-accessible admin enrollment exists.

To finish owner access:

1. In Supabase **Authentication → URL Configuration**, add `https://ecommerce-dashboard-omega-khaki.vercel.app` to Redirect URLs for the hosted Admin. The owner reported adding this URL on 2026-09-25; the exact dashboard value could not be independently read with the current OAuth grant. Keep `http://localhost:9001` if local setup is needed, and preserve any existing URLs.
2. Open the [hosted Admin](https://ecommerce-dashboard-omega-khaki.vercel.app), enter the owner email, and click **Set or reset password**. This user-initiated action sends the Auth recovery email.
3. The owner reported completing the email link and password setup on 2026-09-25. A read-only query then confirmed exactly one matching Auth user, confirmed email, a nonempty password hash and exactly one matching `commerce.admins` membership. The callback code removes its token fragment from browser history before displaying the password form. The callback destination itself was not observed independently.
4. Verify browser sign-in and authenticated Admin operations using the owner's session. No password should be shared with the developer.

The media migration creates the `product-images` bucket with a 5 MB limit and PNG/JPEG/WebP MIME types. Product images are public; uploads require the Edge endpoint to validate a Supabase Auth user and the private Admin allowlist. The code validates MIME signatures, uses random file names and disables overwrites. Bucket creation and limits are verified; actual authenticated managed Storage upload remains to be tested.

## 4. Edge Function and secrets

Copy `supabase/.env.template` to an ignored file such as `supabase/.env.local` and populate secrets securely. Supabase provides its URL/service-role environment values to hosted functions; do not attempt to set reserved platform variables with the CLI. Supply the remaining application secrets through the Dashboard/CLI. Never put service keys or Ziina tokens in storefront/admin JavaScript.

The deployed entry point allows `http://localhost:8000`, `http://localhost:9001`, and the exact Vercel origins `https://shopping-three-kappa.vercel.app` and `https://ecommerce-dashboard-omega-khaki.vercel.app`; it defaults to storefront URL `http://localhost:8000` and test mode. Platform environment values override them. Secret-write scope is unavailable; no payment or reconciliation secrets have been set. Before enabling Ziina test payments on Vercel, configure `STOREFRONT_URL` for the HTTPS storefront origin.

- `ALLOWED_ORIGINS`: exact storefront/admin HTTPS origins, comma-separated, no trailing slash.
- `STOREFRONT_URL`: storefront HTTPS origin. Redirect URLs are generated server-side from it.
- `ZIINA_TEST_MODE=true`: any other value rejects payment creation.
- `ZIINA_API_TOKEN`: account token with required payment permissions.
- `ZIINA_ACCOUNT_ID`: expected merchant account from Ziina, verified against every fetched intent.
- `ZIINA_WEBHOOK_SECRET`: strong random signing secret shared with webhook registration.
- `ZIINA_TRUSTED_IP_HEADER`: leave unset until the deployed ingress header's overwrite behavior is verified. Do not guess `x-forwarded-for` or trust arbitrary forwarding chains.
- `RECONCILE_SECRET`: strong random token, available only to the scheduled caller.

Deploy only to the retained project:

```sh
supabase functions deploy commerce --project-ref ffukncssuqmwlowdrbau --no-verify-jwt
```

`verify_jwt=false` permits Ziina to reach the webhook. The handler independently authenticates Admin calls, checks order capability tokens, verifies webhook HMAC/source IP and protects the reconciliation endpoint. It is not permission for unauthenticated writes.

Routes under `/functions/v1/commerce`:

| Method/path | Access and behavior |
| --- | --- |
| GET `/catalog` | Public sanitized catalog |
| POST `/checkout` | Validated guest checkout, rate limits, atomic inventory reservation, one Ziina creation attempt |
| POST `/status` | Order UUID + secret capability token, server-side provider refresh |
| POST `/webhook` | Raw-body HMAC-SHA256 plus verified ingress source IP |
| POST `/reconcile` | Scheduler bearer secret; bounded durable inbox/order processing |
| POST `/admin` | Supabase Auth token + private Admin membership |
| POST `/image` | Same Admin checks, binary PNG/JPEG/WebP up to 5 MB |

## 5. Ziina and background recovery

Configure the Ziina account's webhook to `/functions/v1/commerce/webhook` with the signing secret. Registration replaces the account's prior endpoint; the user previously reported no endpoint configured, but inspect before registering. Verify the hosting proxy's source-IP header cannot be supplied/spoofed by the caller, then set `ZIINA_TRUSTED_IP_HEADER`. If this cannot be established on the deployed ingress, keep webhook acceptance disabled and design a trusted ingress; do not remove validation silently.

Ziina's current published addresses are in `ziina.mjs`; recheck them at deployment. HMAC uses the exact raw body. The event payload supplies an intent ID, and the server fetches current provider state before deciding anything. Success redirects never mark paid.

The provider's create schema does not document an idempotency request parameter despite its response mentioning `operation_id`. We therefore do not invent one. A database claim allows one create POST per checkout. An ambiguous response stays pending; a signed webhook or Admin reconciliation can recover the intent through the server-generated order reference after verifying account, amount and currency. Never retry a create POST automatically.

Configure Supabase Cron with `pg_net` to call `/reconcile` on a reviewed schedule (e.g. every minute), retrieving its bearer secret from Vault. Keep the secret out of cron command text/logs. No cron job has been installed. The worker handles at most 10 provider reads per invocation. Failed inbox items back off and stop automatic retries after 10 attempts; inspect `commerce.payment_events` to resolve/requeue them. Unknown/foreign events must not be treated as payments for another order.

Never-submitted expired reservations are released. A possibly submitted payment keeps its reservation until Ziina confirms a terminal state or an operator investigates; no timer blindly releases stock while payment may still complete. Late completion after an already released reservation enters review and does not trigger fulfillment.

## 6. Vercel deployments

**Storefront:** `/Users/me/Downloads/ecommerce` is pushed to `saber93/shopping` `main` and deployed through the existing Vercel `evali1/shopping` project at `https://shopping-three-kappa.vercel.app`. The static site loads the hosted Supabase catalog; Edge CORS allows this origin. Cash on delivery and Ziina checkout are both disabled by the server until their respective readiness gates are met. The catalog still carries fixture flags and generated preview images, and pages request `noindex` while business details remain unconfirmed.

**Admin:** the user published the `evali1/ecommerce-dashboard` project at `https://ecommerce-dashboard-omega-khaki.vercel.app`, connected to `saber93/ecommerce-dashboard` `main`. `vercel.json` builds with `pnpm run build` and publishes `dist/`. The existing public key is included in `admin/public-config.json`; `PUBLIC_SUPABASE_KEY` can override it, and the build rejects secret keys. Only static assets and public configuration are deployed to the Admin. The exact Admin origin passed hosted Edge CORS preflight. The owner reports adding the exact Admin origin to Supabase Auth Redirect URLs; the live Admin recovery request uses that URL. Owner confirmation, password and membership are verified. The dashboard has Overview, Products, Orders, Payments and Settings views with data from the Admin API. Browser sign-in and authenticated Admin operations remain to be tested by the owner.

No separate Node server, Redis service or DigitalOcean resource is required by this implementation. Existing Vercel/Supabase usage charges still apply.

## 7. Hosted acceptance

Verify authentication and cross-account denial, catalog changes, Storage limits, cart totals, inventory with independent concurrent PostgreSQL sessions, test Ziina success/failure/cancellation/pending, duplicate/out-of-order delivery, restarts/timeouts, reconciliation scheduling, and order fulfillment. Measure Edge-to-database and UAE checkout timings. Do not enable live mode as a workaround for missing test credentials.

References: [Supabase CLI](https://supabase.com/docs/reference/cli/introduction), [Edge Functions](https://supabase.com/docs/guides/functions), [Cron](https://supabase.com/docs/guides/cron), [Ziina Payment Intents](https://docs.ziina.com/api-reference/payment-intent/index), [Ziina webhooks](https://docs.ziina.com/api-reference/webhook).

## Arabic storefront content (2026-09-25)

Applied additive Arabic product fields and order-item name snapshots, then explicitly applied the guarded `supabase/fixtures/arabic.sql` translations for six existing demo handbags. English catalog details, prices, stock and visibility have the same digest before and after migration; order count remains zero. Edge Function version 5 validates optional Arabic fields and preserves translations submitted by older Admin clients. The product editor now includes Arabic name, description and badge fields. The storefront builds English and Arabic HTML from shared templates and locale dictionaries in the storefront repository. No shipping, tax, payment or access-control settings changed.

## Cash on delivery preparation (2026-09-25)

Applied migration `20260925032547` and confirmed delivery areas after checking the existing project and testing the migration on disposable PGlite. Edge Function version 6 serves the gated COD quote and order endpoints. The database calculates product, AED 15 delivery and tax totals; an order requires the displayed total to match. Stock changes, duplicate requests, collection and cancellation are transactional and audited. Hosted checks found six products, seven areas, zero orders, `fixture_mode=true` and `cod_enabled=false`. The public quote endpoint rejected with `COD_NOT_CONFIGURED`. See [launch readiness](launch-readiness.md) before opening orders.

## 7. Editorial catalog and marketing preview

Migration `20260925035808` adds curated collections, product galleries, dimensions, fit/styling copy, pairs, limited-edition size and verified-photo flags. It assigns the six existing illustrative products to preview collections, removes unsupported fixture badges, and preserves IDs, prices, stock and orders. Edge Function version 7 validates the new fields. The Admin can upload a main image and up to eight additional photos; its Marketing view links to the bilingual storefront concept preview. Hosted readback confirmed six products, six illustrative photo flags, six curated assignments, zero unsupported fixture badges, `fixture_mode=true` and `cod_enabled=false`. The AED 15 checkout delivery rule was not changed.

## 8. What fits inside visuals

Migration `20260925042206` adds a replaceable fit visual URL and verification flag. It maps the six existing fixture IDs to generated storefront assets without changing product prices, stock, orders or checkout settings. The public catalog includes both fields. Edge Function version 9 validates authenticated product edits, and the Admin provides a separate fit visual upload and verification control. A verified claim requires a real product photo, an uploaded fit visual, measured dimensions, and English and Arabic contents copy. The generated visuals are unverified size concepts. Replace them and physically test actual bag capacity before promoting any claim to verified. Hosted readback confirmed six fit paths, zero verified claims, zero orders, `fixture_mode=true`, and `cod_enabled=false`.

## 9. Buy two bags, free delivery

Migration `20260925044108` enables the owner-requested offer in `commerce.settings` and snapshots `BUY_2_FREE_DELIVERY` on qualifying orders. Any two bag units in one order count, including two of the same style. The seven active UAE delivery areas retain their AED 15 baseline. COD quote and checkout compute the same discount server-side, and the test-mode online checkout uses the same rule when it has a nonzero delivery fee. The Admin Settings view can pause or resume the offer through an authenticated, audited action. Existing orders keep their original totals when the switch changes. The live catalog reports the offer as configured; `fixture_mode=true` and `cod_enabled=false` still block customer COD orders. Returns and partial-return treatment require the store policy and staff process before orders open. Edge Function version 10 is active; readback found six products and zero orders.

## 10. Inventory visibility and last piece

Migration `20260925045044` makes the public catalog omit active products when `stock_quantity - reserved_quantity <= 0`; it leaves those records editable in Admin. Migration `20260925052521` marks any active product with exactly one available unit as `last_piece`, independently of its photo verification flag. The Admin product editor stores integer stock on hand and explains reservations, automatic sold-out hiding, and last-piece eligibility. Products and Marketing views show last pieces and sold-out products separately. COD placement reduces stock, COD cancellation restores it, and pending online payments reserve units until resolved. The storefront refreshes the catalog every minute while visible and on return to the tab. The owner set four bags to one unit each; two remain at 20. All six images remain illustrative and labeled, and customer checkout is still gated. This migration changes no stock or orders.
