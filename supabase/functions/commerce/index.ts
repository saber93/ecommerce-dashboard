import { createHandler } from "../_shared/handler.mjs";

// Explicit development and storefront deployment origins. Add the Admin origin
// through ALLOWED_ORIGINS when its Vercel project is published.
// These are public settings. Provider credentials are only read from platform secrets.
Deno.serve(
  createHandler({
    ALLOWED_ORIGINS:
      "http://localhost:8000,http://localhost:9001,https://shopping-three-kappa.vercel.app",
    STOREFRONT_URL: "http://localhost:8000",
    ZIINA_TEST_MODE: "true",
    ...Deno.env.toObject(),
  }),
);
