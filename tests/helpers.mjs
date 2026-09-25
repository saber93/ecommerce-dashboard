import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
export const adminId = 'a0000000-0000-4000-8000-000000000001'
export const customer = {
  name: 'Test Customer',
  email: 'test@example.com',
  phone: '+971500000000',
  address: 'Development fixture address',
  city: 'Dubai',
  country: 'AE',
}
export async function database() {
  const db = new PGlite()
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);insert into auth.users values('${adminId}');`,
  )
  await db.exec(
    await readFile(
      new URL(
        '../supabase/migrations/20260924063653_commerce.sql',
        import.meta.url,
      ),
      'utf8',
    ),
  )
  await db.exec(await readFile(new URL('../supabase/migrations/20260925024641_arabic_catalog.sql', import.meta.url), 'utf8'))
  await db.exec(await readFile(new URL('../supabase/migrations/20260925032547_cash_on_delivery.sql', import.meta.url), 'utf8'))
  return db
}
export async function reset(db) {
  await db.exec(
    'truncate commerce.order_items,commerce.orders,commerce.payment_events,commerce.products,commerce.delivery_areas,commerce.rate_limits,commerce.audit_log,commerce.admins;',
  )
  await db.exec(
    await readFile(
      new URL('../supabase/fixtures/development.sql', import.meta.url),
      'utf8',
    ),
  )
  await db.query('insert into commerce.admins(user_id) values($1)', [adminId])
  await db.exec(await readFile(new URL('../supabase/fixtures/arabic.sql', import.meta.url), 'utf8'))
}
export async function rpc(db, name, args = {}) {
  const keys = Object.keys(args)
  const values = keys.map((k) =>
    args[k] !== null && typeof args[k] === 'object'
      ? JSON.stringify(args[k])
      : args[k],
  )
  const result = await db.query(
    `select public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(',')}) as value`,
    values,
  )
  return result.rows[0].value
}
export const checkoutArgs = (items = [{ id: 'blush-duo', quantity: 1 }]) => ({
  p_key: crypto.randomUUID(),
  p_token_hash: 'a'.repeat(64),
  p_request_hash: 'request',
  p_customer: customer,
  p_items: items,
})
export async function stock(db, id = 'blush-duo') {
  return (
    await db.query(
      'select stock_quantity,reserved_quantity from commerce.products where id=$1',
      [id],
    )
  ).rows[0]
}
