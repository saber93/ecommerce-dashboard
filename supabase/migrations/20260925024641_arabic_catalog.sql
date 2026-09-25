-- Add Arabic catalog content without changing existing product IDs, stock or prices.
alter table commerce.products
 add column name_ar text not null default '' check(length(name_ar) <= 160),
 add column description_ar text not null default '' check(length(description_ar) <= 2000),
 add column badge_ar text not null default '' check(length(badge_ar) <= 80);
-- Preserve the Arabic name as sold, independently of future catalog edits.
alter table commerce.order_items add column name_ar text not null default '' check(length(name_ar) <= 160);


create or replace function public.commerce_catalog() returns jsonb language sql stable security definer set search_path = '' as $$
select jsonb_build_object(
 'currency','AED', 'fixture_mode',s.fixture_mode,
 'checkout_enabled',s.checkout_enabled,
 'products',coalesce((select jsonb_agg(jsonb_build_object(
 'id',p.id,'name',p.name,'description',p.description,'category',p.category,
 'name_ar',p.name_ar,'description_ar',p.description_ar,'badge_ar',p.badge_ar,
 'price_minor',p.price_minor,'image',p.image,'badge',p.badge,'swatches',p.swatches,
 'available',p.stock_quantity > p.reserved_quantity,'fixture',p.fixture) order by p.id)
 from commerce.products p where p.active), '[]'::jsonb))
from commerce.settings s where s.singleton;
$$;

create or replace function public.commerce_checkout(p_key uuid,p_token_hash text,p_request_hash text,p_customer jsonb,p_items jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s commerce.settings%rowtype; o commerce.orders%rowtype; p commerce.products%rowtype;
i record; subtotal bigint := 0; shipping integer; tax integer; item_count integer;
begin
 -- Same request serializes without holding any network calls inside the transaction.
 perform pg_advisory_xact_lock(hashtextextended(p_key::text,0));
 select * into o from commerce.orders where request_key=p_key;
 if found then
  if o.token_hash<>p_token_hash or o.request_hash<>p_request_hash then raise exception 'CHECKOUT_CONFLICT'; end if;
  return to_jsonb(o)-'token_hash'-'request_hash';
 end if;
 select * into s from commerce.settings where singleton;
 if not s.checkout_enabled or not s.fixture_mode or s.shipping_minor is null or s.tax_basis_points is null then
  raise exception 'CHECKOUT_NOT_CONFIGURED';
 end if;
 if not coalesce(p_customer->>'country'=any(s.allowed_countries),false) then raise exception 'DELIVERY_UNAVAILABLE'; end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 20 then raise exception 'INVALID_ITEMS'; end if;
 select count(distinct item->>'id') into item_count from jsonb_array_elements(p_items) item;
 if item_count<>jsonb_array_length(p_items) then raise exception 'DUPLICATE_ITEMS'; end if;
 -- Every inventory mutation acquires product locks in the same order.
 for i in select item->>'id' as id,(item->>'quantity')::integer as qty from jsonb_array_elements(p_items) item order by item->>'id' loop
  if i.qty is null or i.qty not between 1 and 20 then raise exception 'INVALID_QUANTITY'; end if;
  select * into p from commerce.products where id=i.id for update;
  if not found or not p.active or not p.fixture then raise exception 'PRODUCT_UNAVAILABLE'; end if;
  if p.stock_quantity-p.reserved_quantity<i.qty then raise exception 'OUT_OF_STOCK'; end if;
  subtotal := subtotal+p.price_minor::bigint*i.qty;
 end loop;
 shipping:=case when s.free_shipping_threshold_minor is not null and subtotal>=s.free_shipping_threshold_minor then 0 else s.shipping_minor end;
 tax:=round((subtotal+shipping)*s.tax_basis_points/10000.0);
 if subtotal+shipping+tax not between 200 and 100000000 then raise exception 'INVALID_TOTAL'; end if;
 insert into commerce.orders(request_key,token_hash,request_hash,customer,subtotal_minor,shipping_minor,tax_minor,total_minor)
 values(p_key,p_token_hash,p_request_hash,p_customer,subtotal,shipping,tax,subtotal+shipping+tax) returning * into o;
 for i in select item->>'id' as id,(item->>'quantity')::integer as qty from jsonb_array_elements(p_items) item order by item->>'id' loop
  select * into p from commerce.products where id=i.id;
  insert into commerce.order_items(order_id,product_id,name,unit_price_minor,quantity,name_ar) values(o.id,p.id,p.name,p.price_minor,i.qty,p.name_ar);
  update commerce.products set reserved_quantity=reserved_quantity+i.qty,updated_at=now() where id=p.id;
 end loop;
 return to_jsonb(o)-'token_hash'-'request_hash';
end;
$$;

create or replace function public.commerce_admin(p_actor uuid,p_action text,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
 if not exists(select 1 from commerce.admins where user_id=p_actor) then raise exception 'ADMIN_REQUIRED'; end if;
 if p_action='list' then
  return jsonb_build_object('products',(select coalesce(jsonb_agg(p order by p.id),'[]'::jsonb) from commerce.products p),
   'orders',(select coalesce(jsonb_agg(o),'[]'::jsonb) from
    (select id,status,fulfillment,customer,total_minor,currency,payment_intent_id,payment_status,payment_started,created_at from commerce.orders order by created_at desc limit 100) o),
   'unprocessed_events',(select count(*) from commerce.payment_events where processed_at is null),
   'settings',(select to_jsonb(s) from commerce.settings s where singleton));
 elsif p_action='order' then
  select (to_jsonb(o)-'token_hash'-'request_hash') || jsonb_build_object('items',
  (select jsonb_agg(i) from commerce.order_items i where order_id=o.id)) into result from commerce.orders o where id=(p_data->>'id')::uuid;
  return result;
 elsif p_action='product' then
  insert into commerce.products as existing(id,name,description,category,price_minor,image,badge,swatches,active,fixture,stock_quantity,name_ar,description_ar,badge_ar)
  values(p_data->>'id',p_data->>'name',p_data->>'description',p_data->>'category',(p_data->>'price_minor')::integer,
   p_data->>'image',p_data->>'badge',p_data->'swatches',(p_data->>'active')::boolean,true,(p_data->>'stock_quantity')::integer,coalesce(p_data->>'name_ar',''),coalesce(p_data->>'description_ar',''),coalesce(p_data->>'badge_ar',''))
  on conflict(id) do update set name=excluded.name,description=excluded.description,category=excluded.category,
   price_minor=excluded.price_minor,image=excluded.image,badge=excluded.badge,swatches=excluded.swatches,
   active=excluded.active,stock_quantity=excluded.stock_quantity,updated_at=now(),
   name_ar=case when p_data ? 'name_ar' then excluded.name_ar else existing.name_ar end,
   description_ar=case when p_data ? 'description_ar' then excluded.description_ar else existing.description_ar end,
   badge_ar=case when p_data ? 'badge_ar' then excluded.badge_ar else existing.badge_ar end;
 elsif p_action='fulfill' then
  update commerce.orders set fulfillment='fulfilled',updated_at=now() where id=(p_data->>'id')::uuid and status='paid';
  if not found then raise exception 'PAID_ORDER_REQUIRED'; end if;
 else raise exception 'INVALID_ADMIN_ACTION';
 end if;
 insert into commerce.audit_log(actor,action,entity) values(p_actor,p_action,p_data->>'id');
 return jsonb_build_object('ok',true);
end;
$$;

-- CREATE OR REPLACE retains existing RPC grants; private table access is unchanged.
