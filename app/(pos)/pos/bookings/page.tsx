export const runtime = "edge";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { POSSideRail } from "@/components/pos/side-rail";
import { StaffBookingsContent } from "./content";

export default async function StaffBookingsPage() {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const { data: profile } = await supabase
    .from("users")
    .select("role, name, location_id")
    .eq("id", session.user.id)
    .single();
  if (!profile?.location_id) redirect("/pos");

  const admin = createAdminClient();
  const { data: location } = await admin
    .from("locations")
    .select("name")
    .eq("id", profile.location_id)
    .single();

  // Today + tomorrow window — staff cares about what's coming next, not history.
  const todayDate = new Date().toISOString().split("T")[0];
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 2);
  const toDate = tomorrow.toISOString().split("T")[0];
  const from = new Date(`${todayDate}T00:00:00+05:30`).toISOString();
  const to   = new Date(`${toDate}T00:00:00+05:30`).toISOString();

  const { data: bookings } = await admin
    .from("bookings")
    .select(`
      *,
      order:orders(customer_name, customer_phone, advance_paid),
      order_item:order_items(status, table:tables(name, type, location_id))
    `)
    .eq("order_item.table.location_id", profile.location_id)
    .gte("scheduled_start", from)
    .lte("scheduled_start", to)
    .order("scheduled_start");

  // The join doesn't filter — it sets table to null when location_id mismatches.
  // We filter those rows out here so staff only sees their own location.
  const ownLocationBookings = (bookings ?? []).filter(
    (b) => (b.order_item as { table?: unknown } | null)?.table != null
  );

  return (
    <div className="dark h-screen flex overflow-hidden bg-[#0a0a0a]">
      <POSSideRail
        activeRoute="bookings"
        staffName={profile.name}
        locationName={location?.name ?? ""}
        locationId={profile.location_id}
      />
      <StaffBookingsContent
        locationId={profile.location_id}
        locationName={location?.name ?? ""}
        initialBookings={ownLocationBookings}
      />
    </div>
  );
}
