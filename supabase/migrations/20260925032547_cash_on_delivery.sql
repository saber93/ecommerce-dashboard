-- Cash on delivery is a separate, disabled production path. This migration
-- changes no existing orders, product prices, stock, or business settings.
alter table commerce.settings add column cod_enabled boolean not null default false;

create table commerce.delivery_areas (
  code text primary key check (code ~ '^[a-z][a-z0-9-]{1,39}$'),
  name_en text not null check (length(name_en) between 2 and 100),
  name_ar text not null check (length(name_ar) between 2 and 100),
  shipping_minor integer not null check (shipping_minor >= 0),
  days_min integer not null check (days_min between 1 and 60),
  days_max integer not null check (days_max between days_min and 60),
  active boolean not null default false
);
alter table commerce.delivery_areas enable row level security;
revoke all on commerce.delivery_areas from public, anon, authenticated;

alter table commerce.orders add column payment_method text not null default 'ziina'
  check (payment_method in ('ziina','cod'));
alter table commerce.orders drop constraint if exists orders_status_check;
alter table commerce.orders add constraint orders_status_check
  check (status in ('pending','cod_pending','paid','failed','canceled','expired','review'));
alter table commerce.orders drop constraint if exists orders_test_mode_check;
alter table commerce.orders add constraint orders_payment_mode_check
  check (payment_method = 'cod' or test_mode);

create or replace function public.commerce_catalog() returns jsonb language sql stable security definer set search_path = '' as $$
select jsonb_build_object(
 'currency','AED', 'fixture_mode',s.fixture_mode,
 'checkout_enabled',s.checkout_enabled,
 'cod_enabled',s.cod_enabled and not s.fixture_mode,
 'delivery_areas',coalesce((select jsonb_agg(jsonb_build_object(
   'code',a.code,'name_en',a.name_en,'name_ar',a.name_ar,
   'shipping_minor',a.shipping_minor,'days_min',a.days_min,'days_max',a.days_max) order by a.name_en)
   from commerce.delivery_areas a where a.active), '[]'::jsonb),
 'products',coalesce((select jsonb_agg(jsonb_build_object(
   'id',p.id,'name',p.name,'description',p.description,'category',p.category,
   'name_ar',p.name_ar,'description_ar',p.description_ar,'badge_ar',p.badge_ar,
   'price_minor',p.price_minor,'image',p.image,'badge',p.badge,'swatches',p.swatches,
   'available',p.stock_quantity > p.reserved_quantity,'fixture',p.fixture) order by p.id)
   from commerce.products p where p.active), '[]'::jsonb))
from commerce.settings s where s.singleton;
$$;

create function public.commerce_cod_quote(p_area text,p_items jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare s commerce.settings%rowtype; a commerce.delivery_areas%rowtype; p commerce.products%rowtype;
 i record; subtotal bigint := 0; shipping integer; tax integer; item_count integer;
begin
 select * into s from commerce.settings where singleton;
 if not s.cod_enabled or s.fixture_mode or s.tax_basis_points is null or not ('AE'=any(s.allowed_countries)) then raise exception 'COD_NOT_CONFIGURED'; end if;
 select * into a from commerce.delivery_areas where code=p_area and active;
 if not found then raise exception 'DELIVERY_UNAVAILABLE'; end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 20 then raise exception 'INVALID_ITEMS'; end if;
 select count(distinct item->>'id') into item_count from jsonb_array_elements(p_items) item;
 if item_count<>jsonb_array_length(p_items) then raise exception 'DUPLICATE_ITEMS'; end if;
 for i in select item->>'id' as id,(item->>'quantity')::integer as qty from jsonb_array_elements(p_items) item order by item->>'id' loop
  if i.qty is null or i.qty not between 1 and 20 then raise exception 'INVALID_QUANTITY'; end if;
  select * into p from commerce.products where id=i.id;
  if not found or not p.active or p.fixture then raise exception 'PRODUCT_UNAVAILABLE'; end if;
  if p.stock_quantity-p.reserved_quantity<i.qty then raise exception 'OUT_OF_STOCK'; end if;
  subtotal := subtotal+p.price_minor::bigint*i.qty;
 end loop;
 shipping:=case when s.free_shipping_threshold_minor is not null and subtotal>=s.free_shipping_threshold_minor then 0 else a.shipping_minor end;
 tax:=round((subtotal+shipping)*s.tax_basis_points/10000.0);
 if subtotal+shipping+tax not between 200 and 100000000 then raise exception 'INVALID_TOTAL'; end if;
 return jsonb_build_object('currency','AED','subtotal_minor',subtotal,'shipping_minor',shipping,
  'tax_minor',tax,'total_minor',subtotal+shipping+tax,'days_min',a.days_min,'days_max',a.days_max);
end;
$$;

create function public.commerce_cod_checkout(p_key uuid,p_token_hash text,p_request_hash text,p_customer jsonb,p_items jsonb,p_expected_total integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s commerce.settings%rowtype; o commerce.orders%rowtype; p commerce.products%rowtype;
 a commerce.delivery_areas%rowtype; i record; subtotal bigint := 0; shipping integer; tax integer; item_count integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_key::text,0));
 select * into o from commerce.orders where request_key=p_key;
 if found then
  if o.payment_method <> 'cod' or o.token_hash<>p_token_hash or o.request_hash<>p_request_hash then raise exception 'CHECKOUT_CONFLICT'; end if;
  return to_jsonb(o)-'token_hash'-'request_hash';
 end if;
 select * into s from commerce.settings where singleton;
 if not s.cod_enabled or s.fixture_mode or s.tax_basis_points is null then raise exception 'COD_NOT_CONFIGURED'; end if;
 if not coalesce(p_customer->>'country'=any(s.allowed_countries),false) then raise exception 'DELIVERY_UNAVAILABLE'; end if;
 select * into a from commerce.delivery_areas where code=p_customer->>'emirate' and active;
 if not found then raise exception 'DELIVERY_UNAVAILABLE'; end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 20 then raise exception 'INVALID_ITEMS'; end if;
 select count(distinct item->>'id') into item_count from jsonb_array_elements(p_items) item;
 if item_count<>jsonb_array_length(p_items) then raise exception 'DUPLICATE_ITEMS'; end if;
 -- Lock products in a stable order, and commit the entire order and stock change together.
 for i in select item->>'id' as id,(item->>'quantity')::integer as qty from jsonb_array_elements(p_items) item order by item->>'id' loop
  if i.qty is null or i.qty not between 1 and 20 then raise exception 'INVALID_QUANTITY'; end if;
  select * into p from commerce.products where id=i.id for update;
  if not found or not p.active or p.fixture then raise exception 'PRODUCT_UNAVAILABLE'; end if;
  if p.stock_quantity-p.reserved_quantity<i.qty then raise exception 'OUT_OF_STOCK'; end if;
  subtotal := subtotal+p.price_minor::bigint*i.qty;
 end loop;
 shipping:=case when s.free_shipping_threshold_minor is not null and subtotal>=s.free_shipping_threshold_minor then 0 else a.shipping_minor end;
 tax:=round((subtotal+shipping)*s.tax_basis_points/10000.0);
 if subtotal+shipping+tax not between 200 and 100000000 then raise exception 'INVALID_TOTAL'; end if;
 if p_expected_total is distinct from subtotal+shipping+tax then raise exception 'QUOTE_CHANGED'; end if;
 insert into commerce.orders(request_key,token_hash,request_hash,customer,status,payment_method,payment_status,
  subtotal_minor,shipping_minor,tax_minor,total_minor,test_mode,reservation_released)
 values(p_key,p_token_hash,p_request_hash,p_customer,'cod_pending','cod','cash_due',
  subtotal,shipping,tax,subtotal+shipping+tax,false,true) returning * into o;
 for i in select item->>'id' as id,(item->>'quantity')::integer as qty from jsonb_array_elements(p_items) item order by item->>'id' loop
  select * into p from commerce.products where id=i.id;
  insert into commerce.order_items(order_id,product_id,name,unit_price_minor,quantity,name_ar)
   values(o.id,p.id,p.name,p.price_minor,i.qty,p.name_ar);
  update commerce.products set stock_quantity=stock_quantity-i.qty,updated_at=now() where id=p.id;
 end loop;
 return to_jsonb(o)-'token_hash'-'request_hash';
end;
$$;

create or replace function public.commerce_admin(p_actor uuid,p_action text,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb; cod_order commerce.orders%rowtype; i record;
begin
 if not exists(select 1 from commerce.admins where user_id=p_actor) then raise exception 'ADMIN_REQUIRED'; end if;
 if p_action='list' then
  return jsonb_build_object('products',(select coalesce(jsonb_agg(p order by p.id),'[]'::jsonb) from commerce.products p),
   'orders',(select coalesce(jsonb_agg(o),'[]'::jsonb) from
    (select id,status,fulfillment,customer,total_minor,currency,payment_method,payment_intent_id,payment_status,payment_started,created_at from commerce.orders order by created_at desc limit 100) o),
   'unprocessed_events',(select count(*) from commerce.payment_events where processed_at is null),
   'settings',(select to_jsonb(s) from commerce.settings s where singleton),
   'delivery_areas',(select coalesce(jsonb_agg(a order by a.name_en),'[]'::jsonb) from commerce.delivery_areas a));
 elsif p_action='order' then
  select (to_jsonb(o)-'token_hash'-'request_hash') || jsonb_build_object('items',
  (select jsonb_agg(i) from commerce.order_items i where i.order_id=o.id)) into result from commerce.orders o where id=(p_data->>'id')::uuid;
  return result;
 elsif p_action='product' then
  insert into commerce.products as existing(id,name,description,category,price_minor,image,badge,swatches,active,fixture,stock_quantity,name_ar,description_ar,badge_ar)
  values(p_data->>'id',p_data->>'name',p_data->>'description',p_data->>'category',(p_data->>'price_minor')::integer,
   p_data->>'image',p_data->>'badge',p_data->'swatches',(p_data->>'active')::boolean,
   (select fixture_mode from commerce.settings where singleton),(p_data->>'stock_quantity')::integer,
   coalesce(p_data->>'name_ar',''),coalesce(p_data->>'description_ar',''),coalesce(p_data->>'badge_ar',''))
  on conflict(id) do update set name=excluded.name,description=excluded.description,category=excluded.category,
   price_minor=excluded.price_minor,image=excluded.image,badge=excluded.badge,swatches=excluded.swatches,
   active=excluded.active,stock_quantity=excluded.stock_quantity,updated_at=now(),
   name_ar=case when p_data ? 'name_ar' then excluded.name_ar else existing.name_ar end,
   description_ar=case when p_data ? 'description_ar' then excluded.description_ar else existing.description_ar end,
   badge_ar=case when p_data ? 'badge_ar' then excluded.badge_ar else existing.badge_ar end;
 elsif p_action='fulfill' then
  update commerce.orders set fulfillment='fulfilled',updated_at=now()
   where id=(p_data->>'id')::uuid and (status='paid' or (status='cod_pending' and payment_method='cod')) and fulfillment='unfulfilled';
  if not found then raise exception 'PAID_ORDER_REQUIRED'; end if;
 elsif p_action='cod_collect' then
  select * into cod_order from commerce.orders where id=(p_data->>'id')::uuid for update;
  if not found or cod_order.payment_method<>'cod' or (p_data->>'amount_minor')::integer is distinct from cod_order.total_minor then raise exception 'COD_COLLECTION_MISMATCH'; end if;
  if cod_order.status='cod_pending' then
   update commerce.orders set status='paid',payment_status='cash_collected',paid_at=now(),updated_at=now() where id=cod_order.id;
  elsif cod_order.status<>'paid' then raise exception 'COD_COLLECTION_MISMATCH'; end if;
 elsif p_action='cod_cancel' then
  select * into cod_order from commerce.orders where id=(p_data->>'id')::uuid for update;
  if not found or cod_order.payment_method<>'cod' then raise exception 'COD_CANCELLATION_NOT_ALLOWED'; end if;
  if cod_order.status='cod_pending' and cod_order.fulfillment='unfulfilled' then
   for i in select * from commerce.order_items where order_id=cod_order.id order by product_id loop
    update commerce.products set stock_quantity=stock_quantity+i.quantity,updated_at=now() where id=i.product_id;
   end loop;
   update commerce.orders set status='canceled',payment_status='canceled',updated_at=now() where id=cod_order.id;
  elsif cod_order.status<>'canceled' then raise exception 'COD_CANCELLATION_NOT_ALLOWED'; end if;
 else raise exception 'INVALID_ADMIN_ACTION';
 end if;
 insert into commerce.audit_log(actor,action,entity) values(p_actor,p_action,p_data->>'id');
 return jsonb_build_object('ok',true);
end;
$$;

revoke all on function public.commerce_cod_quote(text,jsonb) from public, anon, authenticated;
revoke all on function public.commerce_cod_checkout(uuid,text,text,jsonb,jsonb,integer) from public, anon, authenticated;
grant execute on function public.commerce_cod_quote(text,jsonb) to service_role;
grant execute on function public.commerce_cod_checkout(uuid,text,text,jsonb,jsonb,integer) to service_role;
