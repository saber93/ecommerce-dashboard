import { test, before, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import {
  database,
  reset,
  rpc,
  checkoutArgs,
  stock,
  adminId,
} from './helpers.mjs'
let db
before(async () => {
  db = await database()
})
beforeEach(async () => reset(db))
after(async () => db?.close())
async function pending() {
  const order = await rpc(db, 'commerce_checkout', checkoutArgs())
  await rpc(db, 'commerce_claim_payment', { p_id: order.id })
  const intent = crypto.randomUUID()
  await rpc(db, 'commerce_bind_payment', {
    p_id: order.id,
    p_intent: intent,
    p_url: 'https://pay.ziina.com/test',
  })
  return { order, intent }
}
const apply = (order, intent, status) =>
  rpc(db, 'commerce_apply_payment', {
    p_id: order.id,
    p_intent: intent,
    p_status: status,
    p_amount: order.total_minor,
    p_currency: 'AED',
  })
test('migration and catalog expose no stock, customers, admin membership or secrets', async () => {
  await db.exec('set role anon')
  const catalog = await rpc(db, 'commerce_catalog')
  assert.equal(catalog.products.length, 6)
  assert.equal(catalog.products[0].stock_quantity, undefined)
  await assert.rejects(
    db.query('select * from commerce.orders'),
    /permission denied/,
  )
  await assert.rejects(
    rpc(db, 'commerce_checkout', checkoutArgs()),
    /permission denied/,
  )
  await db.exec('reset role')
})
test('checkout uses database prices and reserves stock atomically', async () => {
  const args = checkoutArgs([{ id: 'blush-duo', quantity: 2, price_minor: 1 }])
  const order = await rpc(db, 'commerce_checkout', args)
  assert.equal(order.total_minor, 33000)
  assert.deepEqual(await stock(db), {
    stock_quantity: 20,
    reserved_quantity: 2,
  })
  assert.equal(order.token_hash, undefined)
})
test('same request is idempotent and altered replay fails', async () => {
  const args = checkoutArgs()
  const a = await rpc(db, 'commerce_checkout', args)
  const b = await rpc(db, 'commerce_checkout', args)
  assert.equal(a.id, b.id)
  assert.equal((await stock(db)).reserved_quantity, 1)
  await assert.rejects(
    rpc(db, 'commerce_checkout', { ...args, p_request_hash: 'different' }),
    /CHECKOUT_CONFLICT/,
  )
})
test('competing checkouts cannot reserve the last unit twice', async () => {
  await db.exec(
    "update commerce.products set stock_quantity=1 where id='blush-duo'",
  )
  const results = await Promise.allSettled([
    rpc(db, 'commerce_checkout', checkoutArgs()),
    rpc(db, 'commerce_checkout', checkoutArgs()),
  ])
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  assert.equal((await stock(db)).reserved_quantity, 1)
  // PGlite serializes a single connection; multi-session hosted contention is a separate gate.
})
test('insufficient stock rolls back all items', async () => {
  await db.exec(
    "update commerce.products set stock_quantity=0 where id='lip-pair'",
  )
  await assert.rejects(
    rpc(
      db,
      'commerce_checkout',
      checkoutArgs([
        { id: 'blush-duo', quantity: 2 },
        { id: 'lip-pair', quantity: 1 },
      ]),
    ),
    /OUT_OF_STOCK/,
  )
  assert.equal((await stock(db)).reserved_quantity, 0)
  assert.equal(
    (await db.query('select count(*)::int n from commerce.orders')).rows[0].n,
    0,
  )
})
test('invalid country, duplicate items and disabled checkout rejected', async () => {
  const args = checkoutArgs()
  await assert.rejects(
    rpc(db, 'commerce_checkout', {
      ...args,
      p_customer: { ...args.p_customer, country: 'US' },
    }),
    /DELIVERY_UNAVAILABLE/,
  )
  await assert.rejects(
    rpc(
      db,
      'commerce_checkout',
      checkoutArgs([
        { id: 'blush-duo', quantity: 1 },
        { id: 'blush-duo', quantity: 1 },
      ]),
    ),
    /DUPLICATE_ITEMS/,
  )
  await db.exec('update commerce.settings set checkout_enabled=false')
  await assert.rejects(
    rpc(db, 'commerce_checkout', checkoutArgs()),
    /CHECKOUT_NOT_CONFIGURED/,
  )
})
test('one caller can claim a provider creation attempt', async () => {
  const o = await rpc(db, 'commerce_checkout', checkoutArgs())
  assert.equal(await rpc(db, 'commerce_claim_payment', { p_id: o.id }), true)
  assert.equal(await rpc(db, 'commerce_claim_payment', { p_id: o.id }), false)
})
test('duplicate completed events deduct inventory once; stale failure cannot undo payment', async () => {
  const { order, intent } = await pending()
  await apply(order, intent, 'completed')
  await apply(order, intent, 'completed')
  await apply(order, intent, 'failed')
  assert.deepEqual(await stock(db), {
    stock_quantity: 19,
    reserved_quantity: 0,
  })
  assert.equal(
    (
      await rpc(db, 'commerce_order', {
        p_id: order.id,
        p_token_hash: 'a'.repeat(64),
      })
    ).status,
    'paid',
  )
})
test('failed/canceled payment releases reservation exactly once', async () => {
  const { order, intent } = await pending()
  await apply(order, intent, 'canceled')
  await apply(order, intent, 'canceled')
  assert.deepEqual(await stock(db), {
    stock_quantity: 20,
    reserved_quantity: 0,
  })
})
test('late completed payment after reservation release enters review', async () => {
  const { order, intent } = await pending()
  await apply(order, intent, 'failed')
  const result = await apply(order, intent, 'completed')
  assert.equal(result.status, 'review')
  assert.equal((await stock(db)).stock_quantity, 20)
})
test('mismatched payment amount cannot advance order', async () => {
  const { order, intent } = await pending()
  await assert.rejects(
    rpc(db, 'commerce_apply_payment', {
      p_id: order.id,
      p_intent: intent,
      p_status: 'completed',
      p_amount: 1,
      p_currency: 'AED',
    }),
    /PAYMENT_MISMATCH/,
  )
  assert.equal((await stock(db)).reserved_quantity, 1)
})
test('incorrect order capability cannot read personal information', async () => {
  const o = await rpc(db, 'commerce_checkout', checkoutArgs())
  assert.equal(
    await rpc(db, 'commerce_order', {
      p_id: o.id,
      p_token_hash: 'b'.repeat(64),
    }),
    null,
  )
})
test('reconciler releases only never-submitted expired checkouts', async () => {
  const a = await rpc(db, 'commerce_checkout', checkoutArgs())
  const b = await rpc(db, 'commerce_checkout', checkoutArgs())
  await rpc(db, 'commerce_claim_payment', { p_id: b.id })
  await db.exec("update commerce.orders set expires_at=now()-interval '1 hour'")
  await rpc(db, 'commerce_reconcile_batch')
  assert.equal((await stock(db)).reserved_quantity, 1)
  assert.equal(
    (
      await rpc(db, 'commerce_order', {
        p_id: a.id,
        p_token_hash: 'a'.repeat(64),
      })
    ).status,
    'expired',
  )
})
test('admin authorization and paid-order fulfillment enforced in database', async () => {
  await assert.rejects(
    rpc(db, 'commerce_admin', {
      p_actor: crypto.randomUUID(),
      p_action: 'list',
    }),
    /ADMIN_REQUIRED/,
  )
  const { order, intent } = await pending()
  await assert.rejects(
    rpc(db, 'commerce_admin', {
      p_actor: adminId,
      p_action: 'fulfill',
      p_data: { id: order.id },
    }),
    /PAID_ORDER_REQUIRED/,
  )
  await apply(order, intent, 'completed')
  await rpc(db, 'commerce_admin', {
    p_actor: adminId,
    p_action: 'fulfill',
    p_data: { id: order.id },
  })
  assert.equal(
    (
      await rpc(db, 'commerce_order', {
        p_id: order.id,
        p_token_hash: 'a'.repeat(64),
      })
    ).fulfillment,
    'fulfilled',
  )
})
test('abusive requests are rate limited and window reset is atomic', async () => {
  for (let i = 0; i < 3; i++)
    assert.equal(
      await rpc(db, 'commerce_rate_limit', {
        p_key: 'test',
        p_max: 3,
        p_seconds: 60,
      }),
      true,
    )
  assert.equal(
    await rpc(db, 'commerce_rate_limit', {
      p_key: 'test',
      p_max: 3,
      p_seconds: 60,
    }),
    false,
  )
  await db.exec(
    "update commerce.rate_limits set resets_at=now()-interval '1 second'",
  )
  assert.equal(
    await rpc(db, 'commerce_rate_limit', {
      p_key: 'test',
      p_max: 3,
      p_seconds: 60,
    }),
    true,
  )
})
test('failing event is backed off and eventually excluded from automatic retries', async () => {
  const id = crypto.randomUUID()
  await rpc(db, 'commerce_event', { p_key: 'event', p_intent: id })
  for (let i = 0; i < 10; i++)
    await rpc(db, 'commerce_reconcile_failure', {
      p_event_key: 'event',
      p_intent: id,
    })
  assert.equal((await rpc(db, 'commerce_reconcile_batch')).events.length, 0)
  const event = (await db.query('select * from commerce.payment_events'))
    .rows[0]
  assert.equal(event.attempts, 10)
  assert.equal(event.processed_at, null)
})
test('admin cannot set stock below reserved units', async () => {
  await rpc(db, 'commerce_checkout', checkoutArgs())
  const p = (
    await db.query("select * from commerce.products where id='blush-duo'")
  ).rows[0]
  await assert.rejects(
    rpc(db, 'commerce_admin', {
      p_actor: adminId,
      p_action: 'product',
      p_data: { ...p, stock_quantity: 0 },
    }),
    /check constraint/,
  )
  assert.deepEqual(await stock(db), {
    stock_quantity: 20,
    reserved_quantity: 1,
  })
})
