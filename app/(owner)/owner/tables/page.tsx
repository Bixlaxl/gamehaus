export const runtime = 'edge';
export const dynamic = 'force-dynamic';

import { createAdminClient } from "@/lib/supabase/admin";
import { TablesContent } from "./content";

export default async function TablesPage() {
  const admin = createAdminClient();
  const [{ data: locations }, { data: tables }] = await Promise.all([
    admin.from("locations").select("*").eq("is_active", true),
    admin.from("tables").select("*").order("sort_order"),
  ]);
  return <TablesContent initialLocations={locations ?? []} initialTables={tables ?? []} />;
}
