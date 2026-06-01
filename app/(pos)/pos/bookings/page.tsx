export const runtime = "edge";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { BookingsContent } from "@/app/(owner)/owner/bookings/content";

/**
 * Staff bookings page — reuses the owner BookingsContent component verbatim
 * so the two surfaces stay visually identical. Differences vs owner:
 *   - mode="staff" injects Check-in / No-show buttons on each confirmed row
 *   - those buttons are gated by the staff's location operating hours
 *   - the API is auto-scoped to the staff's location (see /api/owner/bookings)
 */
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
    .select("id, name, opening_time, closing_time")
    .eq("id", profile.location_id)
    .single();

  const opening = location?.opening_time ?? "10:00";
  const closing = location?.closing_time ?? "23:00";
  const todayDate = new Date().toISOString().split("T")[0];

  const [openH, openM]   = opening.split(":").map(Number);
  const [closeH, closeM] = closing.split(":").map(Number);
  const crossesMidnight  = closeH < openH || (closeH === openH && closeM < openM);
  const from = new Date(`${todayDate}T${opening}+05:30`).toISOString();
  const closeDate = crossesMidnight
    ? (() => { const d = new Date(todayDate + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().split("T")[0]; })()
    : todayDate;
  const to = new Date(`${closeDate}T${closing}+05:30`).toISOString();

  const { data: bookings } = await admin
    .from("bookings")
    .select(`
      *,
      order:orders(customer_name, customer_phone, advance_paid),
      order_item:order_items(table:tables(name, type, location:locations(name, id)))
    `)
    .gte("scheduled_start", from)
    .lte("scheduled_start", to)
    .order("scheduled_start");

  // Filter to staff's own location (server defensive; the GET endpoint also does this)
  const ownLocationBookings = (bookings ?? []).filter((b) => {
    const t = (b.order_item as { table?: { location?: { id?: string } } } | null)?.table;
    return t?.location?.id === profile.location_id;
  });

  return (
    // Render in the same off-white surface the owner panel uses so the layout
    // matches exactly. The /pos shared layout's dark wrapper is overridden
    // here for this single page since the bookings UI was designed light-mode.
    <main className="flex-1 overflow-y-auto bg-[#fafafa] text-gray-900 p-6">
      <BookingsContent
        mode="staff"
        staffLocationId={profile.location_id}
        initialLocations={location ? [location] : []}
        initialBookings={ownLocationBookings}
      />
    </main>
  );
}
