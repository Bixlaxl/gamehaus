export const runtime = 'edge';

import { createAdminClient } from "@/lib/supabase/admin";
import { mergeSettings, type AppSettings } from "@/lib/settings";
import { SettingsContent } from "./content";

export default async function SettingsPage() {
  const admin = createAdminClient();

  const [
    { data: settings },
    { data: locations },
    { data: staff },
    { data: tables },
    { data: coupons },
  ] = await Promise.all([
    admin.from("app_settings").select("data").eq("id", 1).maybeSingle(),
    admin.from("locations").select("id, name, slug, opening_time, closing_time, is_active").order("created_at"),
    admin.from("users").select("id, name, email, role, is_active, location_id, locations(name)").eq("role", "staff").order("name"),
    admin.from("tables").select("id, name, type, hourly_rate, is_active, location_id, locations(name)").order("sort_order"),
    admin.from("coupons").select("id, code, discount_type, discount_value, is_active, used_count, max_uses, valid_until").order("created_at", { ascending: false }).limit(10),
  ]);

  const initialSettings = mergeSettings((settings?.data ?? null) as Partial<AppSettings> | null);

  return (
    <SettingsContent
      initialSettings={initialSettings}
      locations={locations ?? []}
      staff={staff ?? []}
      tables={tables ?? []}
      coupons={coupons ?? []}
    />
  );
}
