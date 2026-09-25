-- Public inventory visibility follows sellable stock. No product stock or orders are modified.
create or replace function public.commerce_catalog() returns jsonb language sql stable security definer set search_path = '' as $$
select jsonb_build_object(
 'currency','AED', 'fixture_mode',s.fixture_mode,
 'checkout_enabled',s.checkout_enabled,
 'cod_enabled',s.cod_enabled and not s.fixture_mode,
 'buy_two_free_delivery',jsonb_build_object('enabled',s.buy_two_free_delivery_enabled,'min_bags',2),
 'delivery_areas',coalesce((select jsonb_agg(jsonb_build_object(
   'code',a.code,'name_en',a.name_en,'name_ar',a.name_ar,
   'shipping_minor',a.shipping_minor,'days_min',a.days_min,'days_max',a.days_max) order by a.name_en)
   from commerce.delivery_areas a where a.active), '[]'::jsonb),
 'products',coalesce((select jsonb_agg(jsonb_build_object(
   'id',p.id,'name',p.name,'description',p.description,'category',p.category,
   'name_ar',p.name_ar,'description_ar',p.description_ar,'badge_ar',p.badge_ar,
   'price_minor',p.price_minor,'image',p.image,'badge',p.badge,'swatches',p.swatches,
   'available',p.stock_quantity > p.reserved_quantity,'last_piece',not p.fixture and p.stock_quantity-p.reserved_quantity=1,'fixture',p.fixture,
   'collections',p.collections,'gallery',p.gallery,'fits_inside_en',p.fits_inside_en,
   'fits_inside_ar',p.fits_inside_ar,'styling_en',p.styling_en,'styling_ar',p.styling_ar,
   'dimensions_cm',p.dimensions_cm,'limited_edition',p.limited_edition,
   'edition_size',p.edition_size,'pair_product_id',p.pair_product_id,
   'fit_visual_url',p.fit_visual_url,'fit_verified',p.fit_verified) order by p.id)
   from commerce.products p where p.active and p.stock_quantity>p.reserved_quantity), '[]'::jsonb))
from commerce.settings s where s.singleton;
$$;
