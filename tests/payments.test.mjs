import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { database, reset, rpc, customer, stock, adminId } from "./helpers.mjs";
import { createHandler } from "../supabase/functions/_shared/handler.mjs";
import {
  sha256,
  verifySignature,
  validateCheckout,
} from "../supabase/functions/_shared/security.mjs";
import {
  validateIntent,
  paymentMessage,
  paymentURL,
} from "../supabase/functions/_shared/ziina.mjs";
let db, handler, intents, postCount, failPost, env;
before(async () => {
  db = await database();
});
after(async () => db?.close());
beforeEach(async () => {
  await reset(db);
  intents = new Map();
  postCount = 0;
  failPost = false;
  env = {
    SUPABASE_URL: "https://ffukncssuqmwlowdrbau.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-secret",
    ALLOWED_ORIGINS: "https://store.example",
    STOREFRONT_URL: "https://store.example",
    ZIINA_TEST_MODE: "true",
    ZIINA_API_TOKEN: "test-provider",
    ZIINA_ACCOUNT_ID: "merchant-fixture",
    ZIINA_WEBHOOK_SECRET: "test-webhook-secret",
    ZIINA_TRUSTED_IP_HEADER: "x-verified-source-ip",
    RECONCILE_SECRET: "test-reconcile-secret",
  };
  handler = createHandler(env, async (url, options = {}) => {
    if (url.endsWith("/auth/v1/user"))
      return options.headers.Authorization === "Bearer fixture-admin"
        ? Response.json({ id: adminId })
        : Response.json({ error: "unauthorized" }, { status: 401 });
    if (url.includes("/storage/v1/object/product-images/"))
      return Response.json({ Key: "fixture-path" });
    if (url.includes("/rest/v1/rpc/")) {
      try {
        return Response.json(
          await rpc(db, url.split("/").at(-1), JSON.parse(options.body)),
        );
      } catch (e) {
        return Response.json({ message: e.message }, { status: 400 });
      }
    }
    if (url === "https://api-v2.ziina.com/api/payment_intent") {
      postCount++;
      const body = JSON.parse(options.body);
      assert.equal(body.test, true);
      assert.equal(body.amount, 16500);
      const id = crypto.randomUUID();
      const intent = {
        ...body,
        id,
        account_id: "merchant-fixture",
        tip_amount: 0,
        status: "requires_payment_instrument",
        redirect_url: `https://pay.ziina.com/${id}`,
      };
      intents.set(id, intent);
      if (failPost)
        throw new Error(
          "Simulated network interruption AFTER provider accepted payment",
        );
      return Response.json(intent);
    }
    if (url.includes("/payment_intent/")) {
      const i = intents.get(url.split("/").at(-1));
      return Response.json(i || {}, { status: i ? 200 : 404 });
    }
    throw new Error(`Unexpected mock request: ${url}`);
  });
});
const input = () => ({
  request_key: crypto.randomUUID(),
  token: "b".repeat(64),
  customer,
  items: [{ id: "blush-duo", quantity: 1, price_minor: 1 }],
});
async function call(action, body, headers = {}) {
  const r = await handler(
    new Request(`https://edge.example/commerce/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
  return { status: r.status, body: await r.json() };
}
async function signed(body) {
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.ZIINA_WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, bytes))]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}

test("catalog stays readable but checkout is disabled without provider configuration", async () => {
  delete env.ZIINA_API_TOKEN;
  const response = await handler(
    new Request("https://edge.example/commerce/catalog"),
  );
  assert.equal(response.status, 200);
  const catalog = await response.json();
  assert.equal(catalog.products.length, 6);
  assert.equal(catalog.checkout_enabled, false);
  assert.equal(postCount, 0);
});
test("checkout sends server price and test=true; retries reuse intent", async () => {
  const body = input();
  const first = await call("checkout", body);
  assert.equal(first.status, 200);
  assert.match(first.body.redirect_url, /pay.ziina.com/);
  await call("checkout", body);
  assert.equal(postCount, 1);
  assert.equal((await stock(db)).reserved_quantity, 1);
});
test("ambiguous provider creation is not repeated; signed webhook recovers it", async () => {
  failPost = true;
  const body = input();
  const first = await call("checkout", body);
  assert.equal(first.status, 202);
  assert.equal((await call("checkout", body)).status, 202);
  assert.equal(postCount, 1);
  const intent = [...intents.values()][0];
  intent.status = "completed";
  const event = {
    event: "payment_intent.status.updated",
    data: { id: intent.id },
  };
  const headers = {
    "x-hmac-signature": await signed(event),
    "x-verified-source-ip": "3.29.184.186",
  };
  assert.equal((await call("webhook", event, headers)).status, 200);
  assert.equal((await call("webhook", event, headers)).status, 200);
  const order = (
    await call("status", { order_id: first.body.order_id, token: body.token })
  ).body.order;
  assert.equal(order.status, "paid");
  assert.deepEqual(await stock(db), {
    stock_quantity: 19,
    reserved_quantity: 0,
  });
});
test("redirect result and spoofed client payment status cannot mark paid", async () => {
  const body = input();
  const first = await call("checkout", body);
  const result = await call("status", {
    order_id: first.body.order_id,
    token: body.token,
    status: "completed",
    result: "success",
  });
  assert.equal(result.body.order.status, "pending");
});
test("signed event body is not authoritative; fresh provider status wins", async () => {
  const body = input();
  const first = await call("checkout", body);
  const id = [...intents.keys()][0];
  const event = {
    event: "payment_intent.status.updated",
    data: { id, status: "completed" },
  };
  await call("webhook", event, {
    "x-hmac-signature": await signed(event),
    "x-verified-source-ip": "3.29.184.186",
  });
  assert.equal(
    (await call("status", { order_id: first.body.order_id, token: body.token }))
      .body.order.status,
    "pending",
  );
});
test("webhook rejects bad signature, changed body, and forged source chain", async () => {
  const event = {
    event: "payment_intent.status.updated",
    data: { id: crypto.randomUUID() },
  };
  const signature = await signed(event);
  assert.equal(
    (
      await call("webhook", event, {
        "x-hmac-signature": "0".repeat(64),
        "x-verified-source-ip": "3.29.184.186",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await call(
        "webhook",
        { ...event, extra: true },
        {
          "x-hmac-signature": signature,
          "x-verified-source-ip": "3.29.184.186",
        },
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await call("webhook", event, {
        "x-hmac-signature": signature,
        "x-verified-source-ip": "3.29.184.186, 1.2.3.4",
      })
    ).status,
    403,
  );
});
test("payment cannot be verified against another account, amount, currency or intent", () => {
  const order = {
    id: crypto.randomUUID(),
    total_minor: 1000,
    currency: "AED",
    test_mode: true,
    payment_intent_id: crypto.randomUUID(),
  };
  const good = {
    id: order.payment_intent_id,
    account_id: "merchant-fixture",
    amount: 1000,
    currency_code: "AED",
    message: paymentMessage(order.id),
    status: "completed",
    tip_amount: 0,
  };
  assert.equal(validateIntent(good, order, "merchant-fixture"), good);
  for (const patch of [
    { account_id: "other" },
    { amount: 1 },
    { currency_code: "USD" },
    { id: crypto.randomUUID() },
    { message: "wrong" },
    { status: "unknown" },
    { tip_amount: 1 },
  ])
    assert.throws(
      () => validateIntent({ ...good, ...patch }, order, "merchant-fixture"),
      /VERIFICATION_FAILED/,
    );
});
test("live mode, missing webhook proxy configuration and unauthorized reconciliation fail closed", async () => {
  env.ZIINA_TEST_MODE = "false";
  assert.equal((await call("checkout", input())).status, 503);
  assert.equal(postCount, 0);
  env.ZIINA_TRUSTED_IP_HEADER = "";
  assert.equal((await call("webhook", {})).status, 503);
  assert.equal((await call("reconcile", {})).status, 401);
});
test("invalid quantities, duplicate items and malicious redirect URLs rejected", () => {
  assert.throws(() =>
    validateCheckout({
      ...input(),
      items: [{ id: "blush-duo", quantity: -1 }],
    }),
  );
  assert.throws(() =>
    validateCheckout({
      ...input(),
      items: [
        { id: "blush-duo", quantity: 1 },
        { id: "blush-duo", quantity: 1 },
      ],
    }),
  );
  for (const url of [
    "javascript:alert(1)",
    "http://pay.ziina.com/x",
    "https://pay.ziina.com.evil.example/x",
    "https://user:pass@pay.ziina.com/x",
  ])
    assert.throws(() => paymentURL(url));
});
test("untrusted storefront origin is rejected", async () => {
  assert.equal(
    (await call("checkout", input(), { Origin: "https://evil.example" }))
      .status,
    403,
  );
});
test("webhook failure persists an inbox record for later reconciliation", async () => {
  const event = {
    event: "payment_intent.status.updated",
    data: { id: crypto.randomUUID() },
  };
  const r = await call("webhook", event, {
    "x-hmac-signature": await signed(event),
    "x-verified-source-ip": "3.29.184.186",
  });
  assert.equal(r.status, 503);
  const rows = (
    await db.query("select processed_at,attempts from commerce.payment_events")
  ).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].processed_at, null);
  assert.equal(rows[0].attempts, 1);
});
test("image upload requires an authenticated admin before reading file data", async () => {
  const r = await handler(
    new Request("https://edge.example/commerce/image", {
      method: "POST",
      body: new Uint8Array([1, 2, 3]),
      headers: { "Content-Type": "image/png" },
    }),
  );
  assert.equal(r.status, 401);
});

test("Admin actor is taken from verified Auth response, not client data", async () => {
  assert.equal(
    (
      await call(
        "admin",
        { action: "list", p_actor: adminId },
        { Authorization: "Bearer forged" },
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await call(
        "admin",
        { action: "list", p_actor: crypto.randomUUID() },
        { Authorization: "Bearer fixture-admin" },
      )
    ).status,
    200,
  );
});
test("authenticated image endpoint validates type and returns managed Storage URL", async () => {
  const request = () =>
    new Request("https://edge.example/commerce/image", {
      method: "POST",
      body: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      headers: {
        "Content-Type": "image/png",
        Authorization: "Bearer fixture-admin",
      },
    });
  const r = await handler(request());
  assert.equal(r.status, 200);
  assert.match(
    (await r.json()).url,
    /supabase.co\/storage\/v1\/object\/public\/product-images\//,
  );
});
test("missing storefront URL cannot claim a payment or reserve inventory", async () => {
  env.STOREFRONT_URL = "";
  assert.equal((await call("checkout", input())).status, 503);
  assert.equal((await stock(db)).reserved_quantity, 0);
  assert.equal(postCount, 0);
});
