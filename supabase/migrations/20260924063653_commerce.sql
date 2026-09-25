-- Custom commerce schema. No Medusa tables, data resets or production fixtures.
create schema commerce;
revoke all on schema commerce from public, anon, authenticated;

create table commerce.settings (
  singleton boolean primary key default true check (singleton),
  currency text not null default 'AED' check (currency = 'AED'),
  checkout_enabled boolean not null default false,
  fixture_mode boolean not null default true,
  shipping_minor integer check (shipping_minor >= 0),
  free_shipping_threshold_minor integer check (free_shipping_threshold_minor >= 0),
  tax_basis_points integer check (tax_basis_points between 0 and 10000),
  allowed_countries text[] not null default '{}'
);
insert into commerce.settings(singleton) values(true);

create table commerce.products (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  name text not null check (length(name) between 1 and 160),
  description text not null default '' check (length(description) <= 2000),
  category text not null check (category in ('face','lips','eyes')),
  price_minor integer not null check (price_minor between 1 and 100000000),
  image text not null default '',
  badge text not null default '',
  swatches jsonb not null default '[]' check (jsonb_typeof(swatches) = 'array'),
  active boolean not null default false,
  fixture boolean not null default true,
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  reserved_quantity integer not null default 0 check (reserved_quantity between 0 and stock_quantity),
  updated_at timestamptz not null default now()
);
create table commerce.admins (
  user_id uuid primary key references auth.users(id),
  created_at timestamptz not null default now()
);
create table commerce.orders (
  id uuid primary key default gen_random_uuid(),
  request_key uuid not null unique,
  token_hash text not null check (token_hash ~ '^[a-f0-9]{64}$'),
  request_hash text not null,
  customer jsonb not null,
  status text not null default 'pending' check (status in ('pending','paid','failed','canceled','expired','review')),
  fulfillment text not null default 'unfulfilled' check (fulfillment in ('unfulfilled','fulfilled')),
  currency text not null default 'AED' check (currency = 'AED'),
  subtotal_minor integer not null,
  shipping_minor integer not null,
  tax_minor integer not null,
  total_minor integer not null check (total_minor between 200 and 100000000),
  test_mode boolean not null default true check(test_mode),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 minutes',
  reservation_released boolean not null default false,
  payment_started boolean not null default false,
  payment_intent_id text unique,
  payment_url text,
  payment_status text,
  paid_at timestamptz,
  last_verification_at timestamptz,
  updated_at timestamptz not null default now()
);
create table commerce.order_items (
  order_id uuid not null references commerce.orders(id),
  product_id text not null references commerce.products(id),
  name text not null,
  unit_price_minor integer not null,
  quantity integer not null check (quantity between 1 and 20),
  primary key(order_id, product_id)
);
create index orders_pending_idx on commerce.orders(created_at) where status in ('pending','review');
create index order_items_product_idx on commerce.order_items(product_id);
create table commerce.payment_events (
  event_key text primary key,
  intent_id text not null,
  processed_at timestamptz,
  attempts integer not null default 0,
  retry_at timestamptz not null default now(),
  received_at timestamptz not null default now()
);
create index payment_events_pending_idx on commerce.payment_events(received_at) where processed_at is null;
create table commerce.audit_log (
  id bigint generated always as identity primary key,
  actor uuid,
  action text not null,
  entity text not null,
  created_at timestamptz not null default now()
);
create table commerce.rate_limits (
  key text primary key,
  hits integer not null,
  resets_at timestamptz not null
);

-- Tables are private and RLS-enabled with no direct browser policies.
alter table commerce.settings enable row level security;
alter table commerce.products enable row level security;
alter table commerce.admins enable row level security;
alter table commerce.orders enable row level security;
alter table commerce.order_items enable row level security;
alter table commerce.payment_events enable row level security;
alter table commerce.audit_log enable row level security;
alter table commerce.rate_limits enable row level security;
revoke all on all tables in schema commerce from public, anon, authenticated;
revoke all on all sequences in schema commerce from public, anon, authenticated;

create function public.commerce_catalog() returns jsonb language sql stable security definer set search_path = '' as $$
select jsonb_build_object(
 'currency','AED', 'fixture_mode',s.fixture_mode,
 'checkout_enabled',s.checkout_enabled,
 'products',coalesce((select jsonb_agg(jsonb_build_object(
 'id',p.id,'name',p.name,'description',p.description,'category',p.category,
 'price_minor',p.price_minor,'image',p.image,'badge',p.badge,'swatches',p.swatches,
 'available',p.stock_quantity > p.reserved_quantity,'fixture',p.fixture) order by p.id)
 from commerce.products p where p.active), '[]'::jsonb))
from commerce.settings s where s.singleton;
$$;

create function public.commerce_rate_limit(p_key text, p_max integer, p_seconds integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
 insert into commerce.rate_limits as r(key,hits,resets_at) values(p_key,1,now()+make_interval(secs=>p_seconds))
 on conflict(key) do update set
 hits=case when r.resets_at<=now() then 1 else r.hits+1 end,
 resets_at=case when r.resets_at<=now() then now()+make_interval(secs=>p_seconds) else r.resets_at end
 returning hits into n;
 return n<=p_max;
end;
$$;

create function public.commerce_checkout(p_key uuid,p_token_hash text,p_request_hash text,p_customer jsonb,p_items jsonb)
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
  insert into commerce.order_items values(o.id,p.id,p.name,p.price_minor,i.qty);
  update commerce.products set reserved_quantity=reserved_quantity+i.qty,updated_at=now() where id=p.id;
 end loop;
 return to_jsonb(o)-'token_hash'-'request_hash';
end;
$$;

create function public.commerce_order(p_id uuid,p_token_hash text) returns jsonb language sql stable security definer set search_path = '' as $$
select (to_jsonb(o)-'token_hash'-'request_hash') || jsonb_build_object('items',
 (select coalesce(jsonb_agg(to_jsonb(i)),'[]'::jsonb) from commerce.order_items i where i.order_id=o.id))
from commerce.orders o where o.id=p_id and o.token_hash=p_token_hash;
$$;

create function public.commerce_claim_payment(p_id uuid) returns boolean language plpgsql security definer set search_path = '' as $$
begin
 update commerce.orders set payment_started=true,updated_at=now()
 where id=p_id and not payment_started and status='pending' and expires_at>now();
 return found;
end;
$$;

create function public.commerce_payment_order(p_intent text,p_id uuid default null) returns jsonb language sql stable security definer set search_path = '' as $$
select to_jsonb(o)-'token_hash'-'request_hash' from commerce.orders o
where o.payment_intent_id=p_intent or (o.id=p_id and o.payment_started and o.payment_intent_id is null) limit 1;
$$;

create function public.commerce_bind_payment(p_id uuid,p_intent text,p_url text) returns void language plpgsql security definer set search_path = '' as $$
begin
 update commerce.orders set payment_intent_id=p_intent,payment_url=p_url,updated_at=now()
 where id=p_id and payment_started and (payment_intent_id is null or payment_intent_id=p_intent);
 if not found then raise exception 'PAYMENT_CONFLICT'; end if;
end;
$$;

create function public.commerce_apply_payment(p_id uuid,p_intent text,p_status text,p_amount integer,p_currency text,p_event_key text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o commerce.orders%rowtype; i record;
begin
 select * into o from commerce.orders where id=p_id for update;
 if not found or not o.payment_started or o.payment_intent_id is distinct from p_intent
 or o.total_minor<>p_amount or o.currency<>p_currency then raise exception 'PAYMENT_MISMATCH'; end if;
 if p_status not in ('completed','failed','canceled','pending','requires_user_action','requires_payment_instrument') then raise exception 'INVALID_PAYMENT_STATUS'; end if;
 if o.status='paid' then
  -- A stale provider response must never undo payment or deduct inventory twice.
  null;
 elsif p_status='completed' then
  if o.reservation_released then
   -- Late payment after terminal failure requires manual refund/stock review.
   update commerce.orders set status='review',payment_status=p_status,updated_at=now() where id=o.id;
  else
   for i in select * from commerce.order_items where order_id=o.id order by product_id loop
    update commerce.products set stock_quantity=stock_quantity-i.quantity,reserved_quantity=reserved_quantity-i.quantity,updated_at=now() where id=i.product_id;
   end loop;
   update commerce.orders set status='paid',payment_status=p_status,reservation_released=true,paid_at=now(),updated_at=now() where id=o.id;
  end if;
 elsif p_status in ('failed','canceled') then
  if not o.reservation_released then
   for i in select * from commerce.order_items where order_id=o.id order by product_id loop
    update commerce.products set reserved_quantity=reserved_quantity-i.quantity,updated_at=now() where id=i.product_id;
   end loop;
  end if;
  update commerce.orders set status=p_status,payment_status=p_status,reservation_released=true,updated_at=now() where id=o.id and status<>'review';
 elsif o.status='pending' then
  update commerce.orders set payment_status=p_status,updated_at=now() where id=o.id;
 end if;
 update commerce.orders set last_verification_at=now() where id=p_id;
 if p_event_key is not null then update commerce.payment_events set processed_at=now() where event_key=p_event_key; end if;
 select * into o from commerce.orders where id=p_id;
 return jsonb_build_object('id',o.id,'status',o.status,'payment_status',o.payment_status);
end;
$$;

create function public.commerce_event(p_key text,p_intent text) returns boolean language plpgsql security definer set search_path = '' as $$
declare done timestamptz;
begin
 insert into commerce.payment_events(event_key,intent_id) values(p_key,p_intent) on conflict do nothing;
 select processed_at into done from commerce.payment_events where event_key=p_key;
 return done is null;
end;
$$;

create function public.commerce_reconcile_failure(p_event_key text,p_intent text) returns void language plpgsql security definer set search_path = '' as $$
begin
 if p_event_key is not null then
  update commerce.payment_events set attempts=attempts+1,retry_at=now()+make_interval(secs=>least(3600,power(2,least(attempts+1,12))::integer)) where event_key=p_event_key and processed_at is null;
 end if;
 update commerce.orders set last_verification_at=now() where payment_intent_id=p_intent;
end;
$$;

create function public.commerce_reconcile_batch() returns jsonb language plpgsql security definer set search_path = '' as $$
declare o record; i record;
begin
 -- Only release never-submitted checkouts. Ambiguous external calls retain stock for review.
 for o in select * from commerce.orders where status='pending' and not payment_started and expires_at<now() order by id for update skip locked limit 50 loop
  for i in select * from commerce.order_items where order_id=o.id order by product_id loop
   update commerce.products set reserved_quantity=reserved_quantity-i.quantity where id=i.product_id;
  end loop;
  update commerce.orders set status='expired',reservation_released=true,updated_at=now() where id=o.id;
 end loop;
 delete from commerce.rate_limits where resets_at<now()-interval '1 day';
 return jsonb_build_object('orders',(select coalesce(jsonb_agg(x),'[]'::jsonb) from
 (select id,payment_intent_id from commerce.orders where status in ('pending','review') and payment_intent_id is not null order by coalesce(last_verification_at,created_at) limit 25) x),
 'events',(select coalesce(jsonb_agg(x),'[]'::jsonb) from
 (select event_key,intent_id from commerce.payment_events where processed_at is null and attempts<10 and retry_at<=now() order by received_at limit 25) x));
end;
$$;

create function public.commerce_admin(p_actor uuid,p_action text,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path = '' as $$
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
  insert into commerce.products(id,name,description,category,price_minor,image,badge,swatches,active,fixture,stock_quantity)
  values(p_data->>'id',p_data->>'name',p_data->>'description',p_data->>'category',(p_data->>'price_minor')::integer,
   p_data->>'image',p_data->>'badge',p_data->'swatches',(p_data->>'active')::boolean,true,(p_data->>'stock_quantity')::integer)
  on conflict(id) do update set name=excluded.name,description=excluded.description,category=excluded.category,
   price_minor=excluded.price_minor,image=excluded.image,badge=excluded.badge,swatches=excluded.swatches,
   active=excluded.active,stock_quantity=excluded.stock_quantity,updated_at=now();
 elsif p_action='fulfill' then
  update commerce.orders set fulfillment='fulfilled',updated_at=now() where id=(p_data->>'id')::uuid and status='paid';
  if not found then raise exception 'PAID_ORDER_REQUIRED'; end if;
 else raise exception 'INVALID_ADMIN_ACTION';
 end if;
 insert into commerce.audit_log(actor,action,entity) values(p_actor,p_action,p_data->>'id');
 return jsonb_build_object('ok',true);
end;
$$;

-- Every commerce RPC defaults to private. Only the catalog is browser-readable.
do $$ declare f record; begin
 for f in select p.oid::regprocedure as name from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname like 'commerce\_%' escape '\' loop
 execute format('revoke all on function %s from public, anon, authenticated',f.name);
 execute format('grant execute on function %s to service_role',f.name);
 end loop;
end $$;
grant execute on function public.commerce_catalog() to anon, authenticated;
