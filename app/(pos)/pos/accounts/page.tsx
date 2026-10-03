export const runtime = "edge";
export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { OwnerAccountsContent } from "@/app/(owner)/owner/accounts/content";
import { getOperatingDate } from "@/lib/utils";

export default async function StaffAccountsPage() {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("users")
    .select("id, name, role, location_id")
    .eq("id", session.user.id)
    .single();

  if (!profile) redirect("/login");

  // Fetch locations: if staff has assigned location, prioritize it; otherwise all active locations
  let locationsQuery = admin
    .from("locations")
    .select("id, name, opening_time, closing_time")
    .eq("is_active", true);

  if (profile.role === "staff" && profile.location_id) {
    locationsQuery = locationsQuery.eq("id", profile.location_id);
  }

  const { data: locations } = await locationsQuery.order("name");

  const defaultLocation = locations?.[0];
  const defaultDate = getOperatingDate(new Date(), defaultLocation?.opening_time ?? "10:00");

  return (
    <main className="pos-bookings-dark flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 bg-[#F7F6F3] dark:bg-[#0A0A0A]">
      <OwnerAccountsContent
        locations={locations ?? []}
        initialDate={defaultDate}
        userName={profile.name ?? "Staff"}
        userRole="staff"
      />
    </main>
  );
}
