# Deploy to the existing Supabase project and Vercel

Status: Supabase migrations, development fixtures, Storage bucket and Edge Function version 3 deployed on 2026-09-24. The storefront is published as a development preview on the existing Vercel `shopping` project; Admin publication and payment verification remain pending. Do not create another project or run Medusa migrations. Do not reset the database.

## 1. Deployment access

Reauthenticated the existing `supabase-ecommerce` connection for database/function writes and project API-key reads. Used the official Management API to migrate and deploy. The native MCP process may retain the old grant until restarted. Auth configuration reads and Edge secret writes still returned scope-denied responses; configure those settings through the Supabase Dashboard or a separately authorized CLI connection. MCP OAuth is separate from a PostgreSQL connection password.

The exact target is `ffukncssuqmwlowdrbau` in `ap-northeast-2`. Re-inspect `public`, `commerce`, migrations, functions and `storage.buckets` immediately before applying changes. If `commerce`, the RPC names or `product-images` already exist unexpectedly, stop and review their state. The initial migration deliberately has no drops/resets or blanket changes to other schemas.

## 2. Migrations

Already applied, with local filenames aligned to the migration versions returned by Supabase. Future deployments use migration history and must not replay them:

1. `supabase/migrations/20260924063653_commerce.sql`
2. `supabase/migrations/20260924064030_product_images.sql`

CLI workflow from this repository, after authenticating:

```sh
supabase link --project-ref ffukncssuqmwlowdrbau
supabase db push --dry-run
supabase db push
```

Inspect the dry-run target before push. Never put passwords in shell arguments or tracked files. Do not expose the `commerce` schema in the Data API. The public catalog RPC is intentionally readable; all other commerce RPCs are explicitly executable only by `service_role`. Tables use RLS and deny browser access.

Explicitly applied `supabase/fixtures/development.sql` to the inspected development project. Six products now exist and there are zero orders. This is temporary demo catalog/settings data. It does not run as part of `db push`.

## 3. Admin identity and images

Created `saber.elshafey@gmail.com` through Supabase Auth with no password and without bypassing email confirmation, then allowlisted only its returned UUID in `commerce.admins`. No invitation/reset email has been sent. No browser-accessible admin enrollment exists.

To finish owner access:

1. In Supabase **Authentication → URL Configuration**, add `http://localhost:9001/` to Redirect URLs for local setup; add the exact Admin HTTPS origin when published. Preserve any existing URLs. This setting could not be inspected with the current OAuth grant.
2. Open the local Admin, enter the owner email, and click **Set or reset password**. This user-initiated action sends the Auth recovery email.
3. Open the email link, verify that it returns to the intended Admin origin, and set the password personally. The callback removes its token fragment from browser history before displaying the password form.
4. Verify sign-in and Admin access. Email delivery, callback settings, password setup and authenticated hosted Admin operations remain pending. Configure Supabase Auth SMTP if its default sender cannot deliver to this address.

The media migration creates the `product-images` bucket with a 5 MB limit and PNG/JPEG/WebP MIME types. Product images are public; uploads require the Edge endpoint to validate a Supabase Auth user and the private Admin allowlist. The code validates MIME signatures, uses random file names and disables overwrites. Bucket creation and limits are verified; actual authenticated managed Storage upload remains to be tested.

## 4. Edge Function and secrets

Copy `supabase/.env.template` to an ignored file such as `supabase/.env.local` and populate secrets securely. Supabase provides its URL/service-role environment values to hosted functions; do not attempt to set reserved platform variables with the CLI. Supply the remaining application secrets through the Dashboard/CLI. Never put service keys or Ziina tokens in storefront/admin JavaScript.

The deployed entry point allows `http://localhost:8000`, `http://localhost:9001`, and the exact storefront origin `https://shopping-three-kappa.vercel.app`; it defaults to storefront URL `http://localhost:8000` and test mode. Platform environment values override them. Secret-write scope is unavailable; no payment or reconciliation secrets have been set. Before enabling Ziina test payments on Vercel, configure `STOREFRONT_URL` for the HTTPS storefront origin.

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

**Storefront:** `/Users/me/Downloads/ecommerce` is pushed to `saber93/shopping` `main` at `a9d39eb` and deployed through the existing Vercel `evali1/shopping` project at `https://shopping-three-kappa.vercel.app`. The static site loads the hosted Supabase catalog; Edge CORS allows this origin. Checkout is disabled by the server until Ziina configuration is present. The catalog uses development fixtures and the pages request `noindex` while business details remain unconfirmed.

**Admin:** use this repository's root. `vercel.json` builds with `pnpm run build` and publishes `dist/`. The existing public key is included in `admin/public-config.json`; `PUBLIC_SUPABASE_KEY` can override it, and the build rejects secret keys. Only static assets and public configuration are deployed to the Admin. Configure the exact origin in Edge CORS. Set appropriate Supabase Auth site/redirect settings for the actual admin domain.

No separate Node server, Redis service or DigitalOcean resource is required by this implementation. Existing Vercel/Supabase usage charges still apply.

## 7. Hosted acceptance

Verify authentication and cross-account denial, catalog changes, Storage limits, cart totals, inventory with independent concurrent PostgreSQL sessions, test Ziina success/failure/cancellation/pending, duplicate/out-of-order delivery, restarts/timeouts, reconciliation scheduling, and order fulfillment. Measure Edge-to-database and UAE checkout timings. Do not enable live mode as a workaround for missing test credentials.

References: [Supabase CLI](https://supabase.com/docs/reference/cli/introduction), [Edge Functions](https://supabase.com/docs/guides/functions), [Cron](https://supabase.com/docs/guides/cron), [Ziina Payment Intents](https://docs.ziina.com/api-reference/payment-intent/index), [Ziina webhooks](https://docs.ziina.com/api-reference/webhook).
