-- ============================================================
-- 003_auth_hook.sql
-- JWT custom claims hook — injects role and location_id
-- into every access token so RLS policies work without joins
-- ============================================================

-- Grant the hook function execute permission
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims jsonb;
  user_data record;
begin
  -- Fetch role and location_id for this user
  select role, location_id, is_active
    into user_data
    from public.users
   where id = (event ->> 'user_id')::uuid;

  claims := event -> 'claims';

  if user_data.id is not null then
    claims := jsonb_set(claims, '{role}', to_jsonb(user_data.role));

    if user_data.location_id is not null then
      claims := jsonb_set(claims, '{location_id}', to_jsonb(user_data.location_id::text));
    else
      claims := jsonb_set(claims, '{location_id}', 'null'::jsonb);
    end if;
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

-- Grant necessary permissions
grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook to supabase_auth_admin;

-- IMPORTANT: After running this migration, go to Supabase Dashboard →
-- Authentication → Hooks → Custom Access Token Hook
-- and set the function to: public.custom_access_token_hook

-- ─── REALTIME ─────────────────────────────────────────────
-- Enable Realtime on the three tables the POS subscribes to.
-- Run this in Supabase Dashboard → Database → Replication,
-- or via the Supabase CLI after linking the project.
--
-- alter publication supabase_realtime add table order_items;
-- alter publication supabase_realtime add table orders;
-- alter publication supabase_realtime add table tables;
