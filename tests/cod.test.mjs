import { test, before, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { database, reset, rpc, checkoutArgs, stock, adminId } from './helpers.mjs'

let db
before(async () => { db = await database() })
beforeEach(async () => {
  await reset(db)
  await db.exec("update commerce.settings set fixture_mode=false,cod_enabled=true,checkout_enabled=false,tax_basis_points=0,allowed_countries=array['AE']")
  await db.exec("update commerce.products set fixture=false")
  await db.exec("insert into commerce.delivery_areas(code,name_en,name_ar,shipping_minor,days_min,days_max,active) values('dubai','Dubai','دبي',1500,1,1,true)")
})
after(async () => db?.close())
const args = () => {
  const input = checkoutArgs()
  return { ...input, p_customer: { ...input.p_customer, emirate: 'dubai' }, p_expected_total: 18000 }
}

test('COD remains closed until a confirmed switch and delivery area exist', async () => {
  await db.exec('update commerce.settings set cod_enabled=false')
  await assert.rejects(rpc(db, 'commerce_cod_checkout', args()), /COD_NOT_CONFIGURED/)
  await db.exec('update commerce.settings set cod_enabled=true')
  await assert.rejects(rpc(db, 'commerce_cod_checkout', { ...args(), p_customer: { ...args().p_customer, emirate: 'unknown' } }), /DELIVERY_UNAVAILABLE/)
  await db.exec("update commerce.products set fixture=true where id='blush-duo'")
  await assert.rejects(rpc(db, 'commerce_cod_checkout', args()), /PRODUCT_UNAVAILABLE/)
  assert.equal((await db.query('select count(*)::int n from commerce.orders')).rows[0].n, 0)
})

test('delivery settings and COD order RPC remain private to the server', async () => {
  await db.exec('set role anon')
  try {
    await assert.rejects(db.query('select * from commerce.delivery_areas'), /permission denied/)
    await assert.rejects(rpc(db, 'commerce_cod_quote', { p_area: 'dubai', p_items: args().p_items }), /permission denied/)
    await assert.rejects(rpc(db, 'commerce_cod_checkout', args()), /permission denied/)
  } finally { await db.exec('reset role') }
})

test('COD locks server prices, shipping, stock and idempotent order totals', async () => {
  const input = args()
  const quote = await rpc(db, 'commerce_cod_quote', { p_area: 'dubai', p_items: input.p_items })
  assert.equal(quote.total_minor, input.p_expected_total)
  await assert.rejects(rpc(db, 'commerce_cod_checkout', { ...input, p_expected_total: 17900 }), /QUOTE_CHANGED/)
  const first = await rpc(db, 'commerce_cod_checkout', input)
  const replay = await rpc(db, 'commerce_cod_checkout', input)
  assert.equal(first.id, replay.id)
  assert.equal(first.payment_method, 'cod')
  assert.equal(first.status, 'cod_pending')
  assert.equal(first.total_minor, 18000)
  assert.equal(first.shipping_minor, 1500)
  assert.equal(first.test_mode, false)
  assert.equal(first.token_hash, undefined)
  assert.deepEqual(await stock(db), { stock_quantity: 19, reserved_quantity: 0 })
  await assert.rejects(rpc(db, 'commerce_cod_checkout', { ...input, p_request_hash: 'changed' }), /CHECKOUT_CONFLICT/)
  assert.equal(await rpc(db, 'commerce_order', { p_id: first.id, p_token_hash: 'b'.repeat(64) }), null)
})

test('two bag units waive delivery for one style or two, with an order snapshot', async () => {
  for (const items of [
    [{ id: 'blush-duo', quantity: 2 }],
    [{ id: 'blush-duo', quantity: 1 }, { id: 'lip-pair', quantity: 1 }],
  ]) {
    const quote = await rpc(db, 'commerce_cod_quote', { p_area: 'dubai', p_items: items })
    assert.equal(quote.shipping_minor, 0)
    assert.equal(quote.regular_shipping_minor, 1500)
    assert.equal(quote.shipping_offer_applied, true)
    const input = { ...args(), p_items: items, p_expected_total: quote.total_minor }
    await assert.rejects(rpc(db, 'commerce_cod_checkout', { ...input, p_expected_total: quote.total_minor + 1500 }), /QUOTE_CHANGED/)
    const order = await rpc(db, 'commerce_cod_checkout', input)
    assert.equal(order.shipping_minor, 0)
    assert.equal(order.shipping_offer_code, 'BUY_2_FREE_DELIVERY')
    assert.equal(order.total_minor, quote.total_minor)
    await rpc(db, 'commerce_admin', { p_actor: adminId, p_action: 'cod_cancel', p_data: { id: order.id } })
  }
  assert.equal((await db.query('select count(*)::int n from commerce.orders')).rows[0].n, 2)
})

test('admin can turn the offer off; old order totals stay fixed and public guests cannot change it', async () => {
  const items = [{ id: 'blush-duo', quantity: 2 }]
  const quote = await rpc(db, 'commerce_cod_quote', { p_area: 'dubai', p_items: items })
  const order = await rpc(db, 'commerce_cod_checkout', { ...args(), p_items: items, p_expected_total: quote.total_minor })
  await assert.rejects(rpc(db, 'commerce_admin', { p_actor: crypto.randomUUID(), p_action: 'shipping_offer', p_data: { enabled: false } }), /ADMIN_REQUIRED/)
  await assert.rejects(rpc(db, 'commerce_admin', { p_actor: adminId, p_action: 'shipping_offer', p_data: { enabled: 'false' } }), /INVALID_SHIPPING_OFFER/)
  await rpc(db, 'commerce_admin', { p_actor: adminId, p_action: 'shipping_offer', p_data: { enabled: false } })
  const changed = await rpc(db, 'commerce_cod_quote', { p_area: 'dubai', p_items: items })
  assert.equal(changed.shipping_minor, 1500)
  assert.equal(changed.shipping_offer_applied, false)
  const saved = await rpc(db, 'commerce_order', { p_id: order.id, p_token_hash: 'a'.repeat(64) })
  assert.equal(saved.shipping_minor, 0)
  assert.equal(saved.shipping_offer_code, 'BUY_2_FREE_DELIVERY')
})

test('COD cancellation restores stock once; collection and fulfillment need an admin', async () => {
  const first = await rpc(db, 'commerce_cod_checkout', args())
  await assert.rejects(rpc(db, 'commerce_admin', { p_actor: crypto.randomUUID(), p_action: 'cod_cancel', p_data: { id: first.id } }), /ADMIN_REQUIRED/)
  await rpc(db, 'commerce_admin', { p_actor: adminId, p_action: 'cod_cancel', p_data: { id: first.id } })
  await rpc(db, 'commerce_admin', { p_actor: adminId, p_action: 'cod_cancel', p_data: { id: first.id } })
  assert.deepEqual(await stock(db), { stock_quantity: 20, reserved_quantity: 0 })
  await assert.rejects(rpc(db, 'commerce_admin', { p_actor: adminId, p_action: 'cod_collect', p_data: { id: first.id, amount_minor: 18000 } }), /COD_COLLECTION_MISMATCH/)
  const second = await rpc(db, 'commerce_cod_checkout', args())
  await assert.rejects(rpc(db, 'commerce_admin', { p_actor: adminId, p_action: 'cod_collect', p_data: { id: second.id, amount_minor: 1 } }), /COD_COLLECTION_MISMATCH/)
  await rpc(db, 'commerce_admin', { p_actor: adminId, p_action: 'fulfill', p_data: { id: second.id } })
  await assert.rejects(rpc(db, 'commerce_admin', { p_actor: adminId, p_action: 'cod_cancel', p_data: { id: second.id } }), /COD_CANCELLATION_NOT_ALLOWED/)
  await rpc(db, 'commerce_admin', { p_actor: adminId, p_action: 'cod_collect', p_data: { id: second.id, amount_minor: 18000 } })
  await rpc(db, 'commerce_admin', { p_actor: adminId, p_action: 'cod_collect', p_data: { id: second.id, amount_minor: 18000 } })
  const saved = await rpc(db, 'commerce_order', { p_id: second.id, p_token_hash: 'a'.repeat(64) })
  assert.equal(saved.status, 'paid')
  assert.equal(saved.fulfillment, 'fulfilled')
  assert.equal((await stock(db)).stock_quantity, 19)
})
