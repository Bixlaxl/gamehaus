export const runtime = "edge";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { POSSideRail } from "@/components/pos/side-rail";
import { StaffInventoryContent } from "./content";

export default async function StaffInventoryPage() {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const { data: profile } = await supabase
    .from("users")
    .select("name, location_id")
    .eq("id", session.user.id)
    .single();
  if (!profile?.location_id) redirect("/pos");

  const admin = createAdminClient();
  const [{ data: location }, { data: items }] = await Promise.all([
    admin.from("locations").select("name").eq("id", profile.location_id).single(),
    admin
      .from("inventory_items")
      .select("*")
      .eq("location_id", profile.location_id)
      .eq("is_active", true)
      .order("category")
      .order("sort_order")
      .order("name"),
  ]);

  return (
    <div className="dark h-screen flex overflow-hidden bg-[#0a0a0a]">
      <POSSideRail
        activeRoute="inventory"
        staffName={profile.name}
        locationName={location?.name ?? ""}
        locationId={profile.location_id}
      />
      <StaffInventoryContent
        locationId={profile.location_id}
        locationName={location?.name ?? ""}
        initialItems={items ?? []}
      />
    </div>
  );
}
