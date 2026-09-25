# Ecommerce dashboard and Supabase backend

The user approved replacing Medusa with a custom Supabase commerce backend on 2026-09-24.

- Active code: `supabase/` (schema and Edge Functions), `admin/` (static dashboard), `scripts/`, `tests/`.
- `apps/backend/` is an inactive Medusa scaffold retained for reference. Do not run its migrations, seeds, deployment or dev scripts as part of the new architecture.
- Keep the existing storefront in `/Users/me/Downloads/ecommerce`; preserve its design.
- Use the root packageManager (pnpm). Never edit lockfiles manually.
- Use the existing Supabase project `ffukncssuqmwlowdrbau`, AWS Seoul `ap-northeast-2`.
- No live payments. Ziina requests must specify `test: true`.
- Secrets stay in ignored environment files or the platform secret store. Never print or commit them.
- Private commerce tables are accessed through narrowly scoped RPC functions. Browsers receive only catalog access; mutations require backend validation or verified Admin authorization.
- Prices use integer fils. Inventory/order transitions must be transactional and idempotent.
- Fixtures are explicit and opt-in; do not invent confirmed business settings.
- Verify SQL on a disposable local PostgreSQL-compatible instance before remote migrations; preserve existing data.
- Commands: `pnpm test`, `pnpm build`, `pnpm dev`.
