-- Editorial catalog fields. Existing IDs, prices, stock and orders are preserved.
-- Promotional shipping remains a concept; this migration changes no checkout totals.
alter table commerce.products
 add column collections text[] not null default '{}' check (collections <@ array['work','evening','weekend','gifts']::text[] and cardinality(collections) <= 4),
 add column gallery jsonb not null default '[]' check (jsonb_typeof(gallery)='array' and jsonb_array_length(gallery) <= 8),
 add column fits_inside_en text not null default '' check (length(fits_inside_en) <= 300),
 add column fits_inside_ar text not null default '' check (length(fits_inside_ar) <= 300),
 add column styling_en text not null default '' check (length(styling_en) <= 400),
 add column styling_ar text not null default '' check (length(styling_ar) <= 400),
 add column dimensions_cm text not null default '' check (length(dimensions_cm) <= 100),
 add column limited_edition boolean not null default false,
 add column edition_size integer check (edition_size between 1 and 1000000),
 add column photo_verified boolean not null default false,
 add column pair_product_id text references commerce.products(id),
 add constraint limited_edition_size_required check (not limited_edition or edition_size is not null),
 add constraint pair_not_self check (pair_product_id is null or pair_product_id <> id);
create index products_collections_idx on commerce.products using gin (collections) where active;
-- Curated preview assignments based on each existing fixture's shape and description.
update commerce.products set collections=case id
 when 'blush-duo' then array['work','gifts']
 when 'lip-pair' then array['evening','gifts']
 when 'eye-palette' then array['work','weekend']
 when 'highlighter' then array['evening','gifts']
 when 'lip-liner' then array['weekend','evening']
 when 'eye-sticks' then array['weekend','work']
 else collections end,
 badge=case when badge in ('BEST SELLER','ONLINE EXCLUSIVE','NEW') then '' else badge end,
 badge_ar=case when badge in ('BEST SELLER','ONLINE EXCLUSIVE','NEW') then '' else badge_ar end
 where fixture and id in ('blush-duo','lip-pair','eye-palette','highlighter','lip-liner','eye-sticks');
update commerce.products set pair_product_id='highlighter' where id='eye-palette' and fixture;

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
   'available',p.stock_quantity > p.reserved_quantity,'last_piece',p.stock_quantity-p.reserved_quantity=1,'fixture',p.fixture,
   'collections',p.collections,'gallery',p.gallery,'fits_inside_en',p.fits_inside_en,
   'fits_inside_ar',p.fits_inside_ar,'styling_en',p.styling_en,'styling_ar',p.styling_ar,
   'dimensions_cm',p.dimensions_cm,'limited_edition',p.limited_edition,
   'edition_size',p.edition_size,'pair_product_id',p.pair_product_id) order by p.id)
   from commerce.products p where p.active), '[]'::jsonb))
from commerce.settings s where s.singleton;
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
  insert into commerce.products as existing(id,name,description,category,price_minor,image,badge,swatches,active,fixture,stock_quantity,name_ar,description_ar,badge_ar,
   collections,gallery,fits_inside_en,fits_inside_ar,styling_en,styling_ar,dimensions_cm,limited_edition,edition_size,photo_verified,pair_product_id)
  values(p_data->>'id',p_data->>'name',p_data->>'description',p_data->>'category',(p_data->>'price_minor')::integer,
   p_data->>'image',p_data->>'badge',p_data->'swatches',(p_data->>'active')::boolean,
   not coalesce((p_data->>'photo_verified')::boolean,false),(p_data->>'stock_quantity')::integer,
   coalesce(p_data->>'name_ar',''),coalesce(p_data->>'description_ar',''),coalesce(p_data->>'badge_ar',''),
   coalesce(array(select jsonb_array_elements_text(p_data->'collections')), '{}'),coalesce(p_data->'gallery','[]'::jsonb),
   coalesce(p_data->>'fits_inside_en',''),coalesce(p_data->>'fits_inside_ar',''),
   coalesce(p_data->>'styling_en',''),coalesce(p_data->>'styling_ar',''),coalesce(p_data->>'dimensions_cm',''),
   coalesce((p_data->>'limited_edition')::boolean,false),(p_data->>'edition_size')::integer,
   coalesce((p_data->>'photo_verified')::boolean,false),nullif(p_data->>'pair_product_id',''))
  on conflict(id) do update set name=excluded.name,description=excluded.description,category=excluded.category,
   price_minor=excluded.price_minor,image=excluded.image,badge=excluded.badge,swatches=excluded.swatches,
   active=excluded.active,stock_quantity=excluded.stock_quantity,updated_at=now(),
   fixture=case when p_data ? 'photo_verified' then excluded.fixture else existing.fixture end,
   photo_verified=case when p_data ? 'photo_verified' then excluded.photo_verified else existing.photo_verified end,
   collections=case when p_data ? 'collections' then excluded.collections else existing.collections end,
   gallery=case when p_data ? 'gallery' then excluded.gallery else existing.gallery end,
   fits_inside_en=case when p_data ? 'fits_inside_en' then excluded.fits_inside_en else existing.fits_inside_en end,
   fits_inside_ar=case when p_data ? 'fits_inside_ar' then excluded.fits_inside_ar else existing.fits_inside_ar end,
   styling_en=case when p_data ? 'styling_en' then excluded.styling_en else existing.styling_en end,
   styling_ar=case when p_data ? 'styling_ar' then excluded.styling_ar else existing.styling_ar end,
   dimensions_cm=case when p_data ? 'dimensions_cm' then excluded.dimensions_cm else existing.dimensions_cm end,
   limited_edition=case when p_data ? 'limited_edition' then excluded.limited_edition else existing.limited_edition end,
   edition_size=case when p_data ? 'edition_size' then excluded.edition_size else existing.edition_size end,
   pair_product_id=case when p_data ? 'pair_product_id' then excluded.pair_product_id else existing.pair_product_id end,
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
