-- 015_unified_customer_membership_short_id.sql
-- Remove unique constraint from short_id so a customer with multiple plans shares one single Membership ID.

ALTER TABLE public.customer_memberships DROP CONSTRAINT IF EXISTS customer_memberships_short_id_key;
ALTER TABLE public.customer_memberships DROP CONSTRAINT IF EXISTS customer_memberships_short_id_unique;
DROP INDEX IF EXISTS public.customer_memberships_short_id_key;

WITH first_ids AS (
  SELECT DISTINCT ON (customer_phone) customer_phone, short_id
  FROM public.customer_memberships
  WHERE short_id IS NOT NULL AND short_id <> ''
  ORDER BY customer_phone, created_at ASC, id
)
UPDATE public.customer_memberships cm
SET short_id = fi.short_id
FROM first_ids fi
WHERE cm.customer_phone = fi.customer_phone
  AND (cm.short_id IS NULL OR cm.short_id <> fi.short_id);
