# Élan commerce backend and admin

Custom Supabase backend and a static admin dashboard for the existing Élan storefront. **Medusa is no longer part of the active runtime or dependency installation.** The earlier `apps/backend/` scaffold is retained as inactive reference material.

## Architecture

- Storefront: `/Users/me/Downloads/ecommerce`, deployed separately to Vercel; original design preserved.
- Admin: `admin/`, built into `dist/` for the separate Vercel deployment.
- Backend: Supabase Edge Function `commerce`, plus transactional PostgreSQL RPCs.
- Database: existing project **ffukncssuqmwlowdrbau**, AWS **ap-northeast-2 (Seoul)**.
- Media: Supabase Storage `product-images`, public product images with admin-only uploads.
- Payments: Ziina **test mode only**. Live charging is deliberately rejected.

## Local checks

Use Node 24 and the package manager pinned in `package.json`:

```sh
pnpm install
pnpm test
pnpm build
pnpm dev
```

Admin preview: `http://localhost:9001`. The public project key is configured in `admin/public-config.json` and the local `admin/config.js`. The static build accepts a `PUBLIC_SUPABASE_KEY` override and rejects secret/service-role keys. The backend secrets template is `supabase/.env.template`.

`pnpm test` runs real SQL on disposable PGlite databases and the Edge handler against mocked Supabase HTTP transport / Ziina responses. PGlite is PostgreSQL compiled to WASM, not a live Supabase project. These tests do not validate multi-session contention, Supabase Auth, gateway headers, deployed Edge execution, Storage uploads or actual Ziina transactions.

## Deployment

Follow [deployment instructions](docs/deployment.md). Five additive migrations, the six existing products, seven confirmed UAE delivery areas and Edge Function `commerce` version 7 are deployed to the existing cloud project. The storefront and separate Admin are deployed as development previews on Vercel. The owner reports adding the Admin Auth redirect URL; a read-only database check confirmed the requested administrator's verified email, password hash and private membership. Browser sign-in and authenticated Admin operations remain unverified. Cash on delivery remains closed while real photos and business details are missing. No real Ziina payment has been performed.

See [business settings](docs/business-settings.md) for the distinction between confirmed choices, fixtures and unresolved production settings. See [launch readiness](docs/launch-readiness.md) and [verification](docs/verification.md) for the remaining gates and tested behavior.

## Supported initial scope

- One sellable SKU per product; the existing color dots remain decorative, not purchasable variants.
- Browser cart with authoritative server-side repricing at checkout.
- Guest checkout using an unguessable order-access token stored in the initiating tab; no customer account UI yet.
- Transactional stock reservation, payment-to-order transitions, fulfillment marking and audit records.
- Separate gated cash-on-delivery quote and order flow with transactional stock deduction, Admin collection and cancellation actions.
- Admin email/password authentication through Supabase Auth plus a private database allowlist.
- Product management, stock editing, public image uploads and galleries, multilingual fit/styling details, curated collection assignments, day-to-night pairing, verified limited-edition and photo flags, latest 100 orders, payment verification/recovery.
- Persistent webhook inbox, bounded reconciliation and retry backoff. A scheduler still needs deployment configuration.

Advanced promotions, variants, refunds/returns UI, carrier integrations, customer accounts, transactional email/digital invoices and production tax rules are not implemented. The two-bag free-delivery offer is a marketing concept, not a checkout rule. The storefront now uses the confirmed support phone instead of a placeholder newsletter form.
