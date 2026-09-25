-- One-time development fixture refresh for the handbag storefront. No production settings changed.
-- Refuses to change data once orders exist or any product was edited away from the original fixture.
begin;
do $$
declare changed integer;
begin
 if exists(select 1 from commerce.orders) then raise exception 'Refusing to change products with existing orders'; end if;
 if (select count(*) from commerce.products where fixture and reserved_quantity=0 and
  (id,name,image) in (
   ('blush-duo','The Velvet Blush Duo','./assets/blush.png'),
   ('lip-pair','The Rose Lip Pair','./assets/lip.png'),
   ('eye-palette','The Everyday Eye Palette','./assets/palette.png'),
   ('highlighter','Liquid Light Highlighter','./assets/highlighter.png'),
   ('lip-liner','The Defined Lip Edit','./assets/lip-liner.png'),
   ('eye-sticks','The Lightplay Eye Sticks','./assets/eye-stick.png')
  )) <> 6 then raise exception 'Original development fixtures changed; refusing to overwrite'; end if;

 with replacements(id,name,description,category,image,badge) as (values
  ('blush-duo','The Rose Top Handle','Soft structure, everyday polish','face','./assets/bag-rose.png','BEST SELLER'),
  ('lip-pair','The Mauve Mini','A compact companion for every plan','lips','./assets/bag-mauve.png','NEW'),
  ('eye-palette','The Cognac Tote','Room for everything, refined shape','face','./assets/bag-tan-tote.png','BEST SELLER'),
  ('highlighter','The Champagne Clutch','A luminous finish for evenings','lips','./assets/bag-champagne.png','EVENING EDIT'),
  ('lip-liner','The Burgundy Crossbody','A hands-free classic in rich burgundy','eyes','./assets/bag-burgundy.png','NEW'),
  ('eye-sticks','The Espresso Hobo','Easy shape, effortless carry','eyes','./assets/bag-espresso.png','ONLINE EXCLUSIVE')
 )
 update commerce.products p set name=r.name,description=r.description,category=r.category,
  image=r.image,badge=r.badge,swatches='[]'::jsonb,updated_at=now()
 from replacements r where p.id=r.id;
 get diagnostics changed = row_count;
 if changed <> 6 then raise exception 'Unexpected product count'; end if;
end $$;
commit;
