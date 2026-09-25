-- OPT-IN DEVELOPMENT FIXTURES ONLY. Never used automatically by deployment.
-- These six handbag names/prices/images reproduce the current design preview.
-- 20 units/product, zero shipping and zero tax are temporary test values.
-- Free shipping over AED 250 remains unconfirmed and is NOT configured here.
begin;
do $$ begin
 if exists(select 1 from commerce.orders) then raise exception 'Do not seed a database with orders'; end if;
end $$;
insert into commerce.products(id,name,description,category,price_minor,image,badge,swatches,active,fixture,stock_quantity) values
('blush-duo','The Rose Top Handle','Soft structure, everyday polish','face',16500,'./assets/bag-rose.png','BEST SELLER','[]',true,true,20),
('lip-pair','The Mauve Mini','A compact companion for every plan','lips',14000,'./assets/bag-mauve.png','NEW','[]',true,true,20),
('eye-palette','The Cognac Tote','Room for everything, refined shape','face',22000,'./assets/bag-tan-tote.png','BEST SELLER','[]',true,true,20),
('highlighter','The Champagne Clutch','A luminous finish for evenings','lips',12500,'./assets/bag-champagne.png','EVENING EDIT','[]',true,true,20),
('lip-liner','The Burgundy Crossbody','A hands-free classic in rich burgundy','eyes',11000,'./assets/bag-burgundy.png','NEW','[]',true,true,20),
('eye-sticks','The Espresso Hobo','Easy shape, effortless carry','eyes',13500,'./assets/bag-espresso.png','ONLINE EXCLUSIVE','[]',true,true,20)
on conflict(id) do nothing;
update commerce.settings set fixture_mode=true,checkout_enabled=true,shipping_minor=0,tax_basis_points=0,allowed_countries=array['AE'],free_shipping_threshold_minor=null where singleton;
commit;
