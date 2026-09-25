-- Public product media only. Uploads go through the authenticated Admin Edge endpoint.
-- No browser write policies and no changes to pre-existing buckets.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('product-images','product-images',true,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do nothing;
do $$ begin
 if not exists(select 1 from storage.buckets where id='product-images' and public and file_size_limit=5242880
 and allowed_mime_types=array['image/jpeg','image/png','image/webp']) then
 raise exception 'Existing product-images bucket needs review; no settings overwritten';
 end if;
end $$;
