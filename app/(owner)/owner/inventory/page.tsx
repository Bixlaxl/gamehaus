export const runtime = "edge";
export const dynamic = 'force-dynamic';

import { createAdminClient } from "@/lib/supabase/admin";
import { InventoryContent } from "./content";

export default async function InventoryPage() {
  const admin = createAdminClient();

  const [{ data: locations }, { data: items }] = await Promise.all([
    admin.from("locations").select("id, name").eq("is_active", true),
    admin
      .from("inventory_items")
      .select("*")
      .order("category")
      .order("sort_order")
      .order("name"),
  ]);

  return (
    <InventoryContent
      initialLocations={locations ?? []}
      initialItems={items ?? []}
    />
  );
}
