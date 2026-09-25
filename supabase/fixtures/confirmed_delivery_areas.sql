-- Owner confirmed all seven UAE emirates, AED 15 delivery and next-day target.
-- This does not enable COD or decide tax. Existing rows are preserved.
insert into commerce.delivery_areas(code,name_en,name_ar,shipping_minor,days_min,days_max,active) values
 ('abu-dhabi','Abu Dhabi','أبوظبي',1500,1,1,true),
 ('ajman','Ajman','عجمان',1500,1,1,true),
 ('dubai','Dubai','دبي',1500,1,1,true),
 ('fujairah','Fujairah','الفجيرة',1500,1,1,true),
 ('ras-al-khaimah','Ras Al Khaimah','رأس الخيمة',1500,1,1,true),
 ('sharjah','Sharjah','الشارقة',1500,1,1,true),
 ('umm-al-quwain','Umm Al Quwain','أم القيوين',1500,1,1,true)
on conflict(code) do nothing;
