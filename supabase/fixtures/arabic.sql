-- Explicit Arabic translations of the existing development handbags only.
-- Preserve edited translations and non-fixture products. No pricing/stock changes.
update commerce.products p set name_ar=v.name_ar,description_ar=v.description_ar,badge_ar=v.badge_ar
from (values
('blush-duo','The Rose Top Handle','حقيبة روز بمقبض علوي','تصميم ناعم وأناقة لكل يوم','الأكثر رواجًا'),
('lip-pair','The Mauve Mini','حقيبة موف الصغيرة','رفيقتكِ الصغيرة لكل مناسبة','جديد'),
('eye-palette','The Cognac Tote','حقيبة توت بلون الكونياك','مساحة لكل احتياجاتكِ بتصميم أنيق','الأكثر رواجًا'),
('highlighter','The Champagne Clutch','حقيبة كلاتش بلون الشمبانيا','لمسة مضيئة لإطلالات المساء','تشكيلة المساء'),
('lip-liner','The Burgundy Crossbody','حقيبة كروس بودي عنابية','تصميم كلاسيكي يترك يديكِ حرتين','جديد'),
('eye-sticks','The Espresso Hobo','حقيبة هوبو بلون الإسبريسو','تصميم مريح وسهل الحمل','حصري عبر الإنترنت')
) v(id,name,name_ar,description_ar,badge_ar)
where p.id=v.id and p.name=v.name and p.fixture
 and p.name_ar='' and p.description_ar='' and p.badge_ar='';
