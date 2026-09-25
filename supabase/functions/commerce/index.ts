import { createHandler } from "../_shared/handler.mjs";

// Explicit development, storefront, and Admin deployment origins.
// These are public settings. Provider credentials are only read from platform secrets.
Deno.serve(
  createHandler({
    ALLOWED_ORIGINS:
      "http://localhost:8000,http://localhost:9001,https://shopping-three-kappa.vercel.app,https://ecommerce-dashboard-omega-khaki.vercel.app",
    STOREFRONT_URL: "http://localhost:8000",
    ZIINA_TEST_MODE: "true",
    ...Deno.env.toObject(),
  }),
);
