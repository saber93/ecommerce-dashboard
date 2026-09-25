import {
  AppError,
  sha256,
  verifySignature,
  readBody,
  parseBody,
  uuid,
  validateCheckout,
  validateItems,
  validateProduct,
  imageExtension,
} from "./security.mjs";
import {
  createZiina,
  validateIntent,
  paymentURL,
  orderFromMessage,
  ZIINA_IPS,
} from "./ziina.mjs";
const PROJECT = "https://ffukncssuqmwlowdrbau.supabase.co";
const safeErrors = [
  "CHECKOUT_CONFLICT",
  "CHECKOUT_NOT_CONFIGURED",
  "DELIVERY_UNAVAILABLE",
  "INVALID_ITEMS",
  "DUPLICATE_ITEMS",
  "INVALID_QUANTITY",
  "PRODUCT_UNAVAILABLE",
  "OUT_OF_STOCK",
  "INVALID_TOTAL",
  "ADMIN_REQUIRED",
  "PAID_ORDER_REQUIRED",
  "PAYMENT_CONFLICT",
  "PAYMENT_MISMATCH",
  "COD_NOT_CONFIGURED",
  "COD_COLLECTION_MISMATCH",
  "COD_CANCELLATION_NOT_ALLOWED",
  "FULFILLMENT_NOT_ALLOWED",
  "QUOTE_CHANGED",
  "INVALID_SHIPPING_OFFER",
];
export function createHandler(env, fetcher = fetch) {
  const origins = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const provider = createZiina(env, fetcher);
  async function rpc(name, args = {}) {
    const base = env.SUPABASE_URL;
    if (
      base !== PROJECT &&
      !(
        env.ALLOW_LOCAL_SUPABASE === "true" &&
        /^http:\/\/(127\.0\.0\.1|localhost|kong):\d+$/.test(base)
      )
    )
      throw new AppError("DATABASE_TARGET_MISMATCH", 503);
    if (!env.SUPABASE_SERVICE_ROLE_KEY)
      throw new AppError("BACKEND_NOT_CONFIGURED", 503);
    let response;
    try {
      response = await fetcher(`${base}/rest/v1/rpc/${name}`, {
        method: "POST",
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      throw new AppError("DATABASE_UNAVAILABLE", 503);
    }
    const data = await response.json();
    if (!response.ok) {
      const code = safeErrors.find((c) => data.message?.includes(c));
      throw new AppError(
        code || "DATABASE_OPERATION_FAILED",
        code === "ADMIN_REQUIRED" ? 403 : code ? 409 : 503,
      );
    }
    return data;
  }
  async function limit(key, max = 30, seconds = 60) {
    if (
      !(await rpc("commerce_rate_limit", {
        p_key: key,
        p_max: max,
        p_seconds: seconds,
      }))
    )
      throw new AppError("RATE_LIMITED", 429);
  }
  async function syncIntent(intentId, eventKey = null) {
    const intent = await provider.get(intentId);
    const order = await rpc("commerce_payment_order", {
      p_intent: intentId,
      p_id: orderFromMessage(intent.message),
    });
    if (!order) throw new AppError("PAYMENT_ORDER_NOT_FOUND", 409);
    validateIntent(intent, order, env.ZIINA_ACCOUNT_ID);
    if (!order.payment_intent_id)
      await rpc("commerce_bind_payment", {
        p_id: order.id,
        p_intent: intent.id,
        p_url: intent.redirect_url ? paymentURL(intent.redirect_url) : null,
      });
    return rpc("commerce_apply_payment", {
      p_id: order.id,
      p_intent: intent.id,
      p_status: intent.status,
      p_amount: intent.amount,
      p_currency: intent.currency_code,
      p_event_key: eventKey,
    });
  }
  async function adminUser(request) {
    const authorization = request.headers.get("authorization") || "";
    if (!authorization.startsWith("Bearer "))
      throw new AppError("AUTH_REQUIRED", 401);
    const response = await fetcher(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: authorization,
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new AppError("AUTH_REQUIRED", 401);
    const user = await response.json();
    if (!uuid(user.id)) throw new AppError("AUTH_REQUIRED", 401);
    return user.id;
  }
  return async (request) => {
    const origin = request.headers.get("origin");
    const headers = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      Vary: "Origin",
    };
    if (origin && origins.includes(origin))
      Object.assign(headers, {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Headers": "authorization, apikey, content-type",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      });
    const respond = (body, status = 200) =>
      new Response(JSON.stringify(body), { status, headers });
    try {
      if (origin && !origins.includes(origin))
        throw new AppError("ORIGIN_NOT_ALLOWED", 403);
      if (request.method === "OPTIONS")
        return new Response(null, { status: 204, headers });
      const action = new URL(request.url).pathname
        .split("/")
        .filter(Boolean)
        .at(-1);
      if (action === "catalog" && request.method === "GET") {
        const catalog = await rpc("commerce_catalog");
        // Catalog availability must not imply that a payment account is ready.
        try {
          provider.assertConfigured();
        } catch {
          catalog.checkout_enabled = false;
        }
        return respond(catalog);
      }
      if (request.method !== "POST") throw new AppError("NOT_FOUND", 404);
      if (action === "image") {
        const actor = await adminUser(request);
        await rpc("commerce_admin", { p_actor: actor, p_action: "list" });
        await limit(`image:${actor}`, 20, 600);
        const bytes = await readBody(request, 5 * 1024 * 1024);
        const mime = request.headers.get("content-type");
        const extension = imageExtension(bytes, mime);
        const path = `${crypto.randomUUID()}.${extension}`;
        const response = await fetcher(
          `${env.SUPABASE_URL}/storage/v1/object/product-images/${path}`,
          {
            method: "POST",
            headers: {
              apikey: env.SUPABASE_SERVICE_ROLE_KEY,
              Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
              "Content-Type": mime,
              "x-upsert": "false",
            },
            body: bytes,
            signal: AbortSignal.timeout(20000),
          },
        );
        if (!response.ok) throw new AppError("IMAGE_UPLOAD_FAILED", 503);
        return respond({
          url: `${env.SUPABASE_URL}/storage/v1/object/public/product-images/${path}`,
        });
      }
      const raw = await readBody(request);
      if (action === "webhook") {
        if (!env.ZIINA_WEBHOOK_SECRET || !env.ZIINA_TRUSTED_IP_HEADER)
          throw new AppError("WEBHOOK_NOT_CONFIGURED", 503);
        // The named header MUST be overwritten by the verified hosting proxy.
        // Never trust arbitrary forwarding chains or accept user-supplied leftmost addresses.
        const ip = request.headers.get(env.ZIINA_TRUSTED_IP_HEADER);
        if (!ZIINA_IPS.includes(ip))
          throw new AppError("WEBHOOK_SOURCE_REJECTED", 403);
        if (
          !(await verifySignature(
            raw,
            request.headers.get("x-hmac-signature"),
            env.ZIINA_WEBHOOK_SECRET,
          ))
        )
          throw new AppError("INVALID_SIGNATURE", 401);
        const body = parseBody(raw);
        if (body.event !== "payment_intent.status.updated")
          return respond({ received: true });
        if (!uuid(body.data?.id)) throw new AppError("INVALID_PAYMENT_ID");
        const key = await sha256(raw);
        if (
          await rpc("commerce_event", { p_key: key, p_intent: body.data.id })
        ) {
          try {
            await syncIntent(body.data.id, key);
          } catch (error) {
            await rpc("commerce_reconcile_failure", {
              p_event_key: key,
              p_intent: body.data.id,
            });
            throw error;
          }
        }
        return respond({ received: true });
      }
      const body = parseBody(raw);
      if (action === "checkout") {
        provider.assertConfigured();
        const { customer, items } = validateCheckout(body);
        await limit(`checkout:${await sha256(customer.email)}`, 5, 600);
        // Global circuit breaker also limits abuse that rotates email addresses.
        await limit("checkout-global", 100, 600);
        const order = await rpc("commerce_checkout", {
          p_key: body.request_key,
          p_token_hash: await sha256(body.token),
          p_request_hash: await sha256(JSON.stringify({ customer, items })),
          p_customer: customer,
          p_items: items,
        });
        if (order.payment_intent_id)
          return respond({
            order_id: order.id,
            status: order.status,
            redirect_url:
              order.status === "pending" ? paymentURL(order.payment_url) : null,
          });
        const claimed = await rpc("commerce_claim_payment", { p_id: order.id });
        if (!claimed)
          return respond(
            {
              order_id: order.id,
              status: order.status,
              recovery_pending: true,
            },
            202,
          );
        try {
          const intent = validateIntent(
            await provider.create(order),
            order,
            env.ZIINA_ACCOUNT_ID,
          );
          const redirect = paymentURL(intent.redirect_url);
          await rpc("commerce_bind_payment", {
            p_id: order.id,
            p_intent: intent.id,
            p_url: redirect,
          });
          return respond({
            order_id: order.id,
            status: "pending",
            redirect_url: redirect,
          });
        } catch {
          // A timed-out POST may have succeeded at Ziina. Never blindly create another charge.
          return respond(
            { order_id: order.id, status: "pending", recovery_pending: true },
            202,
          );
        }
      }
      if (action === "cod-checkout") {
        const { customer, items } = validateCheckout(body);
        if (!Number.isInteger(body.expected_total_minor) || body.expected_total_minor < 200 || body.expected_total_minor > 100000000)
          throw new AppError("INVALID_TOTAL");
        const emirate = body.customer?.emirate;
        if (typeof emirate !== "string" || !/^[a-z][a-z0-9-]{1,39}$/.test(emirate))
          throw new AppError("DELIVERY_UNAVAILABLE");
        customer.emirate = emirate;
        await limit(`cod:${await sha256(customer.email)}`, 10, 600);
        await limit("cod-global", 50, 600);
        const order = await rpc("commerce_cod_checkout", {
          p_key: body.request_key,
          p_token_hash: await sha256(body.token),
          p_request_hash: await sha256(JSON.stringify({ customer, items })),
          p_customer: customer,
          p_items: items,
          p_expected_total: body.expected_total_minor,
        });
        return respond({ order_id: order.id, status: order.status });
      }
      if (action === "cod-quote") {
        const emirate = body.emirate;
        if (typeof emirate !== "string" || !/^[a-z][a-z0-9-]{1,39}$/.test(emirate))
          throw new AppError("DELIVERY_UNAVAILABLE");
        const items = validateItems(body.items);
        await limit("cod-quote-global", 200, 60);
        return respond(await rpc("commerce_cod_quote", { p_area: emirate, p_items: items }));
      }
      if (action === "status") {
        if (!uuid(body.order_id) || !/^[a-f0-9]{64}$/.test(body.token || ""))
          throw new AppError("INVALID_ORDER_ACCESS");
        const hash = await sha256(body.token);
        await limit(`status:${hash}`, 30, 60);
        let order = await rpc("commerce_order", {
          p_id: body.order_id,
          p_token_hash: hash,
        });
        if (!order) throw new AppError("ORDER_NOT_FOUND", 404);
        let verificationPending = false;
        if (
          order.payment_intent_id &&
          ["pending", "review"].includes(order.status)
        ) {
          try {
            await syncIntent(order.payment_intent_id);
            order = await rpc("commerce_order", {
              p_id: body.order_id,
              p_token_hash: hash,
            });
          } catch {
            verificationPending = true;
          }
        }
        return respond({ order, verification_pending: verificationPending });
      }
      if (action === "reconcile") {
        if (
          !env.RECONCILE_SECRET ||
          request.headers.get("authorization") !==
            `Bearer ${env.RECONCILE_SECRET}`
        )
          throw new AppError("AUTH_REQUIRED", 401);
        const batch = await rpc("commerce_reconcile_batch");
        let processed = 0;
        let pending = 0;
        // Bound each invocation; unprocessed work stays in PostgreSQL for the next run.
        const work = [
          ...batch.events.map((e) => ({ id: e.intent_id, key: e.event_key })),
          ...batch.orders.map((o) => ({ id: o.payment_intent_id, key: null })),
        ].slice(0, 10);
        await Promise.all(
          work.map(async (item) => {
            try {
              await syncIntent(item.id, item.key);
              processed++;
            } catch {
              pending++;
              await rpc("commerce_reconcile_failure", {
                p_event_key: item.key,
                p_intent: item.id,
              }).catch(() => {});
            }
          }),
        );
        return respond({ processed, pending });
      }
      if (action === "admin") {
        const actor = await adminUser(request);
        await limit(`admin:${actor}`, 60, 60);
        if (body.action === "reconcile") {
          await rpc("commerce_admin", { p_actor: actor, p_action: "list" });
          return respond(await syncIntent(body.data?.payment_intent_id));
        }
        let data = body.data || {};
        if (body.action === "product") data = validateProduct(data);
        if (["order", "fulfill", "cod_collect", "cod_cancel"].includes(body.action) && !uuid(data.id))
          throw new AppError("INVALID_ORDER");
        if (body.action === "cod_collect" && (!Number.isInteger(data.amount_minor) || data.amount_minor < 200))
          throw new AppError("INVALID_AMOUNT");
        return respond(
          await rpc("commerce_admin", {
            p_actor: actor,
            p_action: body.action,
            p_data: data,
          }),
        );
      }
      throw new AppError("NOT_FOUND", 404);
    } catch (error) {
      // Never expose provider responses, keys, addresses, SQL or bearer tokens.
      return respond(
        { error: error instanceof AppError ? error.code : "INTERNAL_ERROR" },
        error instanceof AppError ? error.status : 500,
      );
    }
  };
}
