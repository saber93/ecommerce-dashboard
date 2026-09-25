import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateProduct} from '../supabase/functions/_shared/security.mjs';
const product={id:'test-bag',name:'Test bag',description:'',category:'face',price_minor:100,stock_quantity:0,active:false,image:'./assets/bag-rose.png',badge:'',swatches:[]};
test('Arabic product fields are validated without silently removing old translations',()=>{
 assert.equal(Object.hasOwn(validateProduct(product),'name_ar'),false);
 assert.equal(validateProduct({...product,name_ar:'  حقيبة  '}).name_ar,'حقيبة');
 assert.throws(()=>validateProduct({...product,name_ar:123}));
 assert.throws(()=>validateProduct({...product,description_ar:'أ'.repeat(2001)}));
 assert.throws(()=>validateProduct({...product,badge_ar:'أ'.repeat(81)}));
});

test('Arabic migration preserves an existing catalog and pending order', async()=>{
 const {PGlite}=await import('@electric-sql/pglite');
 const {readFile}=await import('node:fs/promises');
 const db=new PGlite();
 try {
  await db.exec('create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);');
  await db.exec(await readFile(new URL('../supabase/migrations/20260924063653_commerce.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../supabase/fixtures/development.sql',import.meta.url),'utf8'));
  const {rpc,checkoutArgs}=await import('./helpers.mjs');
  const order=await rpc(db,'commerce_checkout',checkoutArgs());
  const before=(await db.query('select id,name,price_minor,stock_quantity,reserved_quantity from commerce.products order by id')).rows;
  await db.exec(await readFile(new URL('../supabase/migrations/20260925024641_arabic_catalog.sql',import.meta.url),'utf8'));
  assert.deepEqual((await db.query('select id,name,price_minor,stock_quantity,reserved_quantity from commerce.products order by id')).rows,before);
  const after=await rpc(db,'commerce_order',{p_id:order.id,p_token_hash:'a'.repeat(64)});
  assert.equal(after.total_minor,order.total_minor);
  assert.equal(after.items[0].name_ar,'');
  assert.equal(after.items[0].quantity,1);
 } finally {await db.close();}
});
